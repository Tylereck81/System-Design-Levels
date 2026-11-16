// @ts-check
/** @import { Level, Lesson } from '../js/types.js' */
// Level 6: Stateless web tier and autoscaling.
// Everything specific to this level lives here: components, rules, missions, quiz and text.
import { servedGoal, latGoal, costGoal, spofGoal, servedAtLeast, fmtPct } from './shared/goals.js';
import { regionUsers, dns, lb, NO_DB_NOTE, autoscaleSubOf, scalingChoices, replicaDb, cache, cdn } from './shared/components.js';
import { dnsLookup, usersToLb, lbToWeb, webToReplicas, webToCache, usersToCdn, cdnToLb, lbBad, replicaBad, cacheBad, cdnBad } from './shared/connections.js';
import { lbText, replicaText, NO_ORIGIN, levelComplete } from './shared/text.js';
import { ONE_DNS, TWO_LBS, THREE_DBS, THREE_CACHES, ONE_CDN } from './shared/limits.js';
import { failText, passText } from './shared/quiz.js';
import { filesWorkload, dayTraffic } from './shared/workload.js';
import { fmt, percent, ms, rate } from '../js/format.js';
import { SIZES, COMPONENTS, T } from '../js/engine/catalog.js';
import { STEPS } from './mock-steps.js';

const targets = { latencyMs: 150, servedPct: 99 };
/** Peak traffic in req/s, the share that writes, the share that are files and the share of shoppers far away: the same in all three missions. */
const LOAD = { qps: 4000, writes: 0.2, files: 0.5, far: 0.3 };
const PCT = { wholeFrom: 10 }; // percentages: whole numbers from 10% up
/** Monthly budget of Missions 1 and 2, in dollars. */
const BUDGET = 3300;
/** Monthly budget of Mission 3, once the web tier follows the traffic, in dollars. */
const NIGHT_BUDGET = 2900;
const LOST_MAX = 0.05; // % of shoppers: below this, nobody was logged out

const served99 = servedAtLeast(targets.servedPct);
const kept = (m) => m.lostPct < LOST_MAX;
const clock = (h) => String(h).padStart(2, '0') + ':00';

const day = dayTraffic(); // share of the 20:00 peak, hour by hour
const shopLb = lb();

// ---------------- Lesson ----------------
const store = COMPONENTS.session;
const target = T.scaleAt; // the autoscaler keeps servers at most this busy
const [scope, sketch, deep, stress] = STEPS.map((step) => `<b>${step.name}</b>`);

/**
 * Servers for `load` req/s on servers of `size`, each kept at most `target` busy, rounded up: the formula the lesson
 * teaches. The unit test checks it against the autoscaler's own count (copiesFor) for every number the lesson draws.
 */
const serversFor = (load, size) => Math.ceil(load / (size.cap * target));

// Autoscaling example (ours): 1,800 req/s at the peak on L servers, 20% of that at night.
const auto = { peak: 1800, size: SIZES.L, night: 0.2 };
const autoUsable = auto.size.cap * target; // 800 × 0.6 = 480 req/s
const autoNight = auto.peak * auto.night; // 360 req/s
const autoAtPeak = serversFor(auto.peak, auto.size); // 1,800 ÷ 480 = 3.75, so 4
const autoAtNight = serversFor(autoNight, auto.size); // 360 ÷ 480 = 0.75, so 1
// Check yourself: 2,000 req/s on S servers.
const autoCheck = { peak: 2000, size: SIZES.S };
const checkUsable = autoCheck.size.cap * target; // 200 × 0.6 = 120 req/s
const checkN = serversFor(autoCheck.peak, autoCheck.size); // 2,000 ÷ 120 = 16.7, so 17

