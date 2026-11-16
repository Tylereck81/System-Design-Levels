// @ts-check
/** @import { Level, Goal, Lesson } from '../js/types.js' */
// Level 10: Rate limiter.
// Everything specific to this level lives here: components, rules, missions, quiz and text.
import { fmt, ms, rate } from '../js/format.js';
import { COMPONENTS, T } from '../js/engine/catalog.js';
import { servedGoal, latGoal, costGoal, servedAtLeast } from './shared/goals.js';
import { dns, lb, NO_DB_NOTE, autoscaleSubOf, scalingChoices, shards } from './shared/components.js';
import { dnsLookup, usersToLb, lbToWeb, webToShards, lbBad } from './shared/connections.js';
import { lbText, levelComplete } from './shared/text.js';
import { failText, passText } from './shared/quiz.js';
import { dayTraffic } from './shared/workload.js';
import { STEPS } from './mock-steps.js';

const targets = { latencyMs: 150, servedPct: 99 };
/** Monthly budgets: Missions 1 and 2, and Mission 3, in dollars. */
const BUDGET = 2100;
const BIG_BUDGET = 2300;
/** The most requests each API key may send in a minute. */
const PER_MINUTE = T.keyLimit * 60;
/** Mission 3's botnet: how many bot keys, and the requests a second each one sends. */
const BOTNET = { keys: 400, rate: 22 };

// ---------------- Lesson ----------------
const [scope, sketch, deep, stress] = STEPS.map((step) => `<b>${step.name}</b>`);
const { limiter, counter } = COMPONENTS;
// Token bucket example (ours): a full bucket of 10 that gets 2 tokens a second, hit by 16 requests at once:
// 10 pass, 16 − 10 = 6 are refused, then 2 a second = 120 a minute.
const tb = { size: 10, refill: 2, burst: 16 };
tb.blocked = tb.burst - tb.size;
// Check yourself: a bucket of 8 with 1 token a second, empty, then 3 seconds with no requests: 3 tokens.
const tbCheck = { size: 8, refill: 1, wait: 3 };
// Fixed window example (ours): 100 requests a minute.
const fw = { limit: 100 };
// Sliding window counter example (ours): limit 100, 80 last minute, 30 this minute, 25% into the minute:
// 30 + 80 × 0.75 = 90.
const sw = { limit: 100, prev: 80, cur: 30, into: 0.25 };
sw.est = sw.cur + sw.prev * (1 - sw.into);
// How many limiters (our load): 4,500 real req/s and 700 bot keys at 20 a second: 700 × 20 = 14,000,
// 4,500 + 14,000 = 18,500, 18,500 ÷ 6,000 = 3.1, so 4 limiters.
const many = { real: 4500, keys: 700, each: 20 };
many.bots = many.keys * many.each;
many.all = many.real + many.bots;
many.n = Math.ceil(many.all / limiter.cap);

