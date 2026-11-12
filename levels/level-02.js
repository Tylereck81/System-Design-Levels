// @ts-check
/** @import { Level, Goal, Lesson } from '../js/types.js' */
// Level 2: Load balancer and horizontal scaling.
// Everything specific to this level lives here: components, rules, missions, quiz and text.
import { servedGoal, latGoal, costGoal, servedAtLeast } from './shared/goals.js';
import { dns, lb, NO_DB_NOTE, db } from './shared/components.js';
import { dnsLookup, usersToLb, lbToWeb, webToDb, lbBad } from './shared/connections.js';
import { lbText, levelComplete } from './shared/text.js';
import { ONE_DNS, TWO_LBS } from './shared/limits.js';
import { failText, passText } from './shared/quiz.js';
import { LB_PUBLIC_IP, WEB_PRIVATE_IPS } from './shared/addresses.js';
import { fmt, count, percent, ms, rate } from '../js/format.js';
import { SIZES, T, COMPONENTS, SLOWDOWN_CAP_FROM, qmul } from '../js/engine/catalog.js';

const targets = { latencyMs: 150, servedPct: 99 };
/** Size of the web server the level starts with: Level 1's launch-day server. */
const START_WEB_SIZE = 'L';
/** Peak traffic before (Mission 1) and after (Missions 2 and 3) the partner app's users arrive, in req/s. */
const PEAK = { before: 463, after: 1204 };

/** @type {Goal} */
const sharedDbGoal = { id: 'shared', type: 'struct', text: 'Every web server uses the shared database', test: (g) => g.everyReaches('web', 'db') };
const served99 = servedAtLeast(targets.servedPct);
const TIER = { db: 'database', lb: 'load balancer' }; // names for the bottleneck message
/**
 * The load balancer that reaches the fewest web servers on the path, and how many it reaches (of total). Every load
 * balancer must reach every web server, or the standby can't carry the site when it takes over.
 */
function fewestReached(g) {
  const lbs = g.entry.filter((n) => n.type === 'lb'), total = g.onPath('web').length; // the first one Users reach is active
  let worst = null, n = Infinity;
  for (const x of lbs) { const k = g.reached(x, 'web'); if (k < n) { n = k; worst = x; } }
  return { lb: worst, n: worst ? n : 0, total, standby: !!worst && lbs.length > 1 && worst !== lbs[0] };
}
const standbyReady = (g) => { const f = fewestReached(g); return g.count('lb') >= 2 && f.total > 0 && f.n === f.total; };


// ---------------- Lesson ----------------
const { S, M, L } = SIZES;
const sizeNames = Object.keys(SIZES);
const lbRules = COMPONENTS.lb;
const queriesPerRequest = COMPONENTS.db.kinds.sql.per;
const sharedCapacity = COMPONENTS.web.alone.capFactor;


// Step 1's table: the same capacity bought as one big server or as several smaller ones.
const side = { count: L.cap / M.cap }; // how many M servers make one L: 2
side.cost = side.count * M.cost;
side.left = (side.count - 1) * M.cap;

// Step 3's example: N + 1 on M servers. The 900 req/s peak is our example load, not a game number.
const spare = { peak: 900, cap: M.cap };
spare.n = Math.ceil(spare.peak / spare.cap);
spare.left = spare.n * spare.cap; // what the pool carries after one of its n + 1 servers crashes
// Step 3's question: the same sum with a 2,500 req/s peak (also ours).
const turn = { peak: 2500, cap: M.cap };
turn.n = Math.ceil(turn.peak / turn.cap);

// Step 4's question: round robin over one L and one S server, with 800 req/s arriving (our example load).
const mixed = { load: 800, total: L.cap + S.cap };
mixed.each = mixed.load / 2;
mixed.dropped = mixed.each - S.cap;

// Step 5's example: a ticket site (our numbers), sized on S servers, with the database checked last.
const est = { users: 1500000, each: 24 };
est.day = est.users * est.each;
est.avg = est.day / 86400;
est.peak = est.avg * 2;
est.n = Math.ceil(est.peak / S.cap);
est.queries = est.peak * queriesPerRequest;
est.dbSize = sizeNames.find((name) => SIZES[name].cap >= est.queries); // the smallest database that carries it
est.tooSmall = sizeNames[sizeNames.indexOf(est.dbSize) - 1]; // the size below it

// Step 7's sums. The availabilities are ours: 99.9% is Level 1's example, 95% is the question's.
const HOURS_A_YEAR = 365.25 * 24;
const one = { up: 0.999 };
one.down = 1 - one.up;
one.bothDown = one.down * one.down;
const two = { up: 0.95 };
two.bothDown = (1 - two.up) * (1 - two.up);