/** @type {Lesson} */
const lesson = {
  intro: {
    kicker: 'Level 6 · Part 1: Grow one app',
    title: 'Stateless web tier and autoscaling',
    story: 'Shoppers can now log in and fill a cart, and carts keep vanishing. The cause is where your servers keep what they know about each shopper. Fix that, and the web tier can grow and shrink by itself.',
    picture: 'figBuilt',
    alt: 'The finished design: the load balancer shares requests over a group of web servers that grows and shrinks with traffic. Every web server reads and writes one shared session store.',
    outcomes: [
      'say what state is and what makes a server stateful',
      'explain sticky sessions and why they are a weak fix',
      'move session data to a shared store',
      'explain why autoscaling needs stateless servers',
      'work out how many servers run at the peak',
    ],
  },
  last: 'Level 5 moved files close to shoppers. Your web servers still remember things about each shopper between requests. That did not matter until shoppers had carts.',
  parts: [
    {
      title: 'Empty carts',
      mission: 0,
      minutes: 7,
      lead: 'Two web servers, one load balancer, and a cart that is there on one click and gone on the next.',
      newParts: [
        { type: 'session', before: 1, what: 'A fast store that every web server shares.', does: 'Keeps each shopper\'s login and cart under their session ID. Any web server can look a session up or change it.', game: `$${store.cost} a month. Handles ${fmt(store.cap)} lookups/s, ${ms(store.base)} each.` },
      ],
      sections: [
        {
          title: 'Why did the cart disappear?',
          hook: 'Because the server that answered this click is not the server that holds the cart.',
          body: [
            {
              figure: 'figStateful',
              alt: 'Ana\'s first request goes to server 1, which keeps her cart of two items in its memory. The load balancer sends her next request to server 2, which has never heard of Ana and shows an empty cart.',
              caption: 'The cart is on server 1. The request went to server 2',
            },
            { p: '<b>State</b> is anything a server remembers about a user from one request to the next. A login and a cart together are a <b>session</b>. A server that keeps sessions in its own memory is <b>stateful</b>.' },
            { p: 'Behind a load balancer that takes each server in turn, a shopper lands on the wrong server half the time.' },
          ],
          takeaway: 'A stateful server only works for the users whose data it happens to hold.',
          quiz: [0, 1],
        },
        {
          title: 'How can every page find its cart?',
          hook: 'There are two ways. Send the shopper to the cart, or put the cart where every server can reach it.',
          body: [
            { table: { head: ['', 'Sticky sessions', 'Shared session store'], rows: [
              ['<b>How</b>', 'The load balancer sends all of a shopper\'s requests to the same server', 'Servers keep sessions in one store they all share'],
              ['<b>Where the cart lives</b>', 'Still in one server\'s memory', 'Outside every web server'],
              ['<b>Cost</b>', 'A setting on the load balancer', 'One more part to run, and a lookup on every page'],
            ] } },
            { p: 'Both make this mission pass. They are not equally good, and the next mission shows why.' },
          ],
          takeaway: 'Either route each user to their server, or move the session out of the servers.',
          quiz: [2],
        },
      ],
      checks: [
        {
          q: 'Three web servers keep sessions in their own memory. The load balancer uses round robin. Out of 3 clicks, how many reach the server that has the shopper\'s cart?',
          options: [
            { t: 'All 3', why: 'Round robin takes each server in turn, so only one click in three returns to the same server.' },
            { t: '1', right: true, why: 'Each server gets one click in three. Only one of them holds the cart.' },
          ],
        },
      ],
      youWill: [
        'watch pages fail to find their cart with two stateful servers',
        'fix it with sticky sessions on the load balancer, or with a session store',
        `keep Served at least ${targets.servedPct}% for at most $${fmt(BUDGET)} a month`,
      ],
      debrief: {
        saw: 'Every page found its cart again.',
        number: ['2 fixes', 'sticky sessions, or a shared session store'],
        next: 'At 10:00 you deploy a new version, and one web server leaves the pool while it restarts.',
      },
    },
    {
      title: 'An update at 10:00',
      mission: 1,
      minutes: 7,
      lead: 'Servers leave the pool all the time: updates, crashes, resizing. What they hold leaves with them.',
      sections: [
        {
          title: 'What happens to carts when a server leaves?',
          hook: 'Sticky sessions sent each shopper to their cart. They did not move the cart.',
          body: [
            { p: 'When a server restarts, its memory is wiped. Every shopper pinned to it loses their cart and is logged out. The load balancer then sends them to another server, which has never heard of them.' },
            { p: 'Sticky sessions have two more costs. A busy server cannot hand its shoppers to an idle one, so the load is uneven. And you cannot add or remove servers freely, which is the whole point of a pool.' },
          ],
          takeaway: 'Sticky sessions keep the cart on one server, so losing the server loses the cart.',
          quiz: [3],
        },
        {
          title: 'What makes a web tier stateless?',
          hook: 'Take the sessions out of the web servers and keep them in one shared store.',
          body: [
            {
              figure: 'figStateless',
              alt: 'Requests from Ana and Ben go to any of three web servers, which hold no session data. Each server reads and writes a shared session store that holds both carts. One web server is removed and nothing is lost.',
              caption: 'Any server can answer any shopper, and any server can leave',
            },
            { p: 'The browser keeps only a <b>session ID</b>. Each web server uses it to look the session up. The servers now hold nothing between requests: they are <b>stateless</b>, and all alike.' },
            { p: 'A session is fetched whole by its key, so a key-value NoSQL store fits, and it is easy to scale out.' },
            { p: `One warning: the store is now on every page's path. Each lookup adds time (${ms(store.base)} in the game), and the store must not be a single point of failure.` },
          ],
          takeaway: 'Stateless servers keep nothing between requests, so any of them can be removed.',
          quiz: [4, 5, 9],
        },
      ],
      checks: [
        {
          q: 'A stateless web server crashes in the middle of the day. What do its shoppers lose?',
          options: [
            { t: 'Their carts', why: 'The carts are in the session store, not in the server.' },
            { t: 'Nothing: their next request goes to another server', right: true, why: 'Every server reads the same store, so any of them can carry on.' },
          ],
        },
      ],
      youWill: [
        'add a session store and connect every web server to it',
        'take a web server out with the Break it button: no shopper may lose their cart',
        `finish with no single point of failure, for at most $${fmt(BUDGET)} a month`,
      ],
      debrief: {
        saw: 'A web server left the pool and nobody noticed. The other server read every cart from the session store.',
        number: [ms(store.base), 'added to a page for the session lookup'],
        next: `Traffic peaks at ${rate(LOAD.qps)} in the evening and falls to a fraction of that at night. Your servers run at full size all night.`,
      },
    },
    {
      title: 'Quiet nights',
      mission: 2,
      minutes: 8,
      lead: 'Servers sized for the evening peak sit idle most of the day, and you pay for every hour.',
      sections: [
        {
          title: 'What does an autoscaler do?',
          hook: '<b>Autoscaling</b> adds web servers when traffic rises and removes them when it falls.',
          body: [
            {
              figure: 'figDay',
              alt: 'Traffic over one day is lowest at four in the morning and highest at eight in the evening. The number of servers follows it in steps. A flat line shows servers sized for the peak running all day.',
              caption: 'Servers follow the traffic instead of staying at the peak',
            },
            { p: `An autoscaler watches how busy the servers are and keeps them near a target. In the game the target is ${percent(target)} busy: above it, a server is added; well below it, one is removed.` },
            { p: 'It removes servers every night. That is safe only if they are stateless. Removing a stateful server would log its shoppers out, every night.' },
          ],
          takeaway: 'Autoscaling follows the traffic, and it needs servers that can leave at any time.',
          quiz: [6, 7],
        },
        {
          title: 'How many servers run at the peak?',
          hook: `Each server is kept at most ${percent(target)} busy, so count only that share of its capacity.`,
          body: [
            {
              calc: {
                formula: 'Servers = traffic ÷ (capacity of one server × target), rounded up.',
                rows: [
                  { label: 'Usable per server', work: `${rate(auto.size.cap)} × ${target}`, result: rate(autoUsable) },
                  { label: 'At the peak', work: `${rate(auto.peak)} ÷ ${rate(autoUsable)}`, result: `${auto.peak / autoUsable}, so ${autoAtPeak} servers` },
                  { label: 'At night', work: `${rate(autoNight)} ÷ ${rate(autoUsable)}`, result: `${autoNight / autoUsable}, so ${autoAtNight} server` },
                ],
                result: `${autoAtPeak} servers in the evening and ${autoAtNight} at night, where a fixed design would run ${autoAtPeak} all day.`,
              },
            },
            { p: 'Smaller servers follow the traffic in finer steps, because a group cannot shrink below one server.' },
          ],
          takeaway: 'Divide the traffic by the usable share of one server, and round up.',
          quiz: [8],
        },
      ],
      checks: [
        {
          q: `Peak traffic is ${rate(autoCheck.peak)}. One server carries ${rate(autoCheck.size.cap)} and is kept at most ${percent(target)} busy. How many servers run at the peak?`,
          options: [
            { t: `${autoCheck.peak / autoCheck.size.cap}`, why: `That fills every server to 100%. Count only ${percent(target)} of each: ${rate(checkUsable)}.` },
            { t: `${checkN}`, right: true, why: `${percent(target)} of ${fmt(autoCheck.size.cap)} is ${fmt(checkUsable)}. ${fmt(autoCheck.peak)} ÷ ${fmt(checkUsable)} = ${(autoCheck.peak / checkUsable).toFixed(1)}, rounded up.` },
            { t: `${checkN - 1}`, why: `Round up, not down. ${checkN - 1} servers would be over the target.` },
          ],
        },
      ],
      youWill: [
        'estimate the servers one group runs at the peak (Play stays locked until you do)',
        'set each web server to autoscale and pick a size that follows the traffic closely',
        `run a whole day: nobody is logged out, and the bill is at most $${fmt(NIGHT_BUDGET)} a month`,
      ],
    },
  ],
  wrap: {
    picture: 'figBuiltEnd',
    alt: 'The design you built: the load balancer shares requests over a group of web servers that grows and shrinks with traffic. Every web server reads and writes one shared session store.',
    say: [
      '"I keep the web tier stateless: sessions live in a shared store, so any server can take any request."',
      '"Sticky sessions break when a server is removed, because the session is still on that server."',
      '"Stateless servers can be autoscaled, so I pay for the peak only at the peak."',
    ],
    numbers: [
      [percent(target), 'how busy the autoscaler keeps each server, in the game'],
      [ms(store.base), 'for a session lookup, in the game'],
    ],
    loop: `The interview steps again: ${scope} (the servers at the peak), ${sketch} (session store beside the web tier), ${deep} (autoscaling and server size), ${stress} (you took a server out and ran a whole day).`,
    broken: 'Everything you built stands in one building. If that data center loses power, the whole shop is gone. Level 7 opens a second one.',
  },
};

