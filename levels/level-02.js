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
import { LB_PUBLIC_IP, WEB_PRIVATE_IPS, WEB_PRIVATE_IP_RANGE } from './shared/addresses.js';
import { fmt, count, percent, ms, rate } from '../js/format.js';
import { SIZES, COMPONENTS } from '../js/engine/catalog.js';
import { STEPS } from './mock-steps.js';

const targets = { latencyMs: 150, servedPct: 99 };
/** Size of the web server the level starts with: Level 1's launch-day server. */
const START_WEB_SIZE = 'L';
/** Peak traffic before (Mission 1) and after (Missions 2 and 3) the partner app's users arrive, in req/s. */
const PEAK = { before: 463, after: 1204 };
/** Monthly budget of each mission, in dollars. */
const BUDGET = { pool: 500, grow: 950, pair: 1000 };
/** The most web servers a design may have. */
const MAX_WEB = 6;

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
const { S, M, L, XL } = SIZES;
const [scope, sketch, deep, stress] = STEPS.map((step) => `<b>${step.name}</b>`);

// N + 1 example (our load, not a game number): M servers under a 900 req/s peak.
const spare = { peak: 900, size: M };
spare.n = Math.ceil(spare.peak / spare.size.cap);
// Check yourself: the same sum with other numbers.
const spareCheck = { peak: 2500, size: L };
spareCheck.n = Math.ceil(spareCheck.peak / spareCheck.size.cap);

// "The same capacity, bought four ways": XL's capacity from each size, largest first.
const sameCap = XL.cap;
const buyRows = Object.entries(SIZES).reverse().map(([name, size]) => {
  const n = sameCap / size.cap;
  return [`${n} × ${name}`, `$${fmt(n * size.cost)}`, n === 1 ? 'nothing' : rate((n - 1) * size.cap)];
});

// Routing example: an M and an S under 450 req/s (the quiz uses 600).
const mix = { load: 450, big: M, small: S };
mix.even = mix.load / 2;
mix.over = mix.even - mix.small.cap;

// Availability: downtime a year for a share of time up, and the example of two servers each up 99.9% (the quiz uses 99%).
const HOURS_A_YEAR = 365.25 * 24;
/** Downtime a year at availability `up`, in the largest unit that is at least 1: 0.999 → "8.77 hours". */
function downtime(up) {
  const hours = (1 - up) * HOURS_A_YEAR;
  if (hours >= 24) return `${(hours / 24).toPrecision(3)} days`;
  if (hours >= 1) return `${hours.toPrecision(3)} hours`;
  return `${(hours * 60).toPrecision(3)} minutes`;
}
const nines = [0.99, 0.999, 0.9999, 0.99999];
const up = 0.999;
const down = 1 - up;

// Estimate example (ours): a ticket site, sized on L servers.
const est = { users: 8000000, each: 12 };
est.day = est.users * est.each;
est.avg = est.day / 86400;
est.peak = est.avg * 2;
est.n = Math.ceil(est.peak / L.cap);

