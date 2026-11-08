// @ts-check
/** @import { Level, Goal } from '../js/types.js' */
// Level 10: Rate limiter.
// Everything specific to this level lives here: components, rules, missions, quiz and text.
import { fmt } from '../js/format.js';
import { servedGoal, latGoal, costGoal, servedAtLeast } from './shared/goals.js';
import { dns, lb, NO_DB_NOTE, autoscaleSubOf, scalingChoices, shards } from './shared/components.js';
import { dnsLookup, usersToLb, lbToWeb, webToShards, lbBad } from './shared/connections.js';
import { lbText, levelComplete } from './shared/text.js';
import { failText, passText } from './shared/quiz.js';
import { dayTraffic } from './shared/workload.js';

const targets = { latencyMs: 150, servedPct: 99 };
const BUDGET = 2100;
const BIG_BUDGET = 2300;

const realUsersGoal = servedGoal(targets, { text: `Real users: at least ${targets.servedPct}% of requests succeed` });
const withinQuota = (m) => m.keyQuota != null && m.keyQuota <= 1.0001;
/** @type {Goal} */
const quotaGoal = {
  id: 'quota', type: 'metric', text: 'No API key gets more than 60 requests a minute', test: withinQuota,
  val: (m) => (m.keyQuota == null ? '—' : `${fmt(60 * m.keyQuota)}/min`),
};
const served99 = servedAtLeast(targets.servedPct);
const algoShort = { token: 'token bucket', leaky: 'leaking bucket', fixed: 'fixed window', slog: 'sliding log', scount: 'sliding counter' };