/**
 * The finished design, shown on the intro and again on the wrap-up: one drawing, two svgs.
 * @param {Record<string, Function>} f the drawing helpers `drawFigures` is given
 * @param {SVGSVGElement} svg
 */
function drawBuilt(f, svg) {
  const { svgEl, figNode, figArrow, figSvg, figLabel } = f;
  figSvg(svg, 460);
  figNode(svg, 'users', 320, 46, 'Users', 'Browser + app');
  figNode(svg, 'lb', 320, 156, 'Load balancers', 'Active + standby');
  figArrow(svg, 320, 76, 320, 126, 'requests', null, 332, 106);
  figArrow(svg, 320, 186, 320, 226, 'any server', null, 332, 210);
  // The autoscaled group: the third server is one the autoscaler adds for the peak and removes at night.
  svgEl('rect', { x: 10, y: 226, width: 620, height: 130, rx: 12, class: 'tier-box' }, svg);
  figLabel(svg, 24, 246, 'Autoscaled group: grows and shrinks', 'start', 'tier-label');
  figNode(svg, 'web', 110, 306, 'Web server', 'Keeps nothing');
  figNode(svg, 'web', 320, 306, 'Web server', 'Keeps nothing');
  figNode(svg, 'web', 530, 306, 'Web server', 'Added for the peak');
  figNode(svg, 'session', 220, 420, 'Session store', 'Every cart, by ID');
  figNode(svg, 'db', 530, 420, 'Data', 'Cache and databases');
  figArrow(svg, 110, 336, 170, 390, '', null, 0, 0);
  figArrow(svg, 320, 336, 250, 390, '', null, 0, 0);
  figArrow(svg, 530, 336, 300, 390, '', null, 0, 0);
  figLabel(svg, 300, 374, 'sessions', 'start');
  figArrow(svg, 590, 336, 590, 390, '', null, 0, 0);
  figLabel(svg, 602, 370, 'data', 'start');
}