/** @type {Lesson} */
const lesson = {
  intro: {
    kicker: 'Level 10 · Part 2: Building blocks',
    title: 'Rate limiter',
    story: 'Your search API is open to any app with an API key. A few hundred of those keys now belong to bots that never pause, and your autoscaled servers grow to serve them at your expense. In this level every key gets a limit.',
    picture: 'figBuilt',
    alt: 'The finished design: requests from real apps and bots pass through two rate limiters before the load balancer and API servers. The limiters share one store of counters and answer bots over their limit with status 429.',
    outcomes: [
      'say why and where an API limits its clients',
      'explain a token bucket and tune its two settings',
      'show how a fixed window lets twice the limit through',
      'choose between a sliding window log and counter',
      'explain why several limiters must share counters',
    ],
  },
  last: 'Level 9 finished growing one app. This group of levels builds four tools that interviewers ask for by name. The first protects everything you have built from clients that send too much.',
  parts: [
    {
      title: 'A bot floods the API',
      mission: 0,
      minutes: 9,
      lead: 'Every request costs you server time, whoever sends it.',
      newParts: [
        { type: 'limiter', before: 1, what: 'A checkpoint in front of your API.', does: 'Counts each client\'s requests. It passes requests that are within the limit and refuses the rest.', game: `$${limiter.cost} a month. Checks ${rate(limiter.cap)}. The limit is ${PER_MINUTE} requests a minute for each key.` },
      ],
      sections: [
        {
          title: 'Why limit how many requests a client sends?',
          hook: 'A <b>rate limit</b> is a cap on how many requests one client may send in a period: 60 a minute, 5 logins an hour.',
          body: [
            { ul: [
              '<b>To stay up.</b> One client, by attack or by a bug, cannot use up the capacity everyone shares.',
              '<b>To save money.</b> You do not scale up, or pay a partner for each call, to serve junk.',
              '<b>To be fair.</b> Each client gets its share and no more.',
            ] },
            { p: 'A limit does not make any single request faster. It decides which requests are served at all.' },
          ],
          takeaway: 'A rate limit protects shared capacity from any one client.',
          quiz: [0],
        },
        {
          title: 'Where does the limit go, and what does a blocked client see?',
          hook: 'Not in the client app. Anyone can change or fake a client.',
          body: [
            { p: 'The limit is enforced on your side, in front of the API servers, so refused requests cost almost nothing. Often that place is an <b>API gateway</b>: a service in front of the API that also checks who is calling. Each client is identified by something it cannot easily change: here, its <b>API key</b>.' },
            { p: 'A refused request gets the HTTP status <b>429 Too Many Requests</b>, usually with headers that say how many requests are left and how many seconds to wait. A well-behaved client reads them and slows down.' },
          ],
          takeaway: 'Limit on the server side, and answer refused requests with status 429.',
          quiz: [1, 2],
        },
        {
          title: 'How does a token bucket work?',
          hook: 'Each client has a bucket of tokens. A request needs one token to pass.',
          body: [
            {
              figure: 'figBucket',
              alt: `A bucket holds up to ${tb.size} tokens and gets ${tb.refill} new tokens every second; tokens that do not fit are thrown away. Each request takes one token and passes. A request that finds the bucket empty is refused with status 429.`,
              caption: 'A request spends a token. No token, no entry',
            },
            { p: 'Two settings: the <b>bucket size</b>, which is how many requests may pass in one burst, and the <b>refill rate</b>, which is the steady rate over time.' },
            {
              calc: {
                formula: `A full bucket of ${tb.size} tokens, refilled at ${tb.refill} a second, gets ${tb.burst} requests at once:`,
                rows: [
                  { label: 'Pass', work: `${tb.size} tokens in the bucket`, result: `${tb.size} requests` },
                  { label: 'Refused', work: `${tb.burst} requests − ${tb.size} requests`, result: `${tb.blocked} requests` },
                  { label: 'From then on', work: `${tb.refill} tokens/s`, result: `${tb.refill * 60} requests a minute` },
                ],
                result: `A burst of ${tb.size} is fine, and after that the client gets ${tb.refill} a second.`,
              },
            },
          ],
          takeaway: 'Bucket size sets the burst, and refill rate sets the long-run limit.',
          quiz: [3],
        },
      ],
      checks: [
        {
          q: `A bucket holds ${tbCheck.size} tokens and gets ${tbCheck.refill} a second. It is empty. After ${tbCheck.wait} seconds with no requests, how many requests can pass at once?`,
          options: [
            { t: `${tbCheck.refill * tbCheck.wait}`, right: true, why: `${tbCheck.wait} seconds at ${tbCheck.refill} token a second. The bucket refills gradually, not all at once.` },
            { t: `${tbCheck.size}`, why: `It takes ${tbCheck.size / tbCheck.refill} seconds to fill the bucket from empty.` },
            { t: '0', why: 'Tokens arrive every second whether or not requests do.' },
          ],
        },
      ],
      youWill: [
        'put a rate limiter between Users and the load balancer',
        `tune the bucket so real users, who send short bursts, pass and no key gets more than ${PER_MINUTE} requests a minute`,
        `keep Response under ${ms(targets.latencyMs)} for at most $${fmt(BUDGET)} a month`,
      ],
      debrief: {
        saw: 'Bots were held to their limit, and real users\' short bursts fitted in the bucket.',
        number: [`${PER_MINUTE} a minute`, 'the most each key may send'],
        next: 'The bots are about to send their whole quota just before and just after the start of each minute.',
      },
    },
    {
      title: 'Bots at the window edge',
      mission: 1,
      minutes: 8,
      lead: 'There is more than one way to count, and each way can be fooled differently.',
      sections: [
        {
          title: 'How do bots get past a fixed window?',
          hook: `A <b>fixed window</b> counts requests per clock minute and starts from zero each minute. The limit is ${fw.limit} a minute.`,
          body: [
            {
              figure: 'figEdge',
              alt: `A bot sends ${fw.limit} requests in the last second of one minute and ${fw.limit} more in the first second of the next. Each clock minute counts ${fw.limit}, but ${fw.limit * 2} requests arrived within two seconds.`,
              caption: 'Two full quotas on either side of the boundary',
            },
            { p: `Each minute's counter says ${fw.limit}, so nothing is refused. But ${fw.limit * 2} requests arrived in two seconds: twice the limit. A fixed window is cheap, one number for each client, and it is wrong at the edges.` },
            { p: 'A token bucket has a similar gap: a full bucket passes on top of the steady refill.' },
          ],
          takeaway: 'A fixed window can let through twice the limit around a window boundary.',
          quiz: [4],
        },
        {
          title: 'How does a sliding window close the gap?',
          hook: 'It counts the last 60 seconds from now, wherever the clock minute started. There are two ways to do it.',
          body: [
            { table: { head: ['', 'Sliding window log', 'Sliding window counter'], rows: [
              ['<b>Keeps</b>', 'The time of every request', 'Two numbers: last window and this one'],
              ['<b>Accuracy</b>', 'Exact', 'A very close estimate'],
              ['<b>Memory</b>', 'High', 'Low'],
            ] } },
            {
              calc: {
                formula: 'Estimate = requests this window + requests last window × the share of last window still inside the last 60 seconds.',
                rows: [
                  { label: 'Share still inside', work: `100% − ${sw.into * 100}% into this minute`, result: `${(1 - sw.into) * 100}%` },
                  { label: 'Estimate', work: `${sw.cur} requests + ${sw.prev} requests × ${1 - sw.into}`, result: `${sw.est} requests` },
                ],
                result: `${sw.est} is under the limit of ${sw.limit}, so the request passes.`,
              },
            },
          ],
          takeaway: 'The log is exact and costly, and the counter is close and cheap.',
          quiz: [5, 6],
        },
        {
          title: 'How to choose an algorithm',
          hook: 'Ask two questions: must bursts be allowed, and how exact must the limit be?',
          body: [
            { table: { head: ['Algorithm', 'Bursts', 'Use it when'], rows: [
              ['<b>Token bucket</b>', 'Allowed, up to the bucket', 'Real users send short bursts'],
              ['<b>Leaking bucket</b>', 'Queued and released at a steady rate', 'What is behind needs an even flow'],
              ['<b>Fixed window</b>', 'Up to the limit, twice at an edge', 'Simple quotas that reset on the hour'],
              ['<b>Sliding window log</b>', 'Up to the limit', 'The limit must be exact'],
              ['<b>Sliding window counter</b>', 'Up to the limit', 'Many clients, and close is enough'],
            ] } },
          ],
          takeaway: 'Pick by whether bursts are welcome and how exact the limit must be.',
          quiz: [],
        },
      ],
      checks: [
        {
          q: 'An API allows 30 requests a minute with a fixed window. What is the most a client can get through in 60 seconds?',
          options: [
            { t: '30', why: 'That holds within one clock minute. A client can use the end of one minute and the start of the next.' },
            { t: '60', right: true, why: '30 just before the boundary and 30 just after: two quotas in a few seconds.' },
          ],
        },
      ],
      youWill: [
        'press Burst at the window edge and watch what each algorithm lets through',
        `pick an algorithm that never allows more than ${PER_MINUTE} requests in any 60 seconds`,
        `stay within $${fmt(BUDGET)} a month`,
      ],
      debrief: {
        saw: 'A sliding window counted any 60 seconds, not clock minutes, so the edge trick gained nothing.',
        number: ['2×', 'what a fixed window can pass at a window edge'],
        next: `A botnet is coming: ${fmt(BOTNET.keys)} keys, ${BOTNET.rate} requests a second each. One limiter cannot check that many.`,
      },
    },
    {
      title: 'A bigger flood',
      mission: 2,
      minutes: 8,
      lead: 'A rate limiter is a server too. It has a capacity, and it can be a single point of failure.',
      newParts: [
        { type: 'counter', before: 1, what: 'A small, fast store that keeps numbers in memory.', does: 'Holds each key\'s request count. Every rate limiter reads and updates the same counts, and old counts expire on their own.', game: `$${counter.cost} a month. Handles ${fmt(counter.cap)} operations/s.` },
      ],
      sections: [
        {
          title: 'How many rate limiters do you need?',
          hook: `Every request is checked, bots included. Real apps send ${rate(many.real)}, and ${fmt(many.keys)} bot keys send ${many.each} a second each.`,
          body: [
            {
              calc: {
                formula: 'Limiters = all requests a second ÷ what one limiter checks, rounded up.',
                rows: [
                  { label: 'Bots', work: `${fmt(many.keys)} keys × ${many.each} req/s`, result: rate(many.bots) },
                  { label: 'Everything', work: `${rate(many.real)} + ${rate(many.bots)}`, result: rate(many.all) },
                  { label: 'Limiters', work: `${rate(many.all)} ÷ ${rate(limiter.cap)}`, result: `${(many.all / limiter.cap).toFixed(1)}, so ${many.n} limiters` },
                ],
                result: `${many.n} limiters. Size them for the flood, because the flood is exactly when they are needed.`,
              },
            },
          ],
          takeaway: 'Size the limiters for all traffic, including the traffic they will refuse.',
          quiz: [9],
        },
        {
          title: 'Why must rate limiters share their counters?',
          hook: 'With two limiters, a key\'s requests are spread over both.',
          body: [
            { p: `If each limiter keeps its own count, each sees only half of a key's requests and allows the full ${PER_MINUTE} a minute. The key gets ${PER_MINUTE * 2}. With ten limiters it would get ten times its limit.` },
            { p: 'So the counts move out of the limiters into one store they all share. The limiters themselves hold nothing, which makes them stateless, like the web servers in Level 6. The store must be very fast, because it is asked on every request, so it keeps its data in memory.' },
          ],
          takeaway: 'Keep the counts in one shared in-memory store, not in each limiter.',
          quiz: [7],
        },
        {
          title: 'How can two requests slip past the same counter?',
          hook: 'Checking a limit takes three steps: read the count, compare it, write the count plus one.',
          body: [
            {
              figure: 'figRace',
              alt: 'A counter stands at 7. Two limiters read 7 at the same moment, each adds one, and each writes 8. Two requests passed but the counter went up by only one.',
              caption: 'Two reads of the same value, and one count is lost',
            },
            { p: 'If two requests read the count at the same moment, both see the same value and both write the same value plus one. One count is lost, and an extra request gets through. This is a <b>race condition</b>.' },
            { p: 'The fix is to make "add one and tell me the result" a single step that the store carries out by itself, with nothing able to cut in. Such a step is called <b>atomic</b>.' },
          ],
          takeaway: 'Make the count-and-check one atomic step so no update is lost.',
          quiz: [8],
        },
      ],
      checks: [
        {
          q: 'Three rate limiters each keep their own counters. The limit is 100 requests a minute for each key. A bot spreads its requests evenly. How many get through?',
          options: [
            { t: '100', why: 'Only if the limiters shared one count. Each one sees a third of the requests.' },
            { t: '300', right: true, why: 'Each limiter allows 100 of the requests it sees. Three limiters, three quotas.' },
          ],
        },
      ],
      youWill: [
        'estimate the rate limiters you need (Play stays locked until you do)',
        'add a second rate limiter and a shared counter store, and connect both limiters to it',
        `hold every key to ${PER_MINUTE} requests a minute through the edge burst, for at most $${fmt(BIG_BUDGET)} a month`,
      ],
    },
  ],
  wrap: {
    picture: 'figBuiltEnd',
    alt: 'The design you built: requests pass through two rate limiters before the load balancer and API servers. The limiters share one store of counters and answer bots over their limit with status 429.',
    say: [
      '"I limit each API key in front of the API servers and answer extra requests with a 429."',
      '"A token bucket allows short bursts, and a sliding window counter is accurate at window edges for little memory."',
      '"Limiters share counters in an in-memory store, with an atomic increment to avoid a race."',
    ],
    numbers: [
      ['429', 'the HTTP status for too many requests'],
      ['twice the limit', 'what a fixed window can pass at an edge'],
    ],
    loop: `The interview steps again: ${scope} (the limiters for the flood), ${sketch} (limiter in front of the API), ${deep} (the algorithm and its settings), ${stress} (bots at the window edge, then a botnet).`,
    broken: 'In Level 4, losing one cache server sent only its share of reads to the database. That depended on how keys were shared among servers. That worked with two. With more servers and the rule hash % N, losing one sends almost every key to the wrong server. Level 11 fixes the rule.',
  },
};