/** @type {Lesson} */
const lesson = {
  intro: {
    kicker: 'Level 2 · Part 1: Grow one app',
    title: 'Load balancer and horizontal scaling',
    story: 'On launch day your one big server crashed and took example.com with it, and even the biggest server has a ceiling. In this level you put several servers behind one address, so a crash no longer closes the shop.',
    picture: 'figBuilt',
    alt: 'The finished design: Users look up example.com in DNS and send requests to a load balancer, which has a standby. The load balancer shares the requests over several web servers, which all use one database.',
    outcomes: [
      'say what a load balancer does and where it sits',
      'tell a public IP address from a private one',
      'size a pool of servers so one can fail',
      'compare scaling out with scaling up',
      'find the single points of failure in a design',
    ],
  },
  last: 'Level 1 ended with two problems. When the web server crashed, the whole shop went down. And at ten times the traffic, no server size was big enough.',
  parts: [
    {
      title: 'One address, many servers',
      mission: 0,
      minutes: 9,
      lead: 'One server cannot be both big enough and safe. Several servers can, if something shares the requests among them.',
      newParts: [
        { type: 'lb', what: 'A server that sits between your users and your web servers.', does: 'Takes every request and hands it to one of the web servers. It stops using a server that does not answer.', game: `$${COMPONENTS.lb.cost} a month. Carries ${rate(COMPONENTS.lb.cap)}.` },
      ],
      sections: [
        {
          title: 'What does a load balancer do?',
          hook: 'With two web servers, which address does DNS give out? Neither. It gives out the address of the load balancer.',
          body: [
            {
              figure: 'figLb',
              alt: `DNS answers example.com with ${LB_PUBLIC_IP}, the load balancer's public IP address. Users send requests to the load balancer. It passes each one to web server 1 or web server 2 over their private IP addresses.`,
              caption: 'One public address in front, private addresses behind',
            },
            { p: `A <b>load balancer</b> shares incoming requests among a group of web servers, called the <b>pool</b>. Users only ever see its address, the <b>public IP</b> (${LB_PUBLIC_IP} here).` },
            { p: `The web servers get <b>private IPs</b> (${WEB_PRIVATE_IP_RANGE}): addresses that work only between machines in your own network. Nobody on the internet can reach a web server directly, which is safer.` },
            { p: 'Need more capacity? Add a server to the pool. The load balancer starts using it at once.' },
          ],
          takeaway: 'Users talk to one public address, and the load balancer talks to the servers.',
          quiz: [0, 1],
        },
        {
          title: 'How does the shop survive a crash?',
          hook: 'A load balancer keeps asking each server "are you alive?". This is a <b>health check</b>.',
          body: [
            {
              figure: 'figCrash',
              alt: 'Before: three web servers each take a third of the requests. After: one server has crashed and failed its health check. The load balancer sends it nothing, and the other two each take half.',
              caption: 'A failed server is skipped and the others take its share',
            },
            { p: 'A server that stops answering gets no more requests. The others take its share. This is <b>failover</b>. It only works if the servers left can carry the whole peak, so plan one spare: <b>N + 1</b>.' },
            {
              calc: {
                formula: 'N = peak ÷ capacity of one server, rounded up. Run N + 1.',
                rows: [
                  { label: 'Servers needed', work: `${rate(spare.peak)} ÷ ${rate(spare.size.cap)}`, result: `${spare.peak / spare.size.cap}, so ${spare.n} servers` },
                  { label: 'With a spare', work: `${spare.n} servers + 1 server`, result: `${spare.n + 1} servers` },
                ],
                result: `Run ${spare.n + 1}. When one crashes, the ${spare.n} left carry ${rate(spare.n * spare.size.cap)}, more than the peak.`,
              },
            },
          ],
          takeaway: 'Size the pool so the peak still fits with one server down.',
          quiz: [2, 3],
        },
        {
          title: 'How much downtime is "99.9% up"?',
          hook: '<b>Availability</b> is the share of time a service works. It is counted in nines, and each extra nine cuts the downtime by ten.',
          body: [
            { table: { head: ['Availability', 'Downtime in a year'], num: true, rows: nines.map((u) => [percent(u), downtime(u)]) } },
            { p: 'A spare server buys nines, because both must fail at the same moment to stop the shop.' },
            {
              calc: {
                formula: `Two servers, each up ${percent(up)} of the time, failing separately:`,
                rows: [
                  { label: 'One is down', work: `100% − ${percent(up)}`, result: `${percent(down)} of the time` },
                  { label: 'Both are down', work: `${percent(down)} × ${percent(down)}`, result: `${percent(down * down)} of the time` },
                  { label: 'At least one is up', work: `100% − ${percent(down * down)}`, result: `${percent(1 - down * down)} of the time` },
                ],
                result: 'Two three-nines servers give six nines, as long as they do not fail together.',
              },
            },
          ],
          takeaway: 'Each nine is ten times less downtime, and spare servers are how you buy nines.',
          quiz: [9],
        },
      ],
      checks: [
        {
          q: `Peak traffic is ${rate(spareCheck.peak)}. One server carries ${rate(spareCheck.size.cap)}. How many servers do you run?`,
          options: [
            { t: `${spareCheck.n - 1}`, why: `${spareCheck.n - 1} servers carry ${rate((spareCheck.n - 1) * spareCheck.size.cap)}, less than the peak. Round up, not down.` },
            { t: `${spareCheck.n}`, why: `${spareCheck.n} carry the peak, but when one crashes the ${spareCheck.n - 1} left cannot. Add the spare.` },
            { t: `${spareCheck.n + 1}`, right: true, why: `${fmt(spareCheck.peak)} ÷ ${fmt(spareCheck.size.cap)} rounds up to ${spareCheck.n}. One spare makes ${spareCheck.n + 1}.` },
          ],
        },
      ],
      youWill: [
        'put a load balancer between Users and at least two web servers',
        `keep Served at least ${targets.servedPct}% and Response under ${ms(targets.latencyMs)} for at most $${fmt(BUDGET.pool)} a month`,
        'crash a web server with the Break it button and stay above the Served target',
      ],
      debrief: {
        saw: 'A web server crashed and the shop stayed up. The load balancer skipped it and the others took its share.',
        number: ['N + 1', 'one more server than the peak needs'],
        // "more than double": tests/unit/level-02-lesson.test.mjs checks it against the missions' traffic.
        next: `A partner is about to send you its users. Traffic will more than double from ${rate(PEAK.before)}.`,
      },
    },
    {
      title: 'Traffic doubles',
      mission: 1,
      minutes: 9,
      lead: 'More users are coming. You can now grow in two ways: bigger servers, or more of them.',
      sections: [
        {
          title: 'How many servers does the new peak need?',
          hook: `Turn users into requests per second first, as in Level 1. A ticket site has ${count(est.users)} daily users who each make ${est.each} requests.`,
          body: [
            {
              calc: {
                formula: 'Peak = daily users × requests each ÷ 86,400 × 2. Then N + 1.',
                rows: [
                  { label: 'Requests a day', work: `${count(est.users)} users × ${est.each} requests`, result: `${count(est.day)} requests` },
                  { label: 'Average', work: `${count(est.day)} requests ÷ 86,400 s`, result: rate(est.avg), approx: true },
                  { label: 'Peak', work: `${rate(est.avg)} × 2`, result: rate(est.peak), approx: true },
                  { label: 'Servers', work: `${rate(est.peak)} ÷ ${rate(L.cap)}, + 1`, result: `${est.n} + 1 = ${est.n + 1} servers` },
                ],
                result: `About ${fmt(est.peak)} requests a second at peak: ${est.n + 1} of the L size, one of them a spare.`,
              },
            },
            { p: 'Leave room as well: a nearly full server is slow, as in Level 1. And every request still reaches the one database, so check that it can carry the new peak too.' },
          ],
          takeaway: 'Estimate the peak, divide by one server, round up, add one.',
          quiz: [8],
        },
        {
          title: 'Why add servers instead of buying a bigger one?',
          hook: `Here is ${rate(sameCap)} of capacity, bought four ways.`,
          body: [
            { table: { head: ['Servers', 'Cost a month', 'Left after one crash'], num: true, rows: buyRows } },
            { p: '<b>Scaling out</b> (horizontal scaling) means more servers. It has no ceiling, one crash costs only a share of your capacity, and small servers are cheaper for each request they carry.' },
            { p: '<b>Scaling up</b> stays simpler: one machine, nothing to share out. Many real designs use a few medium servers.' },
            { assume: `In the game a pool holds at most ${MAX_WEB} web servers.` },
          ],
          takeaway: 'Scaling out removes the ceiling and makes one crash survivable.',
          quiz: [4],
        },
        {
          title: 'How does the load balancer share out requests?',
          hook: 'It follows a <b>routing method</b>. The simplest gives every server the same share, which goes wrong when servers differ in size.',
          body: [
            { table: { head: ['Method', 'Rule', 'Use it when'], rows: [
              ['<b>Round robin</b>', 'Each server in turn', 'All servers are the same size'],
              ['<b>Weighted</b>', 'In turn, bigger servers more often', 'Sizes are mixed'],
              ['<b>Least connections</b>', 'To the server with the fewest requests in progress', 'Sizes are mixed, or some requests take much longer'],
            ] } },
            {
              calc: {
                formula: `Round robin over one M (${rate(mix.big.cap)}) and one S (${rate(mix.small.cap)}) at ${rate(mix.load)}:`,
                rows: [
                  { label: 'Each server gets', work: `${rate(mix.load)} ÷ 2 servers`, result: rate(mix.even) },
                  { label: 'The S is over by', work: `${rate(mix.even)} − ${rate(mix.small.cap)}`, result: rate(mix.over) },
                ],
                result: `The S fails ${fmt(mix.over)} requests a second while the M still has room. Weighted routing would fix it.`,
              },
            },
          ],
          takeaway: 'Round robin for equal servers, weighted or least connections for mixed sizes.',
          quiz: [5],
        },
      ],
      checks: [
        {
          q: 'You need to carry a peak and survive one crash. Which costs less, and why?',
          options: [
            { t: 'Two very large servers', why: 'Each must carry the whole peak alone, so you pay for the peak twice.' },
            { t: 'Several smaller servers, plus one spare', right: true, why: 'The spare is only one small server, and small servers cost less for each request they carry.' },
          ],
        },
      ],
      youWill: [
        'estimate the new peak yourself (Play stays locked until you do)',
        `grow the pool to carry it for at most $${fmt(BUDGET.grow)} a month`,
        'pick a routing method that fits the server sizes you chose',
        'crash a web server and stay above the Served target',
      ],
      debrief: {
        saw: 'You grew the web tier one server at a time and a spare covered the crash. The database could only get bigger.',
        number: [rate(PEAK.after), 'the peak you estimated and carried'],
        next: 'Every request still enters through one load balancer. If it stops, everything stops.',
      },
    },
    {
      title: 'The load balancer is the new single point of failure',
      mission: 2,
      minutes: 6,
      lead: 'You removed one weak spot and created another.',
      sections: [
        {
          title: 'What can still take the whole shop down?',
          hook: 'A <b>single point of failure</b> is any part that stops everything when it stops. To find them, cross out one box at a time and ask: does the shop still work?',
          body: [
            { table: { head: ['Cross out', 'Still up?', 'Why'], rows: [
              ['One web server', 'Yes', 'The others take its share'],
              ['The load balancer', 'No', 'Every request enters through it'],
              ['The database', 'No', 'Every web server needs it'],
            ] } },
            { p: 'The SPOFs number on the Build screen counts these for you. This level fixes the load balancer. Level 3 fixes the database.' },
          ],
          takeaway: 'Whatever stops the shop when you cross it out is a single point of failure.',
          quiz: [6],
        },
        {
          title: 'How does a standby take over?',
          hook: 'Run two load balancers. One is <b>active</b> and carries the traffic. The other is a <b>standby</b> and waits.',
          body: [
            {
              figure: 'figPair',
              alt: 'Before: the active load balancer carries the traffic and exchanges heartbeats with the standby. After: the active one has crashed and the heartbeats have stopped. The standby has taken over the public IP address and carries the traffic.',
              caption: 'No heartbeat, so the standby takes the public address',
            },
            { p: 'The pair send each other a small signal every second or so, a <b>heartbeat</b>. If the heartbeats stop, the standby takes over the public IP. Users keep the same address and notice almost nothing.' },
            { p: 'The standby is not wasted money. It is the price of removing a single point of failure.' },
          ],
          takeaway: 'A standby watches the heartbeat and takes the public address when it stops.',
          quiz: [7],
        },
      ],
      checks: [
        {
          q: 'A design has two load balancers (active and standby), four web servers and one cache server that every request needs. How many single points of failure?',
          options: [
            { t: 'None', why: 'Cross out the cache server: every request needs it, so the shop stops.' },
            { t: 'One', right: true, why: 'Only the cache server. The load balancers cover each other, and so do the web servers.' },
            { t: 'Two', why: 'The load balancer is a pair now, so losing one does not stop the shop.' },
          ],
        },
      ],
      youWill: [
        'add a second load balancer as a standby, connected to every web server',
        `stay within $${fmt(BUDGET.pair)} a month`,
        'crash the active load balancer and watch the standby take over',
      ],
    },
  ],
  wrap: {
    picture: 'figBuiltEnd',
    alt: 'The design you built: Users look up example.com in DNS and reach an active load balancer with a standby. It shares requests over several web servers, which all use one database.',
    say: [
      '"A load balancer gives users one public address and shares requests over servers on private addresses."',
      '"I size the pool N + 1, so the peak still fits when one server fails."',
      '"The load balancer runs as an active and standby pair, so it is not a single point of failure."',
    ],
    numbers: [
      ['N + 1', 'servers to run when N carry the peak'],
      [downtime(0.999), `downtime a year at ${percent(0.999)}`],
      [downtime(0.9999), `downtime a year at ${percent(0.9999)}`],
    ],
    loop: `The interview steps again: ${scope} (you estimated the new peak), ${sketch} (load balancer and pool), ${deep} (server sizes and routing method), ${stress} (you crashed a server, then the load balancer).`,
    broken: 'The database is the last single point of failure, and it is nearly full. Level 3 gives it copies.',
  },
};