/**
 * A day of traffic and the servers that follow it, for the lesson's example (on the game's day curve and its
 * autoscaling rule), against a fixed design sized for the peak.
 * @param {Record<string, Function>} f the drawing helpers `drawFigures` is given
 * @param {SVGSVGElement} svg
 */
function drawDay(f, svg) {
  const { svgEl, figLabel, figSvg } = f;
  figSvg(svg, 250);
  const top = autoAtPeak + 1, X = (h) => 56 + h * 23, Y = (n) => 220 - (n / top) * 190;
  for (let n = 1; n <= top; n++) {
    svgEl('line', { x1: X(0), y1: Y(n), x2: X(24), y2: Y(n), class: 'ch-grid' }, svg);
    figLabel(svg, X(0) - 8, Y(n) + 4, String(n), 'end', 'ch-t');
  }
  // Traffic in servers' worth of work (load ÷ usable capacity), drawn through the middle of each hour.
  const pts = day.map((share, h) => `${X(h + 0.5).toFixed(1)} ${Y((auto.peak * share) / autoUsable).toFixed(1)}`);
  svgEl('path', { d: `M${X(0.5)} ${Y(0)} L${pts.join(' L')} L${X(23.5)} ${Y(0)}Z`, class: 'ch-area' }, svg);
  svgEl('path', { d: `M${pts.join(' L')}`, class: 'ch-curve' }, svg);
  // Servers running, hour by hour.
  const steps = day.map((share, h) => `H${X(h)} V${Y(serversFor(auto.peak * share, auto.size))} H${X(h + 1)}`);
  svgEl('path', { d: `M${X(0)} ${Y(0)} ${steps.join(' ')}`, class: 'd-line' }, svg);
  svgEl('path', { d: `M${X(0)} ${Y(autoAtPeak)} H${X(24)}`, class: 'd-line d-dash' }, svg);
  figLabel(svg, X(0) + 6, Y(autoAtPeak) - 8, 'servers sized for the peak, running all night', 'start', 'ch-t');
  svgEl('line', { x1: X(0), y1: Y(0), x2: X(24), y2: Y(0), class: 'ch-axis' }, svg);
  for (const h of [0, 4, 8, 12, 16, 20, 24]) figLabel(svg, X(h), Y(0) + 18, clock(h), 'middle', 'ch-t');
  figLabel(svg, 18, Y(top) - 12, 'servers', 'start', 'ch-t');
  figLabel(svg, X(0.8), Y(0) - 8, 'traffic', 'start', 'ch-t');
  figLabel(svg, X(8), Y(3) - 8, 'servers running', 'start', 'ch-t');
}