/** @type {Lesson} */
const lesson = {
  kicker: 'Level 2 · Scaling out',
  title: 'Load balancer and horizontal scaling',
  promise: `Launch day ran on one ${START_WEB_SIZE} server, until it crashed and took example.com down with it. By the end of this level you will know how to spread traffic over a pool of servers, how many to run, and how to keep the site up when a server or the load balancer dies.`,
  minutes: 11,
  steps: [
    {
      title: 'Why not just rent a bigger server?',
      // "The next size up is also the last size" is checked in tests/unit/level-02-lesson.test.mjs.
      hook: `Your one ${START_WEB_SIZE} server crashed on launch day and the whole site went with it. You could rent the next size up. It is also the last size, and it would still be one machine.`,
      body: [
        { p: `Run several smaller servers side by side, and add more as traffic grows. That is <b>horizontal scaling</b>, or <b>scaling out</b>. Here are two ways to buy ${rate(L.cap)}:` },
        { table: { head: ['Design', 'Capacity', 'Cost / month', 'Left after one crash'], num: true, rows: [
          ['1 × L', rate(L.cap), `$${L.cost}`, rate(0)],
          [`${side.count} × M`, rate(side.count * M.cap), `$${side.cost}`, rate(side.left)],
        ] } },
        { p: 'Scaling out removes both walls from Level 1. There is no biggest size: you add another server. And one crash no longer takes everything.' },
        { p: 'The price: several servers need something in front of them that decides which one handles each request. That is the <b>load balancer</b>.' },
        { assume: 'In this game smaller servers are also cheaper for the same capacity. Real prices vary, so do not promise that in an interview.' },
      ],
      takeaway: 'Scaling out has no size ceiling, and one server can fail without taking the site down.',
      missions: [0],
      quiz: [4],
    },
    {
      title: 'How do users reach many servers through one address?',
      hook: 'You now run two web servers, but <b>example.com</b> can only send people to one place. Which address does DNS hand out, and who decides which server answers?',
      body: [
        {
          figure: 'figLb',
          alt: `Users look up example.com in DNS and get the load balancer's public IP, ${LB_PUBLIC_IP}. They send HTTP requests to the load balancer, which forwards each one to a web server on a private IP, ${WEB_PRIVATE_IPS.join(' or ')}.`,
          caption: 'One public address in front, private addresses behind',
        },
        { ol: [
          `DNS now answers <code>example.com</code> with the <b>load balancer's public IP</b>, <code>${LB_PUBLIC_IP}</code>.`,
          'Every request goes to the load balancer. It picks a web server and forwards the request over the private network.',
          `The web servers have <b>private IPs</b>, such as <code>${WEB_PRIVATE_IPS.join('</code> and <code>')}</code>. A private IP works only inside your own network: nothing on the internet can reach it.`,
        ] },
        { p: 'So users can no longer reach a web server directly. Only the load balancer can. That keeps the servers out of direct reach and makes them interchangeable: users see one address, however many servers sit behind it.' },
        { p: 'The private ranges are <code>10.0.0.0/8</code>, <code>172.16.0.0/12</code> and <code>192.168.0.0/16</code>.' },
      ],
      takeaway: 'Users talk to one public address, and the load balancer passes each request to a server on a private one.',
      missions: [0],
      quiz: [0, 1],
    },
    {
      title: 'What happens when a web server dies?',
      hook: 'It is 2 a.m. and one of your web servers stops answering. Nobody is awake to fix it. Do your users see errors?',
      body: [
        { p: 'The load balancer sends each server a request every few seconds: a <b>health check</b>. A server that stops answering gets no more traffic, and the healthy ones share its load.' },
        { p: `The servers left must then carry the whole peak. Plan for <b>N + 1</b>: N servers for the peak, plus one spare. At a peak of ${rate(spare.peak)} on M servers:` },
        {
          calc: {
            formula: 'Servers = peak ÷ what one server carries, rounded up, + 1 spare.',
            rows: [
              { label: 'For the peak', work: `${rate(spare.peak)} ÷ ${rate(spare.cap)} per server`, result: `${spare.peak / spare.cap}, so ${spare.n} servers` },
              { label: 'Add the spare', work: `${spare.n} servers + 1 spare`, result: `${spare.n + 1} servers` },
              { label: 'One crashes', work: `${spare.n} servers × ${rate(spare.cap)}`, result: rate(spare.left) },
            ],
            result: `With one down, the pool still carries ${rate(spare.left)}, above the ${rate(spare.peak)} peak. Those ${spare.n} run ${percent(spare.peak / spare.left)} busy: slower, but nothing fails.`,
          },
        },
        { assume: 'Game rule: a dead server is noticed at once. Real health checks take a few seconds, and some requests fail meanwhile.' },
      ],
      check: {
        kind: 'turn',
        q: `The peak is ${rate(turn.peak)} and each server handles ${rate(turn.cap)}. What is the fewest servers that still serve everything after one crashes?`,
        options: [
          { t: `${turn.n}`, why: `${fmt(turn.peak)} ÷ ${turn.cap} = ${turn.peak / turn.cap}, so ${turn.n} carry the peak. But when one crashes ${turn.n - 1} are left: ${turn.n - 1} × ${turn.cap} = ${rate((turn.n - 1) * turn.cap)}, less than ${rate(turn.peak)}.` },
          { t: `${turn.n + 1}`, right: true, why: `${fmt(turn.peak)} ÷ ${turn.cap} = ${turn.peak / turn.cap}, so ${turn.n} servers carry the peak, plus 1 spare = ${turn.n + 1}. After a crash, ${turn.n} × ${turn.cap} = ${rate(turn.n * turn.cap)} still covers it.` },
          { t: `${turn.n * 2}`, why: `A whole second set survives a crash, but you pay for ${turn.n * 2 - (turn.n + 1)} servers you do not need. One spare covers one failure.` },
        ],
      },
      takeaway: 'Run one more server than the peak needs, so that any one of them can fail: N + 1.',
      missions: [0, 1],
      quiz: [2, 3],
    },
    {
      title: 'Which server gets the next request?',
      hook: 'Your pool has one L server and one S server. The load balancer deals requests out like cards: one for you, one for you. Is that fair?',
      check: {
        kind: 'guess',
        q: `Round robin spreads ${rate(mixed.load)} over one L server (${rate(L.cap)}) and one S server (${rate(S.cap)}). What happens?`,
        options: [
          { t: `Nothing fails: together they can handle ${rate(mixed.total)}`, why: `The total is enough, but round robin does not look at size. Each server gets ${rate(mixed.each)}, and the S can only serve ${fmt(S.cap)}.` },
          { t: `The S server gets ${rate(mixed.each)} and drops ${fmt(mixed.dropped)} of them`, right: true, why: `Round robin gives each server the same share: ${fmt(mixed.load)} ÷ 2 = ${rate(mixed.each)}. The S serves ${fmt(S.cap)} and the other ${fmt(mixed.dropped)} fail. That is ${percent(mixed.dropped / mixed.load)} of all requests, while the L is only ${percent(mixed.each / L.cap)} busy.` },
          { t: `The L gets ${rate(mixed.load * L.cap / mixed.total)} and the S gets ${fmt(mixed.load * S.cap / mixed.total)}`, why: `That is what a weighted method does: shares follow size (${fmt(mixed.load)} × ${fmt(L.cap)} ÷ ${fmt(mixed.total)} = ${fmt(mixed.load * L.cap / mixed.total)}). Plain round robin gives both the same.` },
        ],
      },
      body: [
        { table: { head: ['Method', 'How it picks', 'Use it when'], rows: [
          ['<b>Round robin</b>', 'Each server in turn, so each gets the same share', 'All servers are the same size'],
          ['<b>Weighted</b>', 'In turn, but a bigger server gets a bigger share', 'You mix sizes'],
          ['<b>Least connections</b>', 'The server with the fewest requests in progress', 'Some requests take much longer than others'],
        ] } },
        { p: 'With plain round robin and mixed sizes, the smallest server overloads first, even when the pool as a whole has room. Keep a pool to one size, or change the method.' },
        { p: 'Growing the pool needs no downtime: add a server, and the load balancer starts sending it requests.' },
        { assume: 'Game rule: round robin is the default. Weighted and least connections both share traffic in proportion to each server\'s capacity. You pick the method on the load balancer.' },
      ],
      takeaway: 'Round robin is only fair when every server in the pool is the same size.',
      missions: [0, 1],
      quiz: [5],
    },
    {
      title: 'How many servers does the new traffic need?',
      hook: 'A partner app is about to send you its users. You are told how many people, not how many requests a second. And the web servers are not the only thing the new traffic will hit.',
      check: {
        kind: 'guess',
        q: 'Traffic doubles, so you double the number of web servers. What happens to the load on the one database behind them?',
        options: [
          { t: 'It stays the same: the extra web servers absorb it', why: 'Every request still needs a database query. More requests through the web servers means more queries behind them.' },
          { t: 'It doubles too', right: true, why: 'Every request needs a query, so the database\'s load follows the traffic, however many web servers share the web work. The pool can grow sideways; the one database can only get bigger.' },
          { t: 'It halves, because the work is shared out', why: 'The web servers share the web work between them. They all send their queries to the same database.' },
        ],
      },
      body: [
        { p: `Estimate the peak first, as in Level 1. Size the pool with N + 1. Then check the database: every request still needs ${queriesPerRequest} query from it. Take a ticket site with ${count(est.users)} daily users, each making ${est.each} requests a day:` },
        {
          calc: {
            formula: 'Peak = daily users × requests per user per day ÷ 86,400 × 2. Servers = peak ÷ what one server carries, rounded up, + 1 spare.',
            rows: [
              { label: 'Requests a day', work: `${count(est.users)} users × ${est.each} requests a day`, result: `${count(est.day)} requests a day` },
              { label: 'Average', work: `${count(est.day)} requests ÷ 86,400 s`, result: rate(est.avg), approx: true },
              { label: 'Peak', work: `${rate(est.avg)} × 2`, result: rate(est.peak), approx: true },
              { label: 'Web servers', work: `${rate(est.peak)} ÷ ${rate(S.cap)} per S server`, result: `${(est.peak / S.cap).toFixed(1)}, so ${est.n} servers, and ${est.n + 1} with the spare`, approx: true },
            ],
            result: `The database gets ${fmt(est.queries)} queries/s. Size ${est.tooSmall} handles ${fmt(SIZES[est.tooSmall].cap)} queries/s, so it needs size ${est.dbSize} (${fmt(SIZES[est.dbSize].cap)} queries/s). The web tier grew by adding servers; the database could only move up a size.`,
          },
        },
      ],
      takeaway: 'Estimate the peak, size the pool with a spare, then check the one thing every request still shares: the database.',
      missions: [1],
      quiz: [8],
    },
    {
      title: 'What if the load balancer itself fails?',
      hook: 'Every web server now has a spare. But every request enters through one load balancer. If it stops, the site stops, however many servers are waiting behind it.',
      check: {
        kind: 'guess',
        q: 'The active load balancer dies and a standby takes over. How do users\' devices find the standby?',
        options: [
          { t: 'DNS is updated to point at the standby\'s own address', why: 'Devices keep a DNS answer for a while, so a DNS change would leave many of them sending requests to the dead machine. The standby takes over the same address instead.' },
          { t: 'They do not have to: the standby takes over the same public IP', right: true, why: 'Devices keep sending to the address they already know. The standby starts answering on it, so nothing changes for users and DNS stays as it was.' },
          { t: 'Each device already has both addresses and tries the second', why: 'That describes active-active, where DNS returns both addresses. A standby has no address that users know about until it takes over the active one\'s.' },
        ],
      },
      body: [
        {
          figure: 'figStandby',
          alt: `Users send requests to the active load balancer at ${LB_PUBLIC_IP}. A standby load balancer exchanges heartbeats with it and is connected to the same web servers, ready to take over the public IP.`,
          caption: 'Active and standby load balancers share one public IP',
        },
        { p: 'A part that is the only one of its kind on the request path is a <b>single point of failure</b>. The usual fix here is a <b>standby pair</b>:' },
        { ul: [
          'The <b>active</b> one handles all traffic. The <b>standby</b> is connected to the same web servers but handles none.',
          'The two send each other a <b>heartbeat</b>: a small "still alive" signal, every second or so.',
          `If the heartbeats stop for a few seconds, the standby takes over the public IP, <code>${LB_PUBLIC_IP}</code>. DNS does not change.`,
        ] },
        { p: 'The other option is <b>active-active</b>: both take traffic, but each must still be able to carry the whole load alone.' },
        { assume: 'Game rule: the takeover is instant. A real one takes a few seconds, and some requests fail meanwhile.' },
      ],
      takeaway: 'A standby load balancer listens for heartbeats and takes over the same public IP when they stop.',
      missions: [2],
      quiz: [6, 7],
    },
    {
      title: 'How much safer are two than one?',
      hook: `The interviewer points at your pool: "Each of these is up ${percent(one.up)} of the time. What do I get for paying for two?" Answer with a number, not with "it is more reliable".`,
      body: [
        { p: 'The site is down only when <b>every</b> copy is down at the same moment. If the copies fail <b>independently</b>, multiply their chances of being down:' },
        {
          calc: {
            formula: 'Chance that both are down = chance one is down × chance the other is down.',
            rows: [
              { label: 'One server down', work: `${percent(one.down)} of ${fmt(HOURS_A_YEAR)} hours a year`, result: `${(one.down * HOURS_A_YEAR).toFixed(2)} hours a year`, approx: true },
              { label: 'Both down at once', work: `${percent(one.down)} × ${percent(one.down)}`, result: `${percent(one.bothDown)} of the time` },
              { label: 'At least one up', work: `100% − ${percent(one.bothDown)}`, result: `${percent(1 - one.bothDown)} of the time` },
              { label: 'Two servers down', work: `${percent(one.bothDown)} of ${fmt(HOURS_A_YEAR)} hours a year`, result: `${Math.round(one.bothDown * HOURS_A_YEAR * 3600)} seconds a year`, approx: true },
            ],
            result: `One server is down about ${(one.down * HOURS_A_YEAR).toFixed(2)} hours a year. Two are down together about ${Math.round(one.bothDown * HOURS_A_YEAR * 3600)} seconds a year.`,
          },
        },
        { p: '"Independent" matters. Two servers on the same power supply, or updated by the same bad deploy, fail together, and the sum no longer holds.' },
        { p: 'Then follow one request through your design and name every part that has no copy. After a pool and a standby pair, one is left: the database. Level 3 deals with it.' },
      ],
      check: {
        kind: 'turn',
        q: `Two web servers are each up ${percent(two.up)} of the time and fail independently. How often is at least one of them up?`,
        options: [
          { t: percent(two.up * two.up), why: `That is ${percent(two.up)} × ${percent(two.up)}: how often <b>both</b> are up. The site only needs one of them.` },
          { t: percent(1 - two.bothDown), right: true, why: `Both are down ${percent(1 - two.up)} × ${percent(1 - two.up)} = ${percent(two.bothDown)} of the time, so at least one is up 100% − ${percent(two.bothDown)} = ${percent(1 - two.bothDown)}.` },
          { t: percent(two.up), why: 'That is one server on its own. A second, independent server covers most of the first one\'s downtime.' },
        ],
      },
      takeaway: 'Multiply the downtime of independent copies, then name the next part of the design that has no copy.',
      missions: [2],
      quiz: [6, 9],
    },
  ],
  recap: {
    numbers: [
      ['N + 1', 'servers to carry the peak, plus one spare'],
      ['1 public IP', 'all that users see, however many servers sit behind it'],
      ['Same share', 'what round robin gives each server, whatever its size'],
      ['86,400', 'seconds in a day; peak is about 2× the average'],
      [`${percent(one.up)} → ${percent(1 - one.bothDown)}`, 'one server → two independent servers'],
    ],
    // One line per mission, in mission order.
    bridge: [
      `You put a load balancer in front of a pool of web servers at ${rate(PEAK.before)}, then crash one server and watch the others take its share.`,
      `Traffic grows to ${rate(PEAK.after)}. You estimate the peak before Play unlocks, grow the pool and the database, and crash a server again.`,
      'You add a standby load balancer, crash the active one, and watch the standby keep the site up.',
    ],
  },
  rules: `The load balancer handles ${rate(lbRules.cap)}, adds ${ms(lbRules.base)} to each request and costs $${lbRules.cost} a month. Round robin gives every healthy web server the same share; weighted and least connections share by capacity. A crashed server gets no traffic, and its share moves to the others at once. A standby load balancer takes no traffic until the active one fails, then takes all of it. A web server that is not connected to the database keeps its own copy of the data and handles ${percent(sharedCapacity)} of its capacity. Web server work ${ms(T.web)}, database query ${ms(T.db)}, internet round trip ${ms(T.rtt)}, round trip inside the data center ${ms(T.dc)}. From ${percent(SLOWDOWN_CAP_FROM)} busy a request takes at most ${qmul(1)}× its base time; only load above 100% fails.`,
};