/**
 * The finished design, drawn for the intro and again for the wrap-up: two rate limiters in front of the load balancer
 * share one store of counters and answer keys over their limit with 429.
 * @param {Record<string, Function>} f the drawing helpers `drawFigures` is given
 * @param {SVGSVGElement} svg
 */
function drawBuilt(f, svg) {
  const { figNode, figArrow, figSvg, figLabel } = f;
  figSvg(svg, 560);
  figNode(svg, 'users', 320, 46, 'Users', 'Apps and bots');
  figNode(svg, 'limiter', 130, 166, 'Rate limiter 1', 'Checks each key');
  figNode(svg, 'limiter', 510, 166, 'Rate limiter 2', 'Checks each key');
  figArrow(svg, 260, 76, 180, 136, '', null, 0, 0);
  figArrow(svg, 380, 76, 460, 136, 'API calls', null, 430, 100);
  figArrow(svg, 120, 136, 226, 62, '429 if over', null, 160, 92, 'end');
  figNode(svg, 'counter', 320, 276, 'Shared counters', 'In memory');
  figArrow(svg, 210, 196, 256, 246, '', null, 0, 0);
  figArrow(svg, 430, 196, 384, 246, '', null, 0, 0);
  figLabel(svg, 320, 232, 'counts');
  figNode(svg, 'lb', 320, 406, 'Load balancer', 'Shares requests');
  figArrow(svg, 130, 196, 260, 376, 'allowed', null, 196, 330, 'end');
  figArrow(svg, 510, 196, 380, 376, 'allowed', null, 444, 330);
  figNode(svg, 'web', 150, 516, 'API servers', 'Autoscaled');
  figNode(svg, 'shards', 490, 516, 'Search index', 'Sharded');
  figArrow(svg, 260, 436, 190, 486, '', null, 0, 0);
  figArrow(svg, 244, 516, 396, 516, 'queries', null, 320, 508, 'middle');
}