/** @type {Level} */
export default {
  id: 6,
  saveKey: 'sdl-level6-v1',
  saveVersion: 2, // 2: which missions were opened from the lesson (`opened`)
  targets,
  workload: { ...filesWorkload(), day },

  components: {
    users: {
      ...regionUsers(),
      desc: 'Your shoppers: 70% in Europe, near the data center in Frankfurt, and 30% in America. They log in and fill a cart, so every page they open needs their session. Half of all requests are files, which need no session.',
    },
    dns: dns(),
    lb: {
      ...shopLb,
      algos: [
        ...shopLb.algos,
        { id: 'sticky', short: 'sticky', name: 'Sticky sessions', sub: 'each shopper stays on one server', note: 'The load balancer sets a cookie that names a shopper\'s server and sends all their requests there. Sessions kept in a server\'s memory are always found, but that server is now the only place they live.', log: 'Load balancer set to sticky sessions: each shopper stays on the server they started on.' },
      ],
    },
    web: {
      name: 'Web server', short: 'Your back-end code',
      desc: 'Runs your back-end code for pages, and sends static files when the CDN misses. Every page needs the shopper\'s session: who they are and what is in their cart.',
      noDbNote: NO_DB_NOTE,
      statefulNote: 'Keeps the sessions of the shoppers it served in its own memory: it is stateful. A page that lands on another server finds no cart. Connect it to the session store.',
      subOf: autoscaleSubOf,
      choices: scalingChoices(),
    },
    db: replicaDb(),
    cache: cache(),
    cdn: cdn(),
    session: {
      name: 'Session store', short: 'Shared sessions', sub: 'Managed NoSQL',
      desc: 'A key-value store that holds every shopper\'s session (login and cart) under its session ID, which the browser keeps in a cookie. Web servers read and write sessions here, so any server can handle any shopper. It is a managed NoSQL service: the provider keeps copies on several machines. In this game it handles 10,000 lookups/s, takes 3 ms per lookup and costs $150/month.',
    },
  },
  palette: ['dns', 'lb', 'web', 'db', 'cache', 'cdn', 'session'],
  limits: { dns: 1, lb: 2, web: 2, db: 3, cache: 3, cdn: 1, session: 1 },
  limitMsg: {
    dns: ONE_DNS,
    lb: TWO_LBS,
    web: 'Two web servers is the limit here. To carry more, set them to autoscale: each one becomes a group that runs more servers of its size as traffic grows.',
    db: THREE_DBS,
    cache: THREE_CACHES,
    cdn: ONE_CDN,
    session: 'One session store is enough: the provider runs it on several machines for you.',
  },
  // Level 5's design: a CDN with a 1-day TTL, new names for changed files and fallback to the origin.
  startNodes: [
    { id: 'u', type: 'users', x: 380, y: 60 },
    { id: 'd', type: 'dns', x: 120, y: 60 },
    { id: 'k', type: 'cdn', x: 640, y: 60, ttl: '86400', onChange: 'version', fallback: 'origin' },
    { id: 'l1', type: 'lb', x: 250, y: 168, algo: 'rr' },
    { id: 'l2', type: 'lb', x: 510, y: 168, algo: 'rr' },
    { id: 'w1', type: 'web', x: 250, y: 276, size: 'XL', scaling: 'fixed' },
    { id: 'w2', type: 'web', x: 510, y: 276, size: 'XL', scaling: 'fixed' },
    { id: 'c1', type: 'cache', x: 120, y: 372, size: 'L', ttl: '600', onWrite: 'delete' },
    { id: 'c2', type: 'cache', x: 640, y: 372, size: 'L', ttl: '600', onWrite: 'delete' },
    { id: 'b', type: 'db', x: 120, y: 468, size: 'XL', kind: 'sql', role: 'primary' },
    { id: 'r1', type: 'db', x: 640, y: 468, size: 'XL', kind: 'sql', role: 'replica' },
  ],
  startEdges: [
    { id: 's1', from: 'u', to: 'd' }, { id: 's2', from: 'u', to: 'l1' }, { id: 's3', from: 'u', to: 'l2' },
    { id: 's4', from: 'l1', to: 'w1' }, { id: 's5', from: 'l1', to: 'w2' }, { id: 's6', from: 'l2', to: 'w1' }, { id: 's7', from: 'l2', to: 'w2' },
    { id: 's8', from: 'w1', to: 'b' }, { id: 's9', from: 'w2', to: 'b' }, { id: 's10', from: 'w1', to: 'r1' }, { id: 's11', from: 'w2', to: 'r1' },
    { id: 's12', from: 'w1', to: 'c1' }, { id: 's13', from: 'w2', to: 'c1' }, { id: 's14', from: 'w1', to: 'c2' }, { id: 's15', from: 'w2', to: 'c2' },
    { id: 's16', from: 'u', to: 'k' }, { id: 's17', from: 'k', to: 'l1' }, { id: 's18', from: 'k', to: 'l2' },
  ],
  slots: {
    dns: { x: 120, y: 60 }, lb: { x: 510, y: 168 }, web: { x: 510, y: 276 }, cdn: { x: 640, y: 60 }, session: { x: 380, y: 468 },
    cache: [{ x: 120, y: 372 }, { x: 640, y: 372 }, { x: 380, y: 372 }],
    db: [{ x: 640, y: 468 }, { x: 120, y: 468 }, { x: 380, y: 372 }],
  },

  connections: {
    ok: {
      'dns|users': dnsLookup(),
      'lb|users': usersToLb(),
      'lb|web': lbToWeb(),
      'db|web': webToReplicas(),
      'cache|web': webToCache(),
      'cdn|users': usersToCdn(),
      'cdn|lb': cdnToLb(),
      'session|web': { from: 'web', to: 'session', label: 'sessions', desc: 'Every page reads the shopper\'s session here first, by the session ID in their cookie: one lookup of 3 ms plus the hop. Changes to the cart are written back. The web server keeps nothing in its own memory between requests.' },
    },
    bad: {
      ...lbBad(), ...replicaBad(), ...cacheBad(), ...cdnBad(),
      'lb|session': 'The load balancer does not read sessions. Connect the web servers to the session store: they look up each shopper\'s session.',
      'session|users': 'Browsers only keep a cookie with the session ID. Connect the web servers to the session store.',
      'db|session': 'The database holds products and orders; sessions go in their own store. Connect the web servers to the session store.',
      'cache|session': 'The cache holds product data. Connect the web servers to the session store.',
      'cdn|session': 'Static files need no session. Connect the web servers to the session store.',
      'dns|session': 'The session store needs no connection to DNS. Connect the web servers to it.',
      'session|session': 'One session store is enough: the provider runs it on several machines for you.',
    },
  },

  missions: [
    {
      title: 'Empty carts', ref: 'Sessions', ...LOAD, sessions: true, budget: BUDGET,
      story: 'Shoppers can now log in and fill a cart. Each web server keeps the carts of the shoppers it served in its own memory. The load balancer sends each request to the next server in turn, so half the time a shopper lands on the other server and finds an empty cart. Make every page find its cart.',
      goals: [servedGoal(targets), latGoal(targets), costGoal(BUDGET)],
      hint: 'Two fixes work. Select a load balancer and pick sticky sessions, so each shopper stays on one server. Or add a session store and connect both web servers to it, so any server can find any cart.',
      takeaway: 'Every page finds its cart now. With sticky sessions, each cart still lives on one server, and Mission 2 takes one away. With a session store, the web servers keep nothing between requests: they are stateless.',
    },
    {
      title: 'An update at 10:00', ref: 'Stateless web tier', ...LOAD, sessions: true, budget: BUDGET,
      story: 'You deploy a new version at 10:00, when traffic is 2,160 req/s: one web server leaves the pool while it restarts. Every shopper on it must keep their cart and stay logged in.',
      goals: [
        servedGoal(targets), latGoal(targets), spofGoal(), costGoal(BUDGET),
        { id: 'update-web', type: 'exp', text: 'Break it: take a web server out; no shopper loses their cart' },
      ],
      hint: 'Carts kept in a server\'s memory leave with that server, sticky or not. Add a session store, connect both web servers to it, and round robin is fine again.',
      takeaway: 'Nobody noticed: the other web server read every cart from the session store. A stateless server can be removed, replaced or added at any time, which is what an autoscaler does all day.',
    },
    {
      title: 'Quiet nights', ref: 'Autoscaling', ...LOAD, sessions: true, budget: NIGHT_BUDGET,
      gate: {
        hidesTraffic: false,
        lo: 4.1, hi: 5,
        prompt: '<b>Estimate before you build.</b> At the 20:00 peak, each of your two web servers gets 1,000 pages a second. Say each becomes a group of M servers: 400 req/s each, which the autoscaler keeps at most 60% busy. How many M servers does one group run at the peak?',
        label: 'Servers in one group',
        placeholder: 'e.g. 3',
        acceptedHtml: '<p><b>Estimate accepted.</b></p><div class="calc">60% of 400 req/s = 240 req/s per server<br>1,000 ÷ 240 ≈ 4.2, so 5 servers at the peak<br>At 04:00 traffic is 15% of the peak: 150 ÷ 240, so 1 server</div>',
        acceptedLog: 'Estimate accepted: 5 M servers per group at the peak, 1 at 04:00. Play is unlocked.',
        notNumber: 'Type the estimate as a number of servers, for example 3.',
        hints: [
          { test: (v) => v >= 2.4 && v <= 3, text: 'That runs each server at 100% busy. The autoscaler keeps each one at 60%: 240 req/s.' },
          { test: (v) => v >= 8 && v <= 10, text: 'That is both groups. Each group gets half the pages: 1,000 a second.' },
          { test: (v) => v >= 4 && v < 4.1, text: 'Four servers carry 960 req/s at 60% busy, short of 1,000. Round up.' },
        ],
        fallback: 'Not quite. Each server may carry 60% of 400 req/s. Divide the group\'s 1,000 pages a second by that, and round up.',
      },
      story: 'Traffic follows the day: 4,000 req/s at the 20:00 peak, but only 600 at 04:00. Two XL web servers sized for the peak run all night for nothing. Finance wants the bill at $2,900 a month. Let the web tier grow and shrink with traffic, then run a whole day.',
      goals: [
        { id: 'est', type: 'gate', text: 'Estimate the servers at the peak' },
        servedGoal(targets), latGoal(targets), spofGoal(), costGoal(NIGHT_BUDGET),
        { id: 'run-day', type: 'exp', text: 'Break it: run a day; nobody is logged out, at least 99% served' },
      ],
      hint: 'Select each web server and set it to autoscale. A group can\'t shrink below one server of its size, so pick a smaller size, such as M. Keep the session store: the autoscaler removes servers every night.',
      takeaway: 'The web tier now follows traffic, and costs about half as much. That only works because the servers are stateless: the autoscaler removed servers all night, and no shopper noticed. Next, the whole data center: what if it goes offline?',
    },
  ],

  // Break-it experiments. A crash takes down the component `target` picks when it starts, or of its `targets` the one
  // whose loss hurts most; `factor` sets the traffic while it runs. A day plays 24 hours in `secs` seconds. `expect`
  // is the outcome that must hold.
  experiments: [
    {
      id: 'update-web', kind: 'crash', factor: day[10], hud: 'at 10:00', // the day curve's traffic at 10:00
      targets: (g) => g.onPath('web'), // any web server could be the one updated; the test takes out the biggest loss
      label: 'Take a web server out', labelOn: 'Put it back',
      needsDesign: 'Build the design first: the load balancer needs web servers to take one out.',
      on: 'A web server is out of the pool for the update. Traffic is 2,160 req/s.', onTone: 'bad',
      off: 'The web server is back in the pool.',
      expect: (m) => served99(m) && kept(m),
      notMet: (m) => (!kept(m)
        ? `${fmtPct(m.lostPct, PCT)} of shoppers had their session on the web server that left. They are logged out and their carts are empty. Keep sessions in a session store that both web servers use.`
        : `Only ${m.servedPct.toFixed(1)}% served while a web server is out. The other web server must carry every page alone.`),
      observed: () => 'Observed: a web server is out, and no shopper noticed. The other web server took every page and read each shopper\'s cart from the session store.',
    },
    {
      id: 'run-day', kind: 'day', secs: 24, hud: (h) => `at ${clock(h)}`,
      label: 'Run a day', labelOn: 'Stop the day',
      needsDesign: 'Build the design first, then run a day.',
      on: 'The day starts at 00:00. Each second is one hour.', onTone: '',
      off: 'Day stopped.',
      expect: (m) => served99(m) && kept(m),
      notMet: (m) => (!kept(m)
        ? `The autoscaler removed servers that held carts in memory: ${fmtPct(m.lostPct, PCT)} of shoppers were logged out. Keep sessions in the session store, so servers can be removed safely.`
        : `Only ${m.servedPct.toFixed(1)}% served. A web server ran out of capacity: a fixed server can't grow, and a group stops at 10 servers.`),
      observed: () => 'Observed: a whole day, and nobody was logged out. The groups shrank at night and grew for the 20:00 peak.',
    },
  ],

  // Messages the engine shows for this level's design.
  text: {
    ...lbText(),
    ...replicaText(),
    noOrigin: NO_ORIGIN,
    sessionMiss: (name, miss) => `${fmtPct(100 * miss, PCT)} of pages reaching the ${name.toLowerCase()} fail: the shopper's session is on another server, so the cart looks empty. Pick sticky sessions on the load balancer, or share sessions in a session store.`,
    levelComplete: levelComplete(6),
  },

  quiz: {
    passScore: 8,
    passText: passText(6, 'Multiple data centers'),
    failText,
    questions: [
      { q: 'What makes a web server stateful?', o: ['It runs on a private IP address in the data center', 'It remembers client data between requests', 'It reads data from a database', 'It sits behind a load balancer'], a: 1, e: 'A stateful server keeps client data, such as a session, from one request to the next. A stateless server keeps nothing between requests and fetches what it needs from a shared store.', r: 'Why did the cart disappear?' },
      { q: 'Ana\'s cart is in Server 2\'s memory. Her next request goes to Server 3. What does she see?', o: ['Her cart, copied over by the load balancer', 'An error page until Server 2 recovers', 'An empty cart, and maybe a login page', 'Her cart, read from the browser cookie'], a: 2, e: 'Server 3 has no record of Ana\'s session, so her cart looks empty, and if her login was kept there too, she is logged out. Her cookie only holds a session ID.', r: 'Why did the cart disappear?' },
      { q: 'What do sticky sessions do?', o: ['Send all of a user\'s requests to one server', 'Copy every session to every web server', 'Store sessions in the browser', 'Keep a server in the pool after it fails its check'], a: 0, e: 'The load balancer sends every request from one user to the same server, usually remembered in a cookie. Sessions in that server\'s memory are then always found.', r: 'How can every page find its cart?' },
      { q: 'Why are sticky sessions a weak fix?', o: ['They need a bigger load balancer', 'They slow every request by a full extra round trip', 'They only work with NoSQL databases', 'Removing or losing a server drops its sessions'], a: 3, e: 'Each session still lives on one server. Remove it for an update or because traffic fell, or lose it to a failure, and its users are logged out. Adding servers helps slowly too, since existing users stay where they are.', r: 'What happens to carts when a server leaves?' },
      { q: 'In a stateless web tier, where does session data live?', o: ['In each web server\'s own memory, as before', 'In a data store every web server shares', 'In the load balancer\'s routing table', 'In the CDN edge nearest the user'], a: 1, e: 'Sessions move to a shared store: a relational database, Redis or Memcached, or a NoSQL database. Any web server can then handle any request.', r: 'What makes a web tier stateless?' },
      { q: 'Why is NoSQL a common choice for the session store?', o: ['It joins tables faster than SQL', 'It needs no network hop', 'It is easy to scale out', 'Browsers can read it directly'], a: 2, e: 'Session data is simple: one value per session ID, with no joins. A key-value or NoSQL store handles that well and grows by adding machines.', r: 'What makes a web tier stateless?' },
      { q: 'What does autoscaling do?', o: ['Moves sessions between servers', 'Adds and removes servers as load changes', 'Picks the fastest server for each request', 'Resizes the database every night'], a: 1, e: 'An autoscaler watches a measure such as how busy the servers are. It adds servers when that rises and removes them when it falls, and you pay only for the hours they run.', r: 'What does an autoscaler do?' },
      { q: 'Why does autoscaling need a stateless web tier?', o: ['Removing a stateful server drops its sessions', 'Stateless servers boot faster', 'Stateful servers cannot be monitored', 'The load balancer cannot reach stateful servers'], a: 0, e: 'When traffic falls, the autoscaler removes servers. A stateful server takes its sessions with it, so those users are logged out. With sessions in a shared store, any server can go.', r: 'What does an autoscaler do?' },
      { q: 'Peak traffic is 3,000 req/s. Each server handles 500 req/s, and the autoscaler keeps each one at most 60% busy. How many servers run at the peak?', o: ['12', '6', '10', '8'], a: 2, e: '60% of 500 is 300 req/s per server, and 3,000 ÷ 300 = 10 servers. Six would run every server at 100% busy.', r: 'How many servers run at the peak?' },
      { q: 'The session store is now on every page\'s path. What must you plan for?', o: ['It must also serve static files', 'It must sit in front of the load balancer', 'It must hold the product catalog', 'It must not be a single point of failure'], a: 3, e: 'If the session store fails, no web server can find any session. Run it on several machines, or use a managed service that does.', r: 'What makes a web tier stateless?' },
    ],
  },

  lesson,

  // Lesson diagrams. `f` provides the engine's drawing helpers. Each figure sets its own viewBox.
  drawFigures(f) {
    const { $, svgEl, figNode, figArrow, figSvg, figLabel } = f;
    // Stateful: Ana's cart is in server 1's memory; round robin sends her next request to server 2.
    const f1 = figSvg($('figStateful'), 280);
    figNode(f1, 'users', 320, 40, 'Ana', 'Logged in');
    figNode(f1, 'lb', 320, 140, 'Load balancer', 'Each server in turn');
    figNode(f1, 'web', 150, 240, 'Server 1', 'Ana: 2 items');
    figNode(f1, 'web', 490, 240, 'Server 2', 'Ben: 1 item');
    figArrow(f1, 320, 70, 320, 110, 'requests', null, 332, 94);
    figArrow(f1, 270, 170, 190, 210, 'add to cart', '1', 90, 190);
    figArrow(f1, 370, 170, 450, 210, 'view cart: empty', '2', 470, 190);

    // Stateless: any server answers Ana and Ben, every server uses one session store, and server 2 can leave.
    const f2 = figSvg($('figStateless'), 370);
    figNode(f2, 'users', 180, 40, 'Ana', 'Logged in');
    figNode(f2, 'users', 460, 40, 'Ben', 'Logged in');
    figNode(f2, 'lb', 320, 140, 'Load balancer', 'Any server');
    figArrow(f2, 220, 70, 290, 110, '', null, 0, 0);
    figArrow(f2, 420, 70, 350, 110, '', null, 0, 0);
    figNode(f2, 'web', 110, 240, 'Server 1', 'Keeps nothing');
    figNode(svgEl('g', { class: 'fig-down' }, f2), 'web', 320, 240, 'Server 2', 'Removed: no loss');
    figNode(f2, 'web', 530, 240, 'Server 3', 'Keeps nothing');
    figArrow(f2, 280, 170, 150, 210, '', null, 0, 0);
    figArrow(f2, 360, 170, 490, 210, '', null, 0, 0);
    figNode(f2, 'session', 320, 336, 'Session store', 'Ana: 2, Ben: 1');
    figArrow(f2, 150, 270, 250, 306, '', null, 0, 0);
    figArrow(f2, 490, 270, 390, 306, '', null, 0, 0);
    figLabel(f2, 320, 294, 'read and write');

    drawDay(f, $('figDay'));
    drawBuilt(f, $('figBuilt'));
    drawBuilt(f, $('figBuiltEnd'));
  },
};