/**
 * The finished design, shown on the intro and again on the wrap-up: one drawing, two svgs.
 * @param {Record<string, Function>} f the drawing helpers `drawFigures` is given
 * @param {SVGSVGElement} svg
 */
function drawBuilt(f, svg) {
  const { figNode, figArrow, figDefs, figLabel } = f;
  svg.textContent = ''; svg.setAttribute('viewBox', '0 0 640 440'); figDefs(svg);
  figNode(svg, 'users', 150, 52, 'Users', 'Browser + app');
  figNode(svg, 'dns', 500, 52, 'DNS', 'Finds the address');
  figArrow(svg, 246, 52, 404, 52, 'lookup', null, 325, 44, 'middle');
  figNode(svg, 'lb', 150, 165, 'Load balancer', 'Active');
  figNode(svg, 'lb', 500, 165, 'Load balancer', 'Standby');
  figArrow(svg, 150, 82, 150, 135, 'requests', null, 162, 113);
  figArrow(svg, 246, 155, 404, 155, 'heartbeat', null, 325, 147, 'middle');
  figArrow(svg, 404, 175, 246, 175, '', null, 0, 0);
  for (const x of [110, 320, 530]) {
    figNode(svg, 'web', x, 290, 'Web server', 'Private IP');
    figArrow(svg, 150, 195, x, 260, '', null, 0, 0);
    figArrow(svg, x, 320, 320 + (x - 320) * 0.3, 370, '', null, 0, 0); // towards the database's top edge
  }
  figLabel(svg, 218, 392, 'queries', 'end');
  figNode(svg, 'db', 320, 400, 'Database', 'One shared copy');
}