const realUsersGoal = servedGoal(targets, { text: `Real users: at least ${targets.servedPct}% of requests succeed` });
const withinQuota = (m) => m.keyQuota != null && m.keyQuota <= 1.0001;
/** @type {Goal} */
const quotaGoal = {
  id: 'quota', type: 'metric', text: `No API key gets more than ${PER_MINUTE} requests a minute`, test: withinQuota,
  val: (m) => (m.keyQuota == null ? '—' : `${fmt(PER_MINUTE * m.keyQuota)}/min`),
};
const served99 = servedAtLeast(targets.servedPct);
const algoShort = { token: 'token bucket', leaky: 'leaking bucket', fixed: 'fixed window', slog: 'sliding log', scount: 'sliding counter' };

/** @type {Level} */
export default {
  id: 10,
  saveKey: 'sdl-level10-v1',
  saveVersion: 2, // 2: which missions were opened from the lesson (`opened`)
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
      title: 'A bigger flood', ref: 'Distributed limiting', qps: 2000, writes: 0, bot: BOTNET, budget: BIG_BUDGET,
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
        : `In some 60 seconds a key gets ${fmt(PER_MINUTE * m.keyQuota)} requests through, not ${PER_MINUTE}. Use a sliding window, which counts any 60 seconds rather than clock minutes.`),
      observed: () => `Observed: bursts at the window edge, and no key got more than ${PER_MINUTE} requests in any 60 seconds.`,
    },
  ],

  // Messages the engine shows for this level's design.
  text: {
    ...lbText(),
    noWeb: 'Apps have no way in. Connect Users to the rate limiter or the load balancer.',
    noBackend: 'The rate limiter has nowhere to send allowed requests, so every request fails. Connect it to the load balancer.',
    realBlocked: (fb) => `The rate limiter rejects ${Math.round(fb * 100)}% of real users' requests: a user typing a search sends 12 in 2 seconds, more than the bucket and refill allow. Make the bucket bigger.`,
    queueWait: (waitMs) => `Real users wait ${(waitMs / 1000).toFixed(1)} s on average in the leaking bucket's queue: it sends requests on at a fixed rate, so a typed search waits its turn.`,
    overQuota: (q, shared) => `Each key gets ${fmt(PER_MINUTE * q)} requests a minute through, not ${PER_MINUTE}.${shared ? '' : ' Each rate limiter keeps its own counts; connect them all to a counter store.'}`,
    levelComplete: levelComplete(10),
  },

  quiz: {
    passScore: 8,
    passText: passText(10, 'Consistent hashing'),
    failText,
    questions: [
      { q: 'Which is NOT a reason to rate limit an API?', o: ['Stop a flood from starving everyone else', 'Cut costs, such as paid third-party calls', 'Keep bots from overloading the servers', 'Make each request faster for real users'], a: 3, e: 'Rate limiting prevents resource starvation from denial-of-service floods, cuts costs, and protects servers from overload. It doesn\'t speed up the requests it lets through; at best it keeps the servers from slowing down.', r: 'Why limit how many requests a client sends?' },
      { q: 'Why not enforce the limit in the client app?', o: ['Clients cannot count requests', 'Anyone can change or fake a client', 'Clients would need Redis', 'HTTP has no status code for a blocked request'], a: 1, e: 'A client is easy to forge or modify, and you may not control it. Limits must be enforced where you control the code: on your servers or in a gateway.', r: 'Where does the limit go, and what does a blocked client see?' },
      { q: 'What does the API return for a request over the limit?', o: ['200 with an empty body', '503 Service Unavailable', '429 Too Many Requests', '404 Not Found'], a: 2, e: 'HTTP 429 means too many requests. Headers such as X-Ratelimit-Remaining, X-Ratelimit-Limit and X-Ratelimit-Retry-After tell the client where it stands.', r: 'Where does the limit go, and what does a blocked client see?' },
      { q: 'A token bucket holds 5 tokens and gets 1 more a second. It is full. How many requests pass in one instant?', o: ['1', '5', '6', '60'], a: 1, e: 'Each request takes a token, so a full bucket lets 5 through at once; the rest wait for refills, one a second. That burst allowance is the token bucket\'s strength.', r: 'How does a token bucket work?' },
      { q: 'What is the main drawback of a fixed window counter?', o: ['Edge bursts can pass twice the limit', 'It needs a timestamp for every request', 'It cannot use Redis for its counters', 'It processes requests at one fixed rate'], a: 0, e: 'Six a minute, with 6 sent at 9:15:50 and 6 at 9:16:10: each clock minute sees 6, but the minute from 9:15:30 to 9:16:30 sees 12.', r: 'How do bots get past a fixed window?' },
      { q: 'A sliding window counter allows 10 a minute. Last minute had 6 requests, this minute has 4, and we are 40% into it. Is a new request allowed?', o: ['No: 10 in the window', 'No: 11 in the window', 'Yes: 4 in the window', 'Yes: 7 in the window'], a: 3, e: 'Count 4 + 6 × 60% overlap = 7.6, so 7 after rounding down, under 10: allowed.', r: 'How does a sliding window close the gap?' },
      { q: 'Which algorithm is exact in every rolling window but uses the most memory?', o: ['Fixed window counter', 'Sliding window log', 'Token bucket', 'Sliding window counter'], a: 1, e: 'The log keeps a timestamp for every request, even rejected ones, so it is exact but memory-hungry.', r: 'How does a sliding window close the gap?' },
      { q: 'Where do limiters usually keep their counters?', o: ['In each limiter\'s own memory', 'In a relational database table on the API servers\' disks', 'In a shared in-memory store such as Redis', 'In a cookie on the client'], a: 2, e: 'Counters need to be fast and to expire: an in-memory store with INCR and EXPIRE. Shared across limiters, each key is counted once.', r: 'Why must rate limiters share their counters?' },
      { q: 'A counter is at 7. Two requests read it at the same moment and both write 8. What went wrong?', o: ['A race condition: one increment was lost', 'The counter expired too early', 'The token bucket was too small', 'Sticky sessions sent both of them to one limiter'], a: 0, e: 'Both read 7 before either wrote, so the count ends at 8 instead of 9. Locks fix it but are slow; atomic operations such as a Lua script or Redis sorted sets are the usual fix.', r: 'How can two requests slip past the same counter?' },
      { q: '300 keys each may send 2 requests a second. Real traffic is 1,200 req/s. A limiter checks 5,000 req/s. The bots send 15 a second per key. How many limiters?', o: ['1', '3', '2', '4'], a: 2, e: 'Bots: 300 × 15 = 4,500 req/s. With the real 1,200 that is 5,700 to check, more than one limiter\'s 5,000: two limiters.', r: 'How many rate limiters do you need?' },
    ],
  },

  lesson,

  // Lesson diagrams. `f` provides the engine's drawing helpers. Each figure sets its own viewBox.
  drawFigures(f) {
    const { $, svgEl, figNode, figArrow, figSvg, figLabel } = f;

    // A bucket of tokens with a tap that refills it: a request takes a token and passes, or finds none and gets 429.
    const f1 = figSvg($('figBucket'), 300);
    figNode(f1, 'users', 110, 185, 'Requests', 'One token each');
    figNode(f1, 'web', 530, 185, 'API servers', 'Get the request');
    svgEl('path', { d: 'M260 110 V260 H380 V110', class: 'd-line' }, f1);
    for (let k = 0; k < tb.size; k++) svgEl('circle', { cx: 276 + (k % 5) * 22, cy: 240 - Math.floor(k / 5) * 22, r: 7, class: 'ch-pt' }, f1);
    figArrow(f1, 320, 30, 320, 100, `+${tb.refill} tokens a second`, null, 332, 62);
    figArrow(f1, 384, 112, 436, 112, `over ${tb.size}: thrown away`, null, 444, 116);
    figArrow(f1, 204, 170, 256, 170, 'request', null, 230, 160, 'middle');
    figArrow(f1, 256, 214, 204, 214, '429', null, 230, 234, 'middle');
    figArrow(f1, 384, 185, 436, 185, 'passes', null, 410, 175, 'middle');
    figLabel(f1, 320, 284, `Bucket: up to ${tb.size} tokens`);

    // Two clock minutes, each counting its own requests: a full quota at the end of one and the start of the next.
    const f2 = figSvg($('figEdge'), 290);
    const base = 190, top = base - 110;
    for (const [n, x] of [[1, 20], [2, 324]]) {
      svgEl('rect', { x, y: 10, width: 296, height: 200, rx: 12, class: 'tier-box' }, f2);
      figLabel(f2, x + 14, 30, `Minute ${n}: counts ${fw.limit}`, 'start', 'tier-label');
    }
    for (const x of [282, 330]) {
      svgEl('rect', { x, y: top, width: 28, height: base - top, class: 'ch-area' }, f2);
      figLabel(f2, x + 14, top - 8, `${fw.limit}`, 'middle', 'ch-t');
    }
    svgEl('line', { x1: 30, y1: base, x2: 610, y2: base, class: 'ch-axis' }, f2);
    for (const [x, t, a] of [[20, '0:00', 'start'], [320, '1:00', 'middle'], [620, '2:00', 'end']]) figLabel(f2, x, 228, t, a, 'ch-t');
    svgEl('path', { d: 'M180 244 V256 H460 V244', class: 'ch-axis', fill: 'none' }, f2);
    figLabel(f2, 320, 278, `${fw.limit * 2} requests in 60 seconds`, 'middle', 'ch-cap-t');

    // Two limiters read the same count at once and both write it plus one: one update is lost.
    const f3 = figSvg($('figRace'), 310);
    figNode(f3, 'limiter', 130, 60, 'Rate limiter 1', 'Request 1');
    figNode(f3, 'limiter', 510, 60, 'Rate limiter 2', 'Request 2');
    figNode(f3, 'counter', 320, 220, 'Shared counter', 'Was 7, now 8');
    figArrow(f3, 250, 190, 170, 90, 'read 7', null, 196, 144, 'end');
    figArrow(f3, 200, 90, 280, 190, 'write 8', null, 254, 144);
    figArrow(f3, 390, 190, 470, 90, 'read 7', null, 444, 144);
    figArrow(f3, 440, 90, 360, 190, 'write 8', null, 386, 144, 'end');
    figLabel(f3, 320, 290, 'Two requests passed. The count went up by one.');

    drawBuilt(f, $('figBuilt'));
    drawBuilt(f, $('figBuiltEnd'));
  },

};