/** @type {Level} */
export default {
  id: 10,
  saveKey: 'sdl-level10-v1',
  saveVersion: 1,
  targets,
  // The day's traffic curve, for the cost of the autoscaled API servers.
  workload: { day: dayTraffic() },

  components: {
    users: {
      name: 'Users', sub: 'Apps with API keys',
      desc: 'Apps calling your public search API, each with its own API key: 2,000 requests a second from about 10,000 keys. A user typing a search sends up to 12 requests in 2 seconds, then pauses. Some keys belong to bots that never pause.',
    },
    dns: dns(),
    lb: lb(),
    web: {
      name: 'API server', short: 'Answers searches',
      desc: 'Runs the search API. These are autoscaled groups of M servers, as in Level 6: they grow with the traffic, bots included, and you pay for every server they run.',
      noDbNote: NO_DB_NOTE,
      subOf: autoscaleSubOf,
      choices: scalingChoices(),
    },
    shards: { ...shards(), name: 'Search index', short: 'Sharded, as in Level 9' },
    limiter: {
      name: 'Rate limiter', short: 'Blocks extra requests',
      desc: 'Middleware in front of the API. For each request it reads the API key\'s counter, and answers HTTP 429 Too Many Requests when the key is over its limit: 60 requests a minute. Requests within the limit go on to the API. In this game it checks 6,000 requests a second and costs $100/month.',
      subOf: (n) => {
        const bucket = n.algo === 'token' || n.algo === 'leaky' ? ` · ${n.bucket}, ${n.refill}/s` : '';
        return `${algoShort[n.algo] || 'token bucket'}${bucket}`;
      },
      choices: [
        {
          key: 'algo', label: 'Algorithm',
          options: [
            { id: 'token', name: 'Token bucket', sub: 'allows short bursts', note: 'Each key has a bucket of tokens, refilled at a steady rate. A request takes a token, or is rejected when the bucket is empty. A full bucket lets a burst through at once.', log: 'Rate limiter set to token bucket.' },
            { id: 'leaky', name: 'Leaking bucket', sub: 'fixed outflow rate', note: 'Requests join a queue the size of the bucket and go on at a fixed rate; when the queue is full, they are rejected. Steady output, but a burst waits its turn.', log: 'Rate limiter set to leaking bucket.' },
            { id: 'fixed', name: 'Fixed window', sub: 'counter per minute', note: 'A counter per key for each clock minute. Requests past 60 are rejected until the next minute starts. Simple, but a burst on both sides of a minute boundary gets twice the limit through.', log: 'Rate limiter set to fixed window counter.' },
            { id: 'slog', name: 'Sliding window log', sub: 'exact, memory-hungry', note: 'Keeps the time of every request in the last 60 seconds and counts them. Exact in any rolling minute, but it stores a timestamp for every request, even rejected ones.', log: 'Rate limiter set to sliding window log.' },
            { id: 'scount', name: 'Sliding window counter', sub: 'close to exact, small', note: 'Counts this minute plus the share of last minute\'s count that still overlaps the rolling window. Two counters per key, and very close to exact.', log: 'Rate limiter set to sliding window counter.' },
          ],
        },
        {
          key: 'bucket', label: 'Bucket size (token and leaking bucket)',
          options: [
            { id: '4', name: '4', sub: 'tokens or queue places', note: 'Small bucket: a user typing a search (12 requests in 2 seconds) runs out after 6.', log: 'Bucket size set to 4.' },
            { id: '12', name: '12', sub: 'tokens or queue places', note: 'Room for a whole typed search: 12 requests in 2 seconds.', log: 'Bucket size set to 12.' },
            { id: '60', name: '60', sub: 'tokens or queue places', note: 'A key can save up a full minute\'s quota and spend it at once.', log: 'Bucket size set to 60.' },
          ],
        },
        {
          key: 'refill', label: 'Refill rate (token and leaking bucket)',
          options: [
            { id: '1', name: '1 a second', sub: '60 a minute', note: 'One token (or one queued request) a second: the limit of 60 a minute.', log: 'Refill rate set to 1 a second.' },
            { id: '5', name: '5 a second', sub: '300 a minute', note: 'Five a second: five times the limit, so a busy key gets 300 requests a minute.', log: 'Refill rate set to 5 a second.' },
          ],
        },
      ],
    },
    counter: {
      name: 'Redis counters', short: 'Shared counters', sub: 'In memory · $60',
      desc: 'An in-memory store for the limiters\' counters. INCR adds one to a key\'s counter; EXPIRE deletes it when its window ends. Every limiter reads and updates the same counters, so a key\'s quota is counted once however many limiters it reaches. 50,000 operations a second, $60/month in this game.',
    },
  },
  palette: ['dns', 'lb', 'web', 'shards', 'limiter', 'counter'],
  limits: { dns: 1, lb: 1, web: 2, shards: 1, limiter: 2, counter: 1 },
  limitMsg: {
    dns: 'You only need one DNS service.',
    lb: 'One load balancer is enough in this level.',
    web: 'Two autoscaled groups of API servers are enough: they grow on their own.',
    shards: 'One search index is enough.',
    limiter: 'Two rate limiters is the limit here.',
    counter: 'One counter store is enough: every limiter shares it.',
  },
  // Inside one data center: autoscaled API servers and Level 9's sharded database as the search index.
  startNodes: [
    { id: 'u', type: 'users', x: 380, y: 60 },
    { id: 'd', type: 'dns', x: 120, y: 60 },
    { id: 'l', type: 'lb', x: 380, y: 260, algo: 'rr' },
    { id: 'w1', type: 'web', x: 250, y: 360, size: 'M', scaling: 'auto' },
    { id: 'w2', type: 'web', x: 510, y: 360, size: 'M', scaling: 'auto' },
    { id: 'z', type: 'shards', x: 380, y: 460, size: 'XL', count: '3', key: 'account', hot: 'stay' },
  ],
  startEdges: [
    { id: 's1', from: 'u', to: 'd' }, { id: 's2', from: 'u', to: 'l' },
    { id: 's3', from: 'l', to: 'w1' }, { id: 's4', from: 'l', to: 'w2' },
    { id: 's5', from: 'w1', to: 'z' }, { id: 's6', from: 'w2', to: 'z' },
  ],
  slots: {
    dns: { x: 120, y: 60 }, lb: { x: 380, y: 260 }, web: { x: 510, y: 360 }, shards: { x: 380, y: 460 },
    limiter: [{ x: 250, y: 160 }, { x: 510, y: 160 }], counter: { x: 640, y: 260 },
  },

  connections: {
    ok: {
      'dns|users': dnsLookup(),
      'lb|users': usersToLb(),
      'lb|web': lbToWeb(),
      'shards|web': { ...webToShards(), desc: 'The API server looks up the search index; the shard comes from the key, as in Level 9.' },
      'limiter|users': { from: 'users', to: 'limiter', label: 'API calls', desc: 'Apps send every request to the rate limiter first, with their API key. DNS gives them its address.' },
      'lb|limiter': { from: 'limiter', to: 'lb', label: 'allowed', desc: 'Requests within their key\'s limit go on to the load balancer. The rest were answered with 429 Too Many Requests.' },
      'counter|limiter': { from: 'limiter', to: 'counter', label: 'counters', desc: 'For every request the limiter reads and updates its key\'s counter here (INCR, with EXPIRE for the window). About 0.1 ms in memory, plus the hop.' },
    },
    bad: {
      ...lbBad(),
      'limiter|web': 'The limiter sends allowed requests to the load balancer, which spreads them over the API servers. Connect it to the load balancer.',
      'limiter|shards': 'The limiter guards the API, not the index. Connect it to the load balancer.',
      'limiter|limiter': 'Limiters don\'t talk to each other directly. To share counts, connect both to the counter store.',
      'counter|users': 'Apps never see the counters. Connect the rate limiters to the counter store.',
      'counter|web': 'The counters belong to the rate limiters. Connect each limiter to the counter store.',
      'counter|lb': 'The counters belong to the rate limiters. Connect each limiter to the counter store.',
      'counter|shards': 'The counters belong to the rate limiters. Connect each limiter to the counter store.',
      'dns|limiter': 'DNS answers name lookups off the request path. Connect Users to DNS, and Users to the rate limiter.',
      'counter|dns': 'DNS answers name lookups off the request path. Connect the rate limiters to the counter store.',
    },
  },

  missions: [
    {
      title: 'A bot floods the API', ref: 'Rate limiting', qps: 2000, writes: 0, bot: { keys: 160, rate: 15 }, budget: BUDGET,
      story: 'Besides 2,000 requests a second from real apps, 160 bot keys send 15 requests a second each, without pause: 2,400 more. The search index slows to a crawl, and the autoscaled API servers grow to carry the bots, at your expense. Limit each key to 60 requests a minute, without blocking real users typing a search.',
      goals: [realUsersGoal, latGoal(targets), quotaGoal, costGoal(BUDGET)],
      hint: 'Add a rate limiter: connect Users to it and it to the load balancer, and remove Users → load balancer. Its token bucket starts with 4 tokens, too few for a user who types 12 requests in 2 seconds. Make the bucket 12, and keep the refill at 1 a second.',
      takeaway: 'Bots now get 60 requests a minute per key; real users\' bursts fit the bucket. Tuning is the hard part of a token bucket: too small blocks real users, too fast a refill lets bots through.',
    },
    {
      title: 'Bots at the window edge', ref: 'Algorithms', qps: 2000, writes: 0, bot: { keys: 160, rate: 15 }, budget: BUDGET,
      story: 'The bots got smarter: each key now sends its whole quota right before and right after the start of a minute. Some algorithms count that as two separate minutes. Make sure no key ever gets more than 60 requests in any 60 seconds.',
      goals: [
        realUsersGoal, latGoal(targets), quotaGoal, costGoal(BUDGET),
        { id: 'edge-burst', type: 'exp', text: 'Break it: bots burst at the window edge; still 60 a minute at most' },
      ],
      hint: 'A fixed window lets 120 through around the minute boundary, and a token bucket lets its whole bucket through on top of its refill. Pick a sliding window: the log or the counter.',
      takeaway: 'A sliding window counts any 60 seconds, not clock minutes, so the edge trick gets nothing. The log is exact but stores every timestamp; the counter keeps two numbers per key and is very close.',
    },
    {
      title: 'A bigger flood', ref: 'Distributed limiting', qps: 2000, writes: 0, bot: { keys: 400, rate: 22 }, budget: BIG_BUDGET,
      gate: {
        hidesTraffic: false,
        lo: 1.7, hi: 2,
        prompt: '<b>Estimate before you build.</b> Real apps send 2,000 requests a second. Now 400 bot keys send 22 a second each. Every request reaches a rate limiter, and one limiter checks 6,000 a second. How many limiters do you need?',
        label: 'Rate limiters',
        placeholder: 'e.g. 1',
        acceptedHtml: '<p><b>Estimate accepted.</b></p><div class="calc">Bots: 400 × 22 = 8,800 requests/s<br>All: 2,000 + 8,800 = 10,800 requests/s<br>10,800 ÷ 6,000 = 1.8, so 2 limiters</div>',
        acceptedLog: 'Estimate accepted: 2 rate limiters. Play is unlocked.',
        notNumber: 'Type the estimate as a number of limiters, for example 1.',
        hints: [
          { test: (v) => v > 0.3 && v < 0.4, text: 'That counts the real apps alone. The limiter sees the bots\' requests too, before it rejects them.' },
          { test: (v) => v >= 1.4 && v < 1.6, text: 'That counts the bots alone. Add the real apps\' 2,000 a second.' },
        ],
        fallback: 'Not quite. Add the real requests to the bots\' (keys × rate), then divide by 6,000.',
      },
      story: 'A botnet now sends 8,800 requests a second from 400 keys. One rate limiter can\'t check that many. With two, each app\'s requests may reach either one, so their counts must be shared: otherwise each limiter allows a key its 60 requests a minute, and every key gets 120.',
      goals: [
        { id: 'est', type: 'gate', text: 'Estimate the rate limiters you need' },
        realUsersGoal, latGoal(targets), quotaGoal, costGoal(BIG_BUDGET),
        { id: 'edge-burst', type: 'exp', text: 'Break it: bots burst at the window edge; still 60 a minute at most' },
      ],
      hint: 'Add a second rate limiter, connect Users to it and it to the load balancer. Then add Redis counters and connect both limiters to them, so they count each key once.',
      takeaway: 'Two limiters share their counters in Redis, so a key gets 60 a minute however its requests are spread. In a real system, use atomic updates (a Lua script, or Redis sorted sets) so two requests reading the same counter at once can\'t both slip through.',
    },
  ],

  // Break-it experiments. An event only checks its outcome.
  experiments: [
    {
      id: 'edge-burst', kind: 'event', botEdge: true,
      label: 'Burst at the window edge', labelOn: 'Stop the burst',
      needsDesign: 'Build the design first: put a rate limiter in front of the API.',
      on: 'Each bot key now sends its quota right before and right after every minute boundary.', onTone: 'bad',
      off: 'The bots spread their requests out again.',
      expect: (m) => served99(m) && withinQuota(m),
      notMet: (m) => (m.keyQuota == null
        ? 'There is no rate limiter: the bots get everything through.'
        : `In some 60 seconds a key gets ${fmt(60 * m.keyQuota)} requests through, not 60. Use a sliding window, which counts any 60 seconds rather than clock minutes.`),
      observed: () => 'Observed: bursts at the window edge, and no key got more than 60 requests in any 60 seconds.',
    },
  ],

  // Messages the engine shows for this level's design.
  text: {
    ...lbText(),
    noWeb: 'Apps have no way in. Connect Users to the rate limiter or the load balancer.',
    noBackend: 'The rate limiter has nowhere to send allowed requests, so every request fails. Connect it to the load balancer.',
    realBlocked: (fb) => `The rate limiter rejects ${Math.round(fb * 100)}% of real users' requests: a user typing a search sends 12 in 2 seconds, more than the bucket and refill allow. Make the bucket bigger.`,
    queueWait: (ms) => `Real users wait ${(ms / 1000).toFixed(1)} s on average in the leaking bucket's queue: it sends requests on at a fixed rate, so a typed search waits its turn.`,
    overQuota: (q, shared) => `Each key gets ${fmt(60 * q)} requests a minute through, not 60.${shared ? '' : ' Each rate limiter keeps its own counts; connect them all to a counter store.'}`,
    levelComplete: levelComplete(10),
  },

  quiz: {
    passScore: 8,
    passText: passText(10, 'Consistent hashing'),
    failText,
    questions: [
      { q: 'Which is NOT a reason to rate limit an API?', o: ['Stop a flood from starving everyone else', 'Cut costs, such as paid third-party calls', 'Keep bots from overloading the servers', 'Make each request faster for real users'], a: 3, e: 'Rate limiting prevents resource starvation from denial-of-service floods, cuts costs, and protects servers from overload. It doesn\'t speed up the requests it lets through; at best it keeps the servers from slowing down.', r: 'Why rate limit' },
      { q: 'Why not enforce the limit in the client app?', o: ['Clients cannot count requests', 'Anyone can change or fake a client', 'Clients would need Redis', 'HTTP has no status code for a blocked request'], a: 1, e: 'A client is easy to forge or modify, and you may not control it. Limits must be enforced where you control the code: on your servers or in a gateway.', r: 'Where to limit' },
      { q: 'What does the API return for a request over the limit?', o: ['200 with an empty body', '503 Service Unavailable', '429 Too Many Requests', '404 Not Found'], a: 2, e: 'HTTP 429 means too many requests. Headers such as X-Ratelimit-Remaining, X-Ratelimit-Limit and X-Ratelimit-Retry-After tell the client where it stands.', r: 'Exceeding the limit' },
      { q: 'A token bucket holds 5 tokens and gets 1 more a second. It is full. How many requests pass in one instant?', o: ['1', '5', '6', '60'], a: 1, e: 'Each request takes a token, so a full bucket lets 5 through at once; the rest wait for refills, one a second. That burst allowance is the token bucket\'s strength.', r: 'Token bucket' },
      { q: 'What is the main drawback of a fixed window counter?', o: ['Edge bursts can pass twice the limit', 'It needs a timestamp for every request', 'It cannot use Redis for its counters', 'It processes requests at one fixed rate'], a: 0, e: 'Six a minute, with 6 sent at 9:15:50 and 6 at 9:16:10: each clock minute sees 6, but the minute from 9:15:30 to 9:16:30 sees 12.', r: 'Fixed window' },
      { q: 'A sliding window counter allows 10 a minute. Last minute had 6 requests, this minute has 4, and we are 40% into it. Is a new request allowed?', o: ['No: 10 in the window', 'No: 11 in the window', 'Yes: 4 in the window', 'Yes: 7 in the window'], a: 3, e: 'Count 4 + 6 × 60% overlap = 7.6, so 7 after rounding down, under 10: allowed.', r: 'Sliding window counter' },
      { q: 'Which algorithm is exact in every rolling window but uses the most memory?', o: ['Fixed window counter', 'Sliding window log', 'Token bucket', 'Sliding window counter'], a: 1, e: 'The log keeps a timestamp for every request, even rejected ones, so it is exact but memory-hungry.', r: 'Sliding window log' },
      { q: 'Where do limiters usually keep their counters?', o: ['In each limiter\'s own memory', 'In a relational database table on the API servers\' disks', 'In a shared in-memory store such as Redis', 'In a cookie on the client'], a: 2, e: 'Counters need to be fast and to expire: an in-memory store with INCR and EXPIRE. Shared across limiters, each key is counted once.', r: 'High-level design' },
      { q: 'A counter is at 7. Two requests read it at the same moment and both write 8. What went wrong?', o: ['A race condition: one increment was lost', 'The counter expired too early', 'The token bucket was too small', 'Sticky sessions sent both of them to one limiter'], a: 0, e: 'Both read 7 before either wrote, so the count ends at 8 instead of 9. Locks fix it but are slow; atomic operations such as a Lua script or Redis sorted sets are the usual fix.', r: 'Distributed rate limiting' },
      { q: '300 keys each may send 2 requests a second. Real traffic is 1,200 req/s. A limiter checks 5,000 req/s. The bots send 15 a second per key. How many limiters?', o: ['1', '3', '2', '4'], a: 2, e: 'Bots: 300 × 15 = 4,500 req/s. With the real 1,200 that is 5,700 to check, more than one limiter\'s 5,000: two limiters.', r: 'Numbers to carry into the interview' },
    ],
  },

  // Lesson tab content (HTML). The diagrams below draw into figLimiter and figShared.
  lessonHtml: `
    <p class="label">Level 10 · Rate limiter</p>
    <h1>Rate limiter</h1>
    <p class="lede">Your public search API is open to anyone with a key, and bots have found it. In this level you put a rate limiter in front of the API, choose and tune its algorithm so real users get through while bots don't, and run two limiters that count each key once.</p>
    <div class="goals-box">
      <div><b>You will learn</b>Why and where to limit, five algorithms, and limiting across several servers.</div>
      <div><b>You will decide</b>The algorithm, its bucket and refill, and where the counters live.</div>
      <div><b>You will estimate</b>How many limiters a flood needs.</div>
    </div>

    <section>
      <h2>Why rate limit</h2>
      <p class="src">Rate limiting</p>
      <p>A rate limiter caps how many requests a client can send in a period, such as 3 password-reset emails an hour or 20 searches every 10 seconds. Requests over the cap are blocked. It helps in three ways:</p>
      <ul>
        <li><b>It stops floods</b>, intentional or not, from starving everyone else of the servers (denial of service).</li>
        <li><b>It cuts costs</b>: fewer servers, and fewer calls to paid third-party APIs.</li>
        <li><b>It keeps servers from overloading</b> because of bots or misbehaving clients.</li>
      </ul>
    </section>

    <section>
      <h2>Where to put it</h2>
      <p class="src">Client, server or gateway</p>
      <p>Not in the client: clients are easy to forge, and you may not control them. On the server, or in middleware in front of it: an <b>API gateway</b> is a managed service that limits rates alongside authentication, SSL termination and IP allow-lists. Use one if you already have it, or if building your own would take too long; build your own if you need an algorithm the gateway doesn't offer.</p>
      <figure class="fig"><svg id="figLimiter" viewBox="0 0 660 200" role="img" aria-label="An app sends three requests in one second to a rate limiter that allows two. Two go on to the API servers; the third gets 429 Too Many Requests."></svg><figcaption>Within the limit: on to the API. Over it: 429 Too Many Requests</figcaption></figure>
      <p>A request over the limit gets <b>HTTP 429 Too Many Requests</b>. Headers tell the client where it stands: <code>X-Ratelimit-Remaining</code>, <code>X-Ratelimit-Limit</code> and <code>X-Ratelimit-Retry-After</code>. Blocked requests are dropped, or queued to be processed later.</p>
    </section>

    <section>
      <h2>Algorithms</h2>
      <p class="src">Rate limiting algorithms</p>
      <ul>
        <li><b>Token bucket.</b> A bucket per key holds up to its size in tokens, refilled at a steady rate; each request takes one. With size 5 and 1 a second, a full bucket lets 5 through at once, then 1 a second. Simple, memory-efficient and allows bursts; size and rate take tuning.</li>
        <li><b>Leaking bucket.</b> Requests join a fixed-size queue and leave it at a fixed rate; when it is full they are dropped. Steady output, but a burst fills the queue and newer requests wait or are dropped.</li>
        <li><b>Fixed window counter.</b> A counter per clock window: at most 4 a second, say. Simple, but bursts at a window edge pass up to twice the limit: with 6 a minute, 6 at 9:15:50 and 6 at 9:16:10 put 12 inside the minute from 9:15:30 to 9:16:30.</li>
        <li><b>Sliding window log.</b> Keep each request's timestamp, drop the ones older than the window, and count the rest: 3 a minute means a fourth within any 60 seconds is rejected. Exact, but it stores every timestamp, even for rejected requests.</li>
        <li><b>Sliding window counter.</b> Count this window plus the overlapping share of the last one. Limit 10 a minute, 6 last minute, 4 so far, 40% into this minute: 4 + 6 × 60% = 7.6, rounded down to 7, so the request is allowed. Memory-efficient and close to exact, because it assumes last minute's requests were spread evenly.</li>
      </ul>
    </section>

    <section>
      <h2>Counters at scale</h2>
      <p class="src">Distributed rate limiting</p>
      <p>The counters live in an in-memory store such as Redis, not a database on disk: <code>INCR</code> adds one, <code>EXPIRE</code> deletes the counter when its window ends. Rules, such as 20 searches per 10 seconds per key, live in configuration files and are cached by the limiters.</p>
      <figure class="fig"><svg id="figShared" viewBox="0 0 660 230" role="img" aria-label="An app's requests reach two rate limiters. Both read and update the same counters in Redis, so the app's quota is counted once."></svg><figcaption>Two limiters, one set of counters</figcaption></figure>
      <p>With several limiters, an app's requests can reach any of them. If each keeps its own counts, each allows the full quota. Sticky sessions would fix that, but don't scale; sharing the counters in one store does. Two more things to watch:</p>
      <ul>
        <li><b>Race conditions.</b> A counter is at 7; two requests read it at once and both write 8, so one is never counted. Locks fix it but slow everything down; atomic operations (a Lua script, or Redis sorted sets) are the usual fix.</li>
        <li><b>Distance.</b> Run limiters near users, at the edge, and synchronize their counts with eventual consistency.</li>
      </ul>
      <p>Limits can be <b>hard</b> (never exceeded) or <b>soft</b> (exceeded briefly). You can also limit at other layers, such as by IP address in the network. Clients should cache results, catch 429s and retry with a backoff.</p>
    </section>

    <section>
      <h2>How this level is simulated</h2>
      <p class="src">Game assumptions</p>
      <p>Each key may send 60 requests a minute (1 a second). Real users send 2,000 requests a second from about 10,000 keys; a user typing a search sends 12 requests in 2 seconds. Bots send without pause. A token or leaking bucket cuts the part of a burst bigger than its size plus 2 seconds of refill. Through the limiter, each bot key gets its refill rate (buckets) or 1 a second (windows). At a window edge, a fixed window passes twice that, and a token bucket its whole bucket on top. A leaking bucket makes a typed search wait while its queue drains.</p>
      <p class="assume">Game assumptions: a rate limiter checks 6,000 requests a second for $100 a month; Redis counters cost $60 and are not a single point of failure. Without a shared store, each limiter counts on its own, and a key's requests spread evenly over the limiters. The API servers are autoscaled groups, so bots that get through also cost money.</p>
    </section>

    <section>
      <h2>Numbers to carry into the interview</h2>
      <p class="src">Capacity estimates</p>
      <p><b>Requests a limiter must check</b> = real requests + bot requests, since it sees everything before it rejects. 2,000 + 400 keys × 22 = 10,800 a second.</p>
      <p><b>What gets through</b> = keys × each key's limit. 400 keys at 1 a second: 400 a second, whatever they send.</p>
    </section>

    <section>
      <h2>How each mission maps to the interview</h2>
      <p class="src">Interview loop · times for a 45-minute interview (formats vary by company)</p>
      <div class="steps4">
        <div><span>Step 1 · 5–8 min</span><b>Scope it</b>Client or server side? Limit by key, user or IP? How big, how distributed? Tell users when they are limited?</div>
        <div><span>Step 2 · 10–12 min</span><b>Sketch it</b>A limiter in front of the API, counters in Redis.</div>
        <div><span>Step 3 · 15–20 min</span><b>Go deep</b>The algorithm and its tuning, rules, headers, races.</div>
        <div><span>Step 4 · 5 min</span><b>Stress it</b>Bursts at window edges. Several limiters.</div>
      </div>
      <p>When you design a rate limiter in an interview, ask these scoping questions about the API in front of you, a public search API here, before picking an algorithm.</p>
    </section>
`,

  // Lesson diagrams. `f` provides the engine's drawing helpers.
  drawFigures(f) {
    const { $, figNode, figArrow, figDefs, svgEl } = f;
    const f1 = $('figLimiter'); f1.textContent = ''; figDefs(f1);
    figNode(f1, 'users', 110, 100, 'App', '3 requests in 1 s');
    figNode(f1, 'limiter', 330, 100, 'Rate limiter', 'Allows 2 a second');
    figNode(f1, 'web', 550, 100, 'API servers', 'Get requests 1, 2');
    figArrow(f1, 206, 92, 234, 92, '', null, 0, 0);
    figArrow(f1, 426, 100, 454, 100, '', null, 0, 0);
    figArrow(f1, 234, 112, 206, 112, '', null, 0, 0);
    for (const [x, y, t] of [[220, 40, 'requests 1, 2, 3'], [440, 60, 'within limit'], [220, 168, '3: 429 Too Many Requests']]) { const e = svgEl('text', { x, y, class: 'd-label', 'text-anchor': 'middle' }, f1); e.textContent = t; }

    const f2 = $('figShared'); f2.textContent = ''; figDefs(f2);
    figNode(f2, 'users', 110, 115, 'App', 'Any limiter');
    figNode(f2, 'limiter', 330, 40, 'Rate limiter 1', 'Same counters');
    figNode(f2, 'limiter', 330, 190, 'Rate limiter 2', 'Same counters');
    figNode(f2, 'counter', 550, 115, 'Redis', 'Counter per key');
    figArrow(f2, 160, 85, 260, 60, '', null, 0, 0);
    figArrow(f2, 160, 145, 260, 170, '', null, 0, 0);
    figArrow(f2, 400, 60, 500, 85, 'INCR', null, 456, 62, 'start');
    figArrow(f2, 400, 170, 500, 145, 'INCR', null, 456, 176, 'start');
  },
};