/** @type {Level} */
export default {
  id: 2,
  saveKey: 'sdl-level2-v1',
  saveVersion: 3, // 2: break-it results are kept per mission; 3: which missions were opened from the lesson (`opened`)
  quizVersion: 1,
  targets,

  components: {
    users: { name: 'Users', sub: 'Web + mobile app', desc: 'Your visitors. They look up example.com in DNS, then send HTTP requests to the address DNS returns.' },
    dns: dns(),
    lb: lb(),
    web: {
      name: 'Web server', short: 'Your back-end code',
      desc: `Runs your back-end code on a private IP (${WEB_PRIVATE_IP_RANGE}). Only the load balancer can reach it. Every web server should use the same shared database.`,
      noDbNote: NO_DB_NOTE,
    },
    db: db(),
  },
  palette: ['dns', 'lb', 'web', 'db'],
  limits: { dns: 1, lb: 2, web: MAX_WEB, db: 1 },
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
      title: 'One address, many servers', ref: 'Load balancer', qps: PEAK.before, budget: BUDGET.pool,
      story: `Launch day ran on one large server, until it crashed and took example.com down with it. Traffic is the same, ${fmt(PEAK.before)} req/s at peak. Put a load balancer in front and spread the traffic over several web servers, so one crash no longer takes the site offline.`,
      goals: [
        { id: 'lb', type: 'struct', text: 'Users reach the web servers through a load balancer', test: (g) => g.count('lb') >= 1 && g.everyReaches('lb', 'web') },
        { id: 'pool', type: 'struct', text: 'At least two web servers behind it', test: (g) => g.count('web') >= 2 },
        sharedDbGoal,
        servedGoal(targets), latGoal(targets), costGoal(BUDGET.pool),
        { id: 'crash-web', type: 'exp', text: 'Break it: crash a web server and still serve at least 99%' },
      ],
      hint: `Add a load balancer and connect Users to it, then connect it to each web server, and each web server to the database. With round robin every server gets the same share, so use one size (or pick weighted or least connections in the load balancer). When your biggest server crashes, the others must carry all ${fmt(PEAK.before)} req/s between them. Several small servers cost less than a few big ones.`,
      takeaway: 'A server crashed and the site stayed up: the load balancer stopped sending it requests and the others took its share. That only works when the servers left can carry the whole peak. Plan for one more than you need: N + 1.',
    },
    {
      title: 'Traffic doubles', ref: 'Scaling out', qps: PEAK.after, budget: BUDGET.grow,
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
        servedGoal(targets), latGoal(targets), costGoal(BUDGET.grow),
        { id: 'crash-web', type: 'exp', text: 'Break it: crash a web server and still serve at least 99%' },
      ],
      hint: 'Every request still reaches the one database, so check it first: a large database handles 800 queries/s. Then add web servers until each is well under 75% busy, plus one spare for the crash test. Same-size servers are simplest; with mixed sizes, switch the load balancer to weighted or least connections.',
      takeaway: 'You grew the web tier one server at a time, and the spare kept the site up during a crash. The database could only grow bigger: it is now 75% busy, and still a single point of failure. Level 3 fixes that with replicas.',
    },
    {
      title: 'The load balancer is the new single point of failure', ref: 'Standby pair', qps: PEAK.after, budget: BUDGET.pair,
      story: 'Every web server now has a spare, but all traffic still enters through one load balancer. If it stops, example.com stops. Add a second load balancer as a standby: the pair send each other heartbeats, and if the active one goes quiet, the standby takes over its public IP.',
      goals: [
        {
          id: 'standby', type: 'struct', text: 'A standby load balancer is ready, connected to every web server', test: standbyReady,
          val: (m, g) => { const f = fewestReached(g); return g.count('lb') >= 2 && f.n < f.total ? `reaches ${f.n} of ${f.total}` : ''; },
        },
        sharedDbGoal,
        servedGoal(targets), latGoal(targets), costGoal(BUDGET.pair),
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
      { q: 'You put a load balancer in front of your web servers. Which IP does DNS now give users\' devices for example.com?', o: ['The private IP of the first web server', 'The load balancer\'s public IP', 'A web server IP picked at random', 'The database server\'s IP'], a: 1, e: 'Devices connect to the load balancer\'s public IP. The load balancer then forwards each request to a web server over the private network, so users never see the web servers.', r: 'What does a load balancer do?' },
      { q: 'Why are the web servers on private IPs once a load balancer is in front?', o: ['Only machines inside the network can reach them', 'Private IPs make every request faster', 'So DNS can cache all of their addresses', 'So each server can store more of the data'], a: 0, e: `A private IP (for example ${WEB_PRIVATE_IPS[0]}) cannot be reached from the internet. Only the load balancer and other servers inside the network can talk to the web servers, which keeps them out of direct reach.`, r: 'What does a load balancer do?' },
      { q: 'One of three web servers starts failing its health check. What does the load balancer do?', o: ['Sends that server\'s share to the database', 'Keeps sending it requests until it is fixed', 'Stops using it; the other two share the load', 'Restarts the server and waits for it to return'], a: 2, e: 'The load balancer checks each server regularly and stops sending requests to one that fails. The healthy servers share its traffic until it is fixed or replaced.', r: 'How does the shop survive a crash?' },
      { q: 'Each web server can serve at most 300 req/s. What is the fewest servers that still serve every request at a 1,000 req/s peak after one crashes?', o: ['3', '4', '6', '5'], a: 3, e: '1,000 ÷ 300 = 3.3, so 4 servers carry the peak. One more lets you lose any server and still have 4: that is N + 1 = 5.', r: 'How does the shop survive a crash?' },
      { q: 'What does scaling out give you that scaling up cannot?', o: ['A faster response from each server', 'No size ceiling, and one server can fail safely', 'A database that never has to grow', 'Cheaper DNS lookups for every user in every country'], a: 1, e: 'Scaling up stops at the biggest machine you can buy, and that one machine is still a single point of failure. Scaling out adds servers behind a load balancer: no fixed ceiling, and one server can fail without taking the site down.', r: 'Why add servers instead of buying a bigger one?' },
      { q: 'Round robin spreads 600 req/s over one M server (400 req/s) and one S server (200 req/s). What happens?', o: ['Both servers end up 75% busy', 'The M gets 400 req/s and the S gets 200', 'The S gets 300 and drops about 100 of them', 'Nothing fails, since 600 is exactly their capacity'], a: 2, e: 'Round robin gives each server the same share, 300 req/s. The S server can only serve 200, so about 100 requests a second fail (17%) even though the total capacity looks big enough. Use same-size servers, or a weighted method.', r: 'How does the load balancer share out requests?' },
      { q: 'A design has one load balancer, three web servers and one database. Which are single points of failure?', o: ['The load balancer and the database', 'Only the database', 'Each of the three web servers', 'None, because there are three servers'], a: 0, e: 'The three web servers back each other up. The load balancer and the database are each the only one of their kind, so either one failing takes the site down.', r: 'What can still take the whole shop down?' },
      { q: 'How does a standby load balancer know it should take over?', o: ['The web servers elect a new one', 'Users report the errors to it', 'DNS moves the name to its IP', 'It stops getting heartbeats'], a: 3, e: 'The two load balancers send each other heartbeats, small regular "I am alive" signals. When the standby stops hearing them for a few seconds, it takes over the active one\'s public IP.', r: 'How does a standby take over?' },
      { q: '4,000,000 daily users make about 15 requests each. Roughly what is the peak QPS?', o: ['~690', '~140', '~1,390', '~13,900'], a: 2, e: '4M × 15 ÷ 86,400 s ≈ 694 requests per second on average. Peak is about 2 × the average, so ≈ 1,390. Picking ~690 means you stopped at the average.', r: 'How many servers does the new peak need?' },
      { q: 'Two web servers are each up 99% of the time and fail independently. How often is at least one up?', o: ['99%', '99.99%', '98%', '99.5%'], a: 1, e: 'Both are down at once only 1% × 1% = 0.01% of the time, so at least one is up 99.99% of the time: about 53 minutes of downtime a year instead of 3.65 days. This only holds if their failures are independent.', r: 'How much downtime is "99.9% up"?' },
    ],
  },

  lesson,

  // Lesson diagrams. `f` provides the engine's drawing helpers. Each figure sets its own viewBox.
  drawFigures(f) {
    const { $, svgEl, figNode, figArrow, figDefs, figLabel } = f;
    /** A component drawn as down (crashed or failed its health check). */
    const downNode = (svg, type, x, y, name, sub) => figNode(svgEl('g', { class: 'fig-down' }, svg), type, x, y, name, sub);
    /** A dashed frame with its label, for one panel of a before-and-after picture. */
    const panel = (svg, y, height, label) => {
      svgEl('rect', { x: 10, y, width: 620, height, rx: 12, class: 'tier-box' }, svg);
      figLabel(svg, 24, y + 20, label, 'start', 'tier-label');
    };

    // DNS gives out the load balancer's public IP; the web servers sit behind it on private IPs.
    const f1 = $('figLb'); f1.textContent = ''; f1.setAttribute('viewBox', '0 0 640 400'); figDefs(f1);
    figNode(f1, 'users', 150, 52, 'Users', 'Browser + app');
    figNode(f1, 'dns', 500, 52, 'DNS', 'Third-party');
    figNode(f1, 'lb', 150, 180, 'Load balancer', `Public ${LB_PUBLIC_IP}`);
    figArrow(f1, 246, 42, 404, 42, 'example.com?', '1', 272, 34);
    figArrow(f1, 404, 64, 246, 64, LB_PUBLIC_IP, '2', 272, 84);
    figArrow(f1, 150, 82, 150, 150, 'HTTP', '3', 176, 120);
    svgEl('rect', { x: 20, y: 236, width: 600, height: 150, rx: 12, class: 'tier-box' }, f1);
    figLabel(f1, 34, 256, 'Private network', 'start', 'tier-label');
    figNode(f1, 'web', 150, 330, 'Web server 1', `Private ${WEB_PRIVATE_IPS[0]}`);
    figNode(f1, 'web', 470, 330, 'Web server 2', `Private ${WEB_PRIVATE_IPS[1]}`);
    figArrow(f1, 150, 210, 150, 300, 'forward', '4', 176, 280);
    figArrow(f1, 230, 210, 430, 300, 'forward', null, 360, 266);

    // Before: three servers each take a third. After: one fails its health check and the other two take half each.
    const f2 = $('figCrash'); f2.textContent = ''; f2.setAttribute('viewBox', '0 0 640 428'); figDefs(f2);
    panel(f2, 10, 196, 'Before: all three healthy');
    figNode(f2, 'lb', 320, 66, 'Load balancer', 'Health checks');
    for (const [i, x] of [110, 320, 530].entries()) {
      figNode(f2, 'web', x, 166, `Web server ${i + 1}`, 'A third');
      figArrow(f2, 320, 96, x, 136, '', null, 0, 0);
    }
    panel(f2, 222, 196, 'After: server 2 crashed');
    figNode(f2, 'lb', 320, 278, 'Load balancer', 'Skips server 2');
    figNode(f2, 'web', 110, 378, 'Web server 1', 'Half');
    downNode(f2, 'web', 320, 378, 'Web server 2', 'Failed check');
    figNode(f2, 'web', 530, 378, 'Web server 3', 'Half');
    figArrow(f2, 320, 308, 110, 348, '', null, 0, 0);
    figArrow(f2, 320, 308, 530, 348, '', null, 0, 0);

    // Before: heartbeats pass between the pair and traffic goes to the active one. After: the standby has the address.
    const f3 = $('figPair'); f3.textContent = ''; f3.setAttribute('viewBox', '0 0 640 436'); figDefs(f3);
    panel(f3, 10, 200, 'Before: heartbeats arrive');
    figNode(f3, 'users', 320, 66, 'Users', `To ${LB_PUBLIC_IP}`);
    figNode(f3, 'lb', 150, 166, 'Load balancer', 'Active');
    figNode(f3, 'lb', 490, 166, 'Load balancer', 'Standby');
    figArrow(f3, 280, 96, 190, 136, 'requests', null, 250, 122);
    figArrow(f3, 244, 156, 396, 156, 'heartbeat', null, 320, 148, 'middle');
    figArrow(f3, 396, 176, 244, 176, '', null, 0, 0);
    panel(f3, 226, 200, 'After: no heartbeat');
    figNode(f3, 'users', 320, 282, 'Users', `To ${LB_PUBLIC_IP}`);
    downNode(f3, 'lb', 150, 382, 'Load balancer', 'Crashed');
    figNode(f3, 'lb', 490, 382, 'Load balancer', 'Has the public IP');
    figArrow(f3, 360, 312, 450, 352, 'requests', null, 414, 326);
    figLabel(f3, 320, 386, 'no heartbeat');

    drawBuilt(f, $('figBuilt'));
    drawBuilt(f, $('figBuiltEnd'));
  },
};