/** @type {Level} */
export default {
  id: 2,
  saveKey: 'sdl-level2-v1',
  saveVersion: 2, // 2: break-it results are kept per mission
  quizVersion: 1,
  targets,

  components: {
    users: { name: 'Users', sub: 'Web + mobile app', desc: 'Your visitors. They look up example.com in DNS, then send HTTP requests to the address DNS returns.' },
    dns: dns(),
    lb: lb(),
    web: {
      name: 'Web server', short: 'Your back-end code',
      desc: 'Runs your back-end code on a private IP (10.0.0.x). Only the load balancer can reach it. Every web server should use the same shared database.',
      noDbNote: NO_DB_NOTE,
    },
    db: db(),
  },
  palette: ['dns', 'lb', 'web', 'db'],
  limits: { dns: 1, lb: 2, web: 6, db: 1 },
  limitMsg: {
    dns: ONE_DNS,
    lb: TWO_LBS,
    web: 'Six web servers is the limit in this level.',
    db: 'One shared database is the limit here. Copies (replicas) arrive in Level 3.',
  },
  // Level 1's launch-day setup: one large web server and its database. Users can no longer reach it directly.
  startNodes: [
    { id: 'u', type: 'users', x: 380, y: 64 },
    { id: 'd', type: 'dns', x: 640, y: 64 },
    { id: 'w1', type: 'web', x: 380, y: 280, size: START_WEB_SIZE },
    { id: 'b', type: 'db', x: 380, y: 456, size: 'L', kind: 'sql' },
  ],
  startEdges: [{ id: 's1', from: 'u', to: 'd' }, { id: 's2', from: 'w1', to: 'b' }],
  // The second load balancer, a standby, goes beside the first in the same row.
  slots: { dns: { x: 640, y: 64 }, lb: [{ x: 380, y: 172 }, { x: 640, y: 172 }], web: { x: 380, y: 280 }, db: { x: 380, y: 456 } },

  connections: {
    ok: {
      'dns|users': dnsLookup(),
      'lb|users': usersToLb(),
      'lb|web': lbToWeb(),
      'db|web': webToDb(),
    },
    bad: lbBad(),
  },

  missions: [
    {
      title: 'One address, many servers', ref: 'Load balancer', qps: PEAK.before, budget: 500,
      story: `Launch day ran on one large server, until it crashed and took example.com down with it. Traffic is the same, ${fmt(PEAK.before)} req/s at peak. Put a load balancer in front and spread the traffic over several web servers, so one crash no longer takes the site offline.`,
      goals: [
        { id: 'lb', type: 'struct', text: 'Users reach the web servers through a load balancer', test: (g) => g.count('lb') >= 1 && g.everyReaches('lb', 'web') },
        { id: 'pool', type: 'struct', text: 'At least two web servers behind it', test: (g) => g.count('web') >= 2 },
        sharedDbGoal,
        servedGoal(targets), latGoal(targets), costGoal(500),
        { id: 'crash-web', type: 'exp', text: 'Break it: crash a web server and still serve at least 99%' },
      ],
      hint: `Add a load balancer and connect Users to it, then connect it to each web server, and each web server to the database. With round robin every server gets the same share, so use one size (or pick weighted or least connections in the load balancer). When your biggest server crashes, the others must carry all ${fmt(PEAK.before)} req/s between them. Several small servers cost less than a few big ones.`,
      takeaway: 'A server crashed and the site stayed up: the load balancer stopped sending it requests and the others took its share. That only works when the servers left can carry the whole peak. Plan for one more than you need: N + 1.',
    },
    {
      title: 'Traffic doubles', ref: 'Scaling out', qps: PEAK.after, budget: 950,
      gate: {
        lo: 1000, hi: 1400,
        prompt: '<b>Estimate before you build.</b> Peak QPS = DAU × requests per user per day ÷ 86,400, then × 2 for peak.',
        label: 'Peak req/s',
        placeholder: 'e.g. 1,000',
        acceptedHtml: '<p><b>Estimate accepted.</b></p><div class="calc">2,600,000 DAU × 20 req ÷ 86,400 s ≈ 602 req/s average<br>Peak ≈ 2 × 602 ≈ 1,204 req/s</div>',
        acceptedLog: 'Estimate accepted: about 1,204 req/s at peak. Play is unlocked.',
        notNumber: 'Type the estimate as a number, for example 1,000.',
        hints: [
          { test: (v) => v >= 500 && v <= 700, text: 'That is the average. Peak traffic is about twice the average.' },
          { test: (v) => v > 20000, text: 'Too high. Did you forget to divide by 86,400 seconds in a day?' },
        ],
        fallback: 'Not quite. Work it out: 2,600,000 × 20 ÷ 86,400, then double it for peak. Rounded answers are fine.',
      },
      story: 'A partner app now sends you its users: 2,600,000 daily active users, about 20 requests each, and peak traffic is about twice the average. Estimate the new peak, then grow the pool. You can run up to six web servers.',
      goals: [
        { id: 'est', type: 'gate', text: 'Estimate the new peak traffic' },
        sharedDbGoal,
        servedGoal(targets), latGoal(targets), costGoal(950),
        { id: 'crash-web', type: 'exp', text: 'Break it: crash a web server and still serve at least 99%' },
      ],
      hint: 'Every request still reaches the one database, so check it first: a large database handles 800 queries/s. Then add web servers until each is well under 75% busy, plus one spare for the crash test. Same-size servers are simplest; with mixed sizes, switch the load balancer to weighted or least connections.',
      takeaway: 'You grew the web tier one server at a time, and the spare kept the site up during a crash. The database could only grow bigger: it is now 75% busy, and still a single point of failure. Level 3 fixes that with replicas.',
    },
    {
      title: 'The load balancer is the new single point of failure', ref: 'Standby pair', qps: PEAK.after, budget: 1000,
      story: 'Every web server now has a spare, but all traffic still enters through one load balancer. If it stops, example.com stops. Add a second load balancer as a standby: the pair send each other heartbeats, and if the active one goes quiet, the standby takes over its public IP.',
      goals: [
        {
          id: 'standby', type: 'struct', text: 'A standby load balancer is ready, connected to every web server', test: standbyReady,
          val: (m, g) => { const f = fewestReached(g); return g.count('lb') >= 2 && f.n < f.total ? `reaches ${f.n} of ${f.total}` : ''; },
        },
        sharedDbGoal,
        servedGoal(targets), latGoal(targets), costGoal(1000),
        { id: 'crash-lb', type: 'exp', text: 'Break it: crash the load balancer and still serve at least 99%' },
      ],
      hint: 'Add a second load balancer, connect Users to it and connect it to every web server. It takes no traffic while the first one is healthy, and takes over all of it when the first one fails.',
      takeaway: 'With a standby load balancer and a spare web server, any one machine in the web tier can fail without taking the site down. The database is the last single point of failure, and it is 75% busy. Level 3 adds database replication.',
    },
  ],

  // Break-it experiments. A crash takes down the component `target` picks when it starts, or the one of its `targets`
  // whose loss hurts most. `expect` is the outcome that must hold, at peak traffic, for the whole run before it counts.
  experiments: [
    {
      // Any web server could fail; the test takes down the one the others can least cover for.
      id: 'crash-web', kind: 'crash', targets: (g) => g.onPath('web'),
      label: 'Crash web server', labelOn: 'Restart web server',
      needsDesign: 'Build the design first: connect Users to the load balancer and the load balancer to the web servers, then crash one.',
      on: 'You pulled the plug on the web server the site can least afford to lose.', onTone: 'bad',
      off: 'Web server restarted.',
      expect: served99,
      notMet: (m) => (m.bottleneck && m.bottleneck.type !== 'web'
        ? `Only ${m.servedPct.toFixed(1)}% served with one web server down, but the web servers keep up: the ${TIER[m.bottleneck.type] || 'next server'} is the bottleneck. Give it more capacity.`
        : `Only ${m.servedPct.toFixed(1)}% served with one web server down: the servers left cannot carry the peak. Add a spare web server (N + 1).`),
      issue: 'The only web server behind the load balancer is down, so every request fails.',
      observed: (m) => `Observed: one web server down, ${m.servedPct.toFixed(1)}% still served. The load balancer stopped sending it requests and the others took its share.`,
    },
    {
      id: 'crash-lb', kind: 'crash', target: (g) => g.entry.find((n) => n.type === 'lb') || null,
      label: 'Crash load balancer', labelOn: 'Restart load balancer',
      needsDesign: 'Build the design first: connect Users to a load balancer and the load balancer to the web servers, then crash it.',
      on: 'You pulled the plug on the active load balancer.', onTone: 'bad',
      off: 'Load balancer restarted.',
      expect: served99,
      notMet: (m) => {
        const f = fewestReached(m.g);
        if (m.g.count('lb') >= 2 && f.n < f.total) return `${m.servedPct.toFixed(0)}% served. Connect the ${f.standby ? 'standby' : 'active load balancer'} to every web server: it reaches ${f.n} of ${f.total}.`;
        return `${m.servedPct.toFixed(0)}% served: every request enters through the load balancer, so it is a single point of failure. Add a standby load balancer connected to every web server.`;
      },
      issue: 'The load balancer is down and nothing takes over, so every request fails.',
      observed: 'Observed: the standby noticed the missing heartbeats, took over the public IP and kept the site up.',
    },
  ],

  // Messages the engine shows for this level's design.
  text: { ...lbText(), levelComplete: levelComplete(2) },

  quiz: {
    passScore: 8,
    passText: passText(2, 'database replication'),
    failText,
    questions: [
      { q: 'You put a load balancer in front of your web servers. Which IP does DNS now give users\' devices for example.com?', o: ['The private IP of the first web server', 'The load balancer\'s public IP', 'A web server IP picked at random', 'The database server\'s IP'], a: 1, e: 'Devices connect to the load balancer\'s public IP. The load balancer then forwards each request to a web server over the private network, so users never see the web servers.', r: 'Load balancing' },
      { q: 'Why are the web servers on private IPs once a load balancer is in front?', o: ['Only machines inside the network can reach them', 'Private IPs make every request faster', 'So DNS can cache all of their addresses', 'So each server can store more of the data'], a: 0, e: `A private IP (for example ${WEB_PRIVATE_IPS[0]}) cannot be reached from the internet. Only the load balancer and other servers inside the network can talk to the web servers, which keeps them out of direct reach.`, r: 'Private addresses · RFC 1918' },
      { q: 'One of three web servers starts failing its health check. What does the load balancer do?', o: ['Sends that server\'s share to the database', 'Keeps sending it requests until it is fixed', 'Stops using it; the other two share the load', 'Restarts the server and waits for it to return'], a: 2, e: 'The load balancer checks each server regularly and stops sending requests to one that fails. The healthy servers share its traffic until it is fixed or replaced.', r: 'Health checks and failover' },
      { q: 'Each web server can serve at most 300 req/s. What is the fewest servers that still serve every request at a 1,000 req/s peak after one crashes?', o: ['3', '4', '6', '5'], a: 3, e: '1,000 ÷ 300 = 3.3, so 4 servers carry the peak. One more lets you lose any server and still have 4: that is N + 1 = 5.', r: 'N + 1 capacity' },
      { q: 'What does scaling out give you that scaling up cannot?', o: ['A faster response from each server', 'No size ceiling, and one server can fail safely', 'A database that never has to grow', 'Cheaper DNS lookups for every user in every country'], a: 1, e: 'Scaling up stops at the biggest machine you can buy, and that one machine is still a single point of failure. Scaling out adds servers behind a load balancer: no fixed ceiling, and one server can fail without taking the site down.', r: 'Scaling up vs scaling out' },
      { q: 'Round robin spreads 600 req/s over one M server (400 req/s) and one S server (200 req/s). What happens?', o: ['Both servers end up 75% busy', 'The M gets 400 req/s and the S gets 200', 'The S gets 300 and drops about 100 of them', 'Nothing fails, since 600 is exactly their capacity'], a: 2, e: 'Round robin gives each server the same share, 300 req/s. The S server can only serve 200, so about 100 requests a second fail (17%) even though the total capacity looks big enough. Use same-size servers, or a weighted method.', r: 'Load-balancing methods' },
      { q: 'A design has one load balancer, three web servers and one database. Which are single points of failure?', o: ['The load balancer and the database', 'Only the database', 'Each of the three web servers', 'None, because there are three servers'], a: 0, e: 'The three web servers back each other up. The load balancer and the database are each the only one of their kind, so either one failing takes the site down.', r: 'Single points of failure' },
      { q: 'How does a standby load balancer know it should take over?', o: ['The web servers elect a new one', 'Users report the errors to it', 'DNS moves the name to its IP', 'It stops getting heartbeats'], a: 3, e: 'The two load balancers send each other heartbeats, small regular "I am alive" signals. When the standby stops hearing them for a few seconds, it takes over the active one\'s public IP.', r: 'Active-passive failover' },
      { q: '4,000,000 daily users make about 15 requests each. Roughly what is the peak QPS?', o: ['~690', '~140', '~1,390', '~13,900'], a: 2, e: '4M × 15 ÷ 86,400 s ≈ 694 requests per second on average. Peak is about 2 × the average, so ≈ 1,390. Picking ~690 means you stopped at the average.', r: 'Estimating QPS' },
      { q: 'Two web servers are each up 99% of the time and fail independently. How often is at least one up?', o: ['99%', '99.99%', '98%', '99.5%'], a: 1, e: 'Both are down at once only 1% × 1% = 0.01% of the time, so at least one is up 99.99% of the time: about 53 minutes of downtime a year instead of 3.65 days. This only holds if their failures are independent.', r: 'Availability arithmetic' },
    ],
  },

  lesson,

  // Lesson diagrams. `f` provides the engine's drawing helpers.
  drawFigures(f) {
    const { $, figNode, figArrow, figDefs, figLabel, figDash } = f;

    const f1 = $('figLb'); f1.textContent = ''; figDefs(f1);
    figNode(f1, 'users', 104, 50, 'Users', 'Browser + app');
    figNode(f1, 'dns', 104, 205, 'DNS', 'example.com?');
    figNode(f1, 'lb', 320, 128, 'Load balancer', `Public ${LB_PUBLIC_IP}`);
    figNode(f1, 'web', 536, 50, 'Web server', `Private ${WEB_PRIVATE_IPS[0]}`);
    figNode(f1, 'web', 536, 205, 'Web server', `Private ${WEB_PRIVATE_IPS[1]}`);
    figArrow(f1, 104, 82, 104, 173, 'lookup', '1', 118, 132);
    figArrow(f1, 168, 82, 240, 96, 'HTTP', '2', 208, 70);
    figArrow(f1, 400, 96, 472, 82, 'forward', '3', 418, 72);
    figArrow(f1, 400, 160, 472, 173, 'forward', null, 372, 190);

    const f2 = $('figStandby'); f2.textContent = ''; figDefs(f2);
    figNode(f2, 'users', 104, 128, 'Users', `to ${LB_PUBLIC_IP}`);
    figNode(f2, 'lb', 320, 50, 'Load balancer', 'Active · has the IP');
    figNode(f2, 'lb', 320, 205, 'Load balancer', 'Standby · waiting');
    figNode(f2, 'web', 536, 128, 'Web servers', 'Private IPs');
    figArrow(f2, 168, 112, 240, 70, 'HTTP', null, 190, 82);
    figArrow(f2, 300, 82, 300, 173, 'heartbeat', null, 288, 132, 'end');
    figArrow(f2, 340, 173, 340, 82, '', null, 352, 132);
    figArrow(f2, 400, 70, 472, 112, 'forward', null, 438, 80);
    figDash(f2, 'M400 186 L472 146');
    figLabel(f2, 438, 196, 'if it takes over', 'start');
  },
};
