// @ts-check
/** @import { Level, Lesson } from '../js/types.js' */
// Level 1: One server to two tiers.
// Everything specific to this level lives here: components, rules, missions, quiz and text.
import { fmt, percent, ms, rate } from '../js/format.js';
import { SIZES, T, COMPONENTS, SLOWDOWN_CAP_FROM, qmul } from '../js/engine/catalog.js';
import { STEPS } from './mock-steps.js';
import { servedGoal, latGoal } from './shared/goals.js';
import { levelComplete } from './shared/text.js';
import { failText, passText } from './shared/quiz.js';

const targets = { latencyMs: 150, servedPct: 99 };
/** The web server's placeholder address, from the range set aside for examples. */
const address = '203.0.113.42';
/** How many times normal traffic the spike experiment sends. */
const spikeFactor = 10;
/** Peak traffic of each mission, in req/s. */
const traffic = [50, 150, 463];
/** Seconds a mission's targets must hold. */
const HOLD = T.hold;

// The web server Users reach first, and the database it connects to (null when there is none).
const webOf = (g) => g.entry.find((n) => n.type === 'web') || null;
const dbOf = (g) => { const web = webOf(g); return web ? g.next(web).find((n) => n.type === 'db') || null : null; };


// ---------------- Lesson ----------------
// Small text helpers. Nothing here changes a number; they only format it.
const times = (busy) => `${Math.round(qmul(busy) * 10) / 10}×`; // how much longer a request takes: 0.75 → "4×"
const perUnit = (size) => `$${(Math.round((size.cost / size.cap) * 100) / 100).toFixed(2)}`; // S → "$0.20" per req/s

// The busy-server screen's example server: the M size's capacity, with 300 req/s arriving (our example load, not a game number).
const ex = { cap: SIZES.M.cap, load: 300 };
ex.busy = ex.load / ex.cap;

// The scaling screen's table: one row per server size, straight from the catalog.
const sizeNames = Object.keys(SIZES);
const largest = sizeNames[sizeNames.length - 1];
const sizeRows = sizeNames.map((name) => {
  const size = SIZES[name];
  return [`${name} · ${size.cpu} vCPU${name === largest ? ' (largest)' : ''}`, `${fmt(size.cap)} req/s`, `$${size.cost}`, perUnit(size)];
});
const { S, M, L, XL } = SIZES;

// The web server's rule when it has no database server, and the two database types.
const sharedCapacity = COMPONENTS.web.alone.capFactor;
const sqlQueries = COMPONENTS.db.kinds.sql.per;
const nosqlLookups = COMPONENTS.db.kinds.nosql.per;

// The slowdown cap: where it starts, and what qmul returns for a full server.
const capFrom = SLOWDOWN_CAP_FROM;
const capTimes = `${qmul(1)}×`;

// Debrief 1: Mission 1's server is an S that also runs the database. Its response time is the combined work time
// slowed by how busy it is, plus the internet round trip (tests/integration/level-01.test.mjs checks the same 100 ms).
const shared = { cap: S.cap * sharedCapacity, work: COMPONENTS.web.alone.base };
const mission1Ms = shared.work * qmul(traffic[0] / shared.cap) + T.rtt;

// The scaling screen's example sale: our example load, sent at the spike experiment's factor.
const sale = { load: 300, factor: spikeFactor };

// The wrap-up's interview loop: the mock interview's four steps, by name.
const [scope, sketch, deep, stress] = STEPS.map((step) => `<b>${step.name}</b>`);

/** @type {Lesson} */
const lesson = {
  intro: {
    kicker: 'Level 1 · Part 1: Grow one app',
    title: 'One server to two tiers',
    // "nine times": tests/unit/level-01-lesson.test.mjs checks it against the missions' traffic.
    story: `You are the only engineer at a small online shop, example.com. Today it runs on one $${S.cost} server. During this level its traffic grows nine times, and your job is to keep it fast.`,
    picture: 'figBuilt',
    alt: 'The finished design: Users look up example.com in DNS and send requests to the web server. The web server sends queries to the database.',
    outcomes: [
      'explain how a request finds your server',
      'say why a busy server is slow before it is down',
      'decide when to split off the database, and which kind to use',
      'turn "a million users" into requests per second',
      'name the two limits of one big machine',
    ],
  },
  chapters: [
    {
      title: 'Go live',
      mission: 0,
      minutes: 5,
      screens: [
        {
          title: 'How does a phone find your server?',
          hook: 'Someone types <b>example.com</b>. Their phone knows the name, but the internet delivers to numbered addresses. Something has to turn the name into a number.',
          check: {
            kind: 'guess',
            q: 'Once DNS has answered, where do the page requests travel?',
            options: [
              { t: 'To DNS, which forwards them to your server', why: 'DNS does not forward traffic. It answers one question, "where is example.com?", and steps out of the way.' },
              { t: 'Straight to your server\'s address', right: true, why: 'DNS only hands back the address. Every request then goes directly to your server.' },
              { t: 'To DNS first on every request, then to your server', why: 'The phone remembers the answer, so it does not ask again each time. And pages never pass through DNS.' },
            ],
          },
          body: [
            {
              figure: 'figFlow',
              alt: `The phone asks DNS where example.com is and gets back the IP address ${address}. It then sends requests straight to the web server at that address and gets the page or the data back.`,
              caption: 'One lookup, then direct requests',
            },
            { ol: [
              `The phone asks <b>DNS</b>: where is example.com? DNS is a service you rent ($${T.dns} a month in the game).`,
              `DNS answers with an <b>IP address</b>, ${address}. The phone remembers it.`,
              'Every request now goes <b>straight to your server</b> at that address, and the page or the data comes straight back.',
            ] },
          ],
          takeaway: 'DNS answers "where is it?" once, and your pages never travel through it.',
          uses: 'You connect Users to DNS and to a web server. Watch for one DNS lookup dot, then requests going direct.',
          quiz: [0],
        },
        {
          title: 'How do you know your design works?',
          hook: 'In an interview you say "this design handles the load". In this game you have to prove it. Four of the numbers at the top of the Build screen tell you.',
          body: [
            { table: { head: ['Number', 'What it means', 'Goal in this level'], rows: [
              ['<b>Traffic</b>', 'Requests arriving each second (req/s)', 'Set by the mission'],
              ['<b>Served</b>', 'Share of requests that got an answer', `At least ${targets.servedPct}%`],
              ['<b>Response</b>', 'Average time from tap to answer', `Under ${ms(targets.latencyMs)}`],
              ['<b>Cost</b>', 'The monthly bill for everything on the canvas', 'The mission\'s budget'],
            ] } },
            { p: `Response time has two parts: the trip across the internet and back (${ms(T.rtt)} in the game), and the time your servers take. You control only the second part.` },
          ],
          takeaway: 'Served says it works, Response says it is fast, Cost says you can afford it.',
          uses: `The mission passes when Served and Response hold their goals for ${HOLD} seconds after you press Play.`,
          quiz: [1],
        },
      ],
      // "triple" and "one request in three": tests/unit/level-01-lesson.test.mjs checks them against the missions.
      debrief: {
        saw: `One DNS lookup, then every request went straight to your server. One $${S.cost} machine ran your code and your data.`,
        number: [`about ${ms(Math.round(mission1Ms))}`, `response time at ${rate(traffic[0])}`],
        next: `Traffic is about to triple to ${rate(traffic[1])}. This machine can carry ${fmt(shared.cap)}. One request in three would fail.`,
      },
    },
    {
      title: 'Split the data',
      mission: 1,
      minutes: 8,
      screens: [
        {
          title: 'Why is a busy server slow?',
          hook: `A server can handle ${fmt(ex.cap)} requests a second and is getting ${fmt(ex.load)}. Nothing is failing. So why does the site feel slow?`,
          check: {
            kind: 'guess',
            q: `The server is ${percent(ex.busy)} busy. Compared with an idle server, how long does each request take?`,
            options: [
              { t: 'About 1.3× as long', why: 'A quarter of spare room feels like plenty, but requests wait in line behind each other, and the wait grows much faster than the load.' },
              { t: `About ${times(0.5)} as long`, why: `That is what happens at ${percent(0.5)} busy. At ${percent(ex.busy)} it is already worse.` },
              { t: `About ${times(ex.busy)} as long`, right: true, why: `Time = work time ÷ (1 − busy). At ${percent(ex.busy)} busy that is 1 ÷ ${1 - ex.busy} = ${times(ex.busy)}.` },
            ],
          },
          body: [
            { p: 'Requests wait in line behind each other. The fuller the server, the longer the line. Requests fail only when the load is more than the capacity.' },
            {
              calc: {
                formula: 'Busy = load ÷ capacity. Time = work time ÷ (1 − busy).',
                rows: [
                  { label: 'How busy?', work: `${rate(ex.load)} ÷ ${rate(ex.cap)}`, result: `${percent(ex.busy)} busy` },
                  { label: 'How slow?', work: `${ms(T.web)} ÷ (1 − ${ex.busy})`, result: ms(T.web * qmul(ex.busy)) },
                ],
                result: `${ms(T.web)} of work now takes ${ms(T.web * qmul(ex.busy))}: ${times(ex.busy)} as long, and nothing has failed.`,
              },
            },
            {
              figure: 'figQueue',
              alt: `Time per request against how busy the server is. It climbs slowly at first, then steeply: ${times(0.5)} at ${percent(0.5)} busy, ${times(0.75)} at ${percent(0.75)}, ${times(0.9)} at ${percent(0.9)}, and it is capped at ${qmul(1)} times from ${percent(capFrom)}.`,
              caption: 'Time per request against how busy the server is',
            },
          ],
          takeaway: `Slow comes long before down: ${times(0.5)} at ${percent(0.5)} busy, ${times(0.75)} at ${percent(0.75)}, ${times(0.9)} at ${percent(0.9)}.`,
          uses: `The bar under each server shows how busy it is. Watch the response time when a bar passes ${percent(0.75)}.`,
          quiz: [2, 3],
        },
        {
          title: 'Why give the database its own machine?',
          hook: 'Your one machine runs the code and the database. Every request needs both, so they share the same processor and memory.',
          body: [
            {
              figure: 'figTiers',
              alt: `Before: users send requests to one machine that runs both the code and the data, at ${percent(sharedCapacity)} of its capacity. After: users send requests to the web server in the web tier, which sends queries to the database server in the data tier and gets rows back. Each tier can be scaled on its own.`,
              caption: 'Before: one machine for code and data. After: a web tier and a data tier, each on its own machine',
            },
            { p: 'Put the database on its own server. Now there is a <b>web tier</b>, which answers requests, and a <b>data tier</b>, which keeps the data. When one is full, you upgrade that one and leave the other alone.' },
            { p: 'What it does not fix: each tier is still one machine. If either stops, the shop stops.' },
            { assume: `Game rule: a server that runs both code and data handles ${percent(sharedCapacity)} of its listed capacity. An S server (${rate(S.cap)}) carries ${fmt(S.cap * sharedCapacity)}.` },
          ],
          takeaway: 'Two tiers let you grow the busy part without paying to grow the rest.',
          uses: `Add a Database and connect it. An S web server gets its full ${rate(S.cap)} back.`,
          quiz: [4, 5],
        },
        {
          title: 'Which kind of database?',
          hook: 'The shop stores users, products and orders. Every order links a user to products. Showing one order page means collecting all three.',
          body: [
            { table: { head: ['', 'Relational (SQL)', 'NoSQL'], rows: [
              ['<b>How it stores data</b>', 'Tables that link to each other', 'Items you fetch by their key'],
              ['<b>Linked data</b>', 'One query joins the tables', 'No joins: the app fetches each piece'],
              ['<b>One order page</b>', `${sqlQueries} query`, `${nosqlLookups} lookups`],
            ] } },
            {
              calc: {
                formula: 'A shop showing 100 order pages a second:',
                rows: [
                  { label: 'With SQL', work: `100 pages/s × ${sqlQueries} query`, result: `${fmt(100 * sqlQueries)} queries/s` },
                  { label: 'With NoSQL', work: `100 pages/s × ${nosqlLookups} lookups`, result: `${fmt(100 * nosqlLookups)} lookups/s` },
                ],
                result: `An S database carries ${fmt(S.cap)} a second. SQL fits. NoSQL is overloaded.`,
              },
            },
          ],
          check: {
            kind: 'turn',
            q: 'An app saves each user\'s settings as one object. It always reads and writes the whole object by user ID, thousands of times a second. Which fits better?',
            options: [
              { t: 'A relational (SQL) database', why: 'It would work, but nothing here needs joins. This is a look-up by key at a very high rate.' },
              { t: 'A NoSQL key-value store', right: true, why: 'Whole objects, fetched by key, with no links between them: that is what key-value stores are built for.' },
            ],
          },
          takeaway: 'Start with SQL, and pick NoSQL only when you can say the reason out loud.',
          uses: 'You pick the database type for the shop\'s data. The Database\'s settings show what each choice costs.',
          quiz: [6, 7],
        },
      ],
      debrief: {
        saw: `The database got its own server and the web server got its full capacity back. Where a server's bar passed ${percent(0.75)}, the response time climbed with nothing failing.`,
        number: [`${times(0.75)} at ${percent(0.75)} busy`, 'the slowdown you had to design around'],
        // "a million users": tests/unit/level-01-lesson.test.mjs checks it against Mission 3's story.
        next: 'Marketing promises a million users on launch day. How many requests a second is that?',
      },
    },
    {
      title: 'Launch day',
      mission: 2,
      minutes: 12,
      screens: [
        {
          title: 'How many requests is "a million users"?',
          hook: 'Marketing counts users per day. Servers are sized in requests per second. In an interview you turn one into the other, out loud.',
          body: [
            { p: 'Traffic is not flat through the day, so plan for a peak of about twice the average. Take a photo app with 40 million daily users who each load 30 pages a day.' },
            {
              calc: {
                formula: 'Peak = daily users × requests each ÷ 86,400 × 2 (86,400 is the seconds in a day).',
                rows: [
                  { label: 'Requests a day', work: '40 million users × 30 requests', result: '1.2 billion requests' },
                  { label: 'Average', work: '1.2 billion requests ÷ 86,400 s', result: '13,900 req/s', approx: true },
                  { label: 'Peak', work: '13,900 req/s × 2', result: '28,000 req/s', approx: true },
                ],
                result: 'Plan for about 28,000 requests a second.',
              },
            },
            { assume: '"Peak is about twice the average" is a rule of thumb. In an interview, say it as an assumption.' },
          ],
          check: {
            kind: 'turn',
            q: 'A recipe site has 5 million daily users who each make 10 requests a day. Roughly what is the peak?',
            options: [
              { t: 'About 580 req/s', why: 'That is the average: 50 million ÷ 86,400 ≈ 580. Double it for the peak.' },
              { t: 'About 1,160 req/s', right: true, why: '5 million × 10 ÷ 86,400 ≈ 580 on average, × 2 ≈ 1,160 at peak.' },
              { t: 'About 50 million req/s', why: 'That is requests per day. Divide by the 86,400 seconds in a day.' },
            ],
          },
          takeaway: 'Daily users × requests each ÷ 86,400, then × 2 for the peak.',
          uses: 'Play stays locked until you estimate the launch-day peak yourself.',
          quiz: [8],
        },
        {
          title: 'A bigger machine, or more machines?',
          hook: 'The server is nearly full and launch day is coming. The quickest fix is to rent a bigger one. How far does that get you?',
          body: [
            { p: '<b>Scaling up</b> (vertical scaling) means a bigger machine. Nothing else in the design changes, so it is the right first move. <b>Scaling out</b> (horizontal scaling) means more machines sharing the work. That needs a load balancer, which is Level 2.' },
            { table: { head: ['Size', 'Capacity', 'Cost a month', 'Cost per req/s'], num: true, rows: sizeRows } },
            { p: 'Bigger machines cost more for each request they carry.' },
          ],
          check: {
            kind: 'turn',
            q: `A shop at ${rate(sale.load)} runs a sale and gets ${sale.factor} times the traffic. Which single server carries it?`,
            options: [
              { t: 'L', why: `${sale.factor} times ${fmt(sale.load)} is ${rate(sale.load * sale.factor)}. L carries ${fmt(L.cap)}.` },
              { t: 'XL', why: `XL carries ${rate(XL.cap)}, about half of the ${fmt(sale.load * sale.factor)} arriving.` },
              { t: 'None of them', right: true, why: `${rate(sale.load * sale.factor)} is more than the largest machine can carry. One machine has a ceiling.` },
            ],
          },
          takeaway: 'Scale up first, but it ends at the biggest machine, and one machine has no backup.',
          uses: `After the targets pass, two Break it buttons let you crash the server and send ${spikeFactor} times the traffic.`,
          quiz: [9],
        },
      ],
    },
  ],
  wrap: {
    picture: 'figBuiltEnd',
    alt: 'The design you built: Users look up example.com in DNS and send requests to the web server. The web server sends queries to the database.',
    say: [
      `"A server gets slow long before it fails. At ${percent(0.75)} busy, requests take ${times(0.75)} as long."`,
      '"I would split the web tier from the data tier so each grows on its own, and start with SQL."',
      '"Peak traffic is daily users × requests each ÷ 86,400, times 2."',
    ],
    numbers: [
      ['86,400', 'seconds in a day'],
      ['2×', 'peak over average (rule of thumb)'],
      [`${times(0.75)} at ${percent(0.75)}`, 'busy-server slowdown'],
    ],
    loop: `In Mission 3 you did the four steps of a design interview in order: ${scope} (you estimated the traffic), ${sketch} (you built the design), ${deep} (you tuned the sizes), ${stress} (you broke it). Every level from here repeats that loop.`,
    broken: `When the web server crashed, the whole shop went down. At ${spikeFactor} times the traffic, no size was big enough. Level 2 fixes both with a load balancer and more servers.`,
  },
  rules: `Web server work ${ms(T.web)}, database query ${ms(T.db)}, internet round trip ${ms(T.rtt)}, round trip inside the data center ${ms(T.dc)}, DNS $${T.dns} a month. A NoSQL lookup takes ${ms(T.nosqlLookup)}. Time per request = work time ÷ (1 − busy), a standard queueing result (M/M/1); real servers differ in detail but bend the same way. From ${percent(capFrom)} busy, a request takes at most ${capTimes} its work time; only load above 100% fails.`,
};

// Quiz examples, with numbers different from the lesson's own examples (our example loads, not game numbers).
const quizBusy = { cap: 500, load: 450, work: 15 };
quizBusy.busy = quizBusy.load / quizBusy.cap;
quizBusy.ms = Math.round(quizBusy.work * qmul(quizBusy.busy));
const quizPages = 200;

/** @type {Level} */
export default {
  id: 1,
  saveKey: 'sdl-level1-v1',
  saveVersion: 2, // quiz options were reordered in v2, so older saved answers no longer line up
  quizVersion: 3, // v3 replaced five questions and reordered them, so older saved answers no longer line up
  targets,

  components: {
    users: { name: 'Users', sub: 'Web + mobile app', desc: 'Your visitors. Browsers load www.example.com and the mobile app calls api.example.com. Both send HTTP requests.' },
    dns: { name: 'DNS', short: 'Domain → IP address', sub: 'Third-party · $5', desc: 'Turns example.com into an IP address. Usually a paid third-party service, not hosted on your servers. Costs $5/month in this game.' },
    web: { name: 'Web server', short: 'Your back-end code', desc: 'Runs your back-end code. Returns HTML pages to browsers and JSON to the mobile app.', noDbNote: 'No database server yet, so this machine also runs the database and handles half its capacity.' },
    db: {
      name: 'Database', short: 'Stores data on disk', desc: 'Keeps your data on disk so it survives restarts. On its own server, it becomes the data tier.',
      unsetSub: 'Pick SQL or NoSQL',
      kindsLabel: 'Database type',
      unsetNote: 'Not chosen yet. Read the mission brief, then pick.',
      kinds: [
        { id: 'sql', short: 'SQL', name: 'Relational', sub: 'SQL · joins', tone: 'ok', log: 'Database set to relational (SQL): tables, rows and joins. One query fetches an order with its user and products.', note: 'Relational: tables and rows, joins with SQL. The safe default for most apps. One query per request here.' },
        { id: 'nosql', short: 'NoSQL', name: 'NoSQL', sub: 'no joins', tone: 'warn', log: 'Database set to NoSQL. It cannot join, so each request needs 3 lookups to gather a user, an order and its products.', note: 'NoSQL: key-value, graph, column or document stores. Fast per lookup, but no joins: 3 lookups per request for this relational data.' },
      ],
    },
  },
  palette: ['dns', 'web', 'db'],
  limits: { dns: 1, web: 1, db: 1 },
  limitMsg: {
    dns: 'You only need one DNS service for example.com. To replace it, remove the current one first.',
    web: 'One web server is the limit here. Running several needs a load balancer, which arrives in Level 2.',
    db: 'One database is enough here. Extra copies (replicas) arrive in Level 3.',
  },
  startNodes: [{ id: 'u', type: 'users', x: 380, y: 76 }],
  slots: { dns: { x: 650, y: 76 }, web: { x: 380, y: 262 }, db: { x: 380, y: 436 } },

  connections: {
    ok: {
      'dns|users': { from: 'users', to: 'dns', label: 'DNS lookup', desc: 'The device asks DNS for the IP address of example.com. It happens once, then the answer is cached.' },
      'users|web': { from: 'users', to: 'web', label: 'HTTP requests', desc: 'Users send HTTP requests straight to the web server\'s IP address.' },
      'db|web': { from: 'web', to: 'db', label: 'queries', desc: 'The web server reads and writes data in the database inside the same data center (about 0.5 ms round trip).' },
    },
    bad: {
      'db|users': 'Users never talk to the database directly. Requests go through the web server, which runs your logic and checks permissions.',
      'dns|web': 'DNS does not forward traffic. It only answers "what is the IP of example.com?", then the device connects to the web server itself.',
      'db|dns': 'The database does not need DNS here. DNS is used by your users\' devices to find your web server.',
    },
  },

  missions: [
    {
      title: 'Hello, example.com', ref: 'Single server', qps: traffic[0], budget: null,
      story: 'You just launched example.com and about 100,000 people use it each day. Everything runs on one server: your code and your data.',
      goals: [
        { id: 'dns', type: 'struct', text: 'Users can look up example.com in DNS', test: (g) => g.hasDNS },
        { id: 'web', type: 'struct', text: 'Requests reach a web server', test: (g) => !!webOf(g) },
        servedGoal(targets), latGoal(targets),
      ],
      hint: 'Drag DNS and a Web server onto the canvas. Then drag from the + under Users onto each of them (or select Users and use Connections in the inspector), and press Play.',
      takeaway: 'One server ran everything. DNS returned the IP once, then HTTP requests went straight to your server.',
    },
    {
      title: 'Separate the data tier', ref: 'Two tiers', qps: traffic[1], budget: 150,
      story: 'Traffic tripled: about 300,000 people a day, 150 requests per second at peak. Your one server runs both the code and the database, so they compete for the same CPU. The app stores users, products and orders, and every order links a user to products.',
      goals: [
        { id: 'tier', type: 'struct', text: 'Data lives on its own database server', test: (g) => !!dbOf(g) },
        { id: 'kind', type: 'struct', text: 'Pick the right database type for this data (select the Database, then Database type)', test: (g) => dbOf(g)?.kind === 'sql' },
        servedGoal(targets), latGoal(targets),
        { id: 'cost', type: 'struct', text: 'Spend at most $150 per month', test: (g) => g.cost <= 150, val: (m, g) => '$' + g.cost },
      ],
      hint: 'Add a Database, connect Web server → Database, and choose its type. If the response time is still too slow, read the log: a server at 75% busy makes each request take 4× as long. The web server\'s work (20 ms) is slower than a query (10 ms), so its waiting costs you more. Spend where it helps most.',
      takeaway: 'Separate tiers scale independently. You also saw that a busy server gets slow long before it fails.',
    },
    {
      title: 'Launch day', ref: 'Estimation', qps: traffic[2], budget: 500,
      gate: {
        lo: 370, hi: 560,
        prompt: '<b>Step 1: estimate before you build.</b> Peak QPS = DAU × requests per user per day ÷ 86,400, then × 2 for peak.',
        label: 'Peak req/s',
        placeholder: 'e.g. 500',
        acceptedHtml: '<p><b>Estimate accepted.</b></p><div class="calc">1,000,000 DAU × 20 req ÷ 86,400 s ≈ 231 req/s average<br>Peak ≈ 2 × 231 ≈ 463 req/s</div>',
        acceptedLog: 'Estimate accepted: about 463 req/s at peak. Play is unlocked.',
        notNumber: 'Type the estimate as a number, for example 500.',
        hints: [
          { test: (v) => v >= 180 && v <= 280, text: 'That is the average. Peak traffic is about twice the average.' },
          { test: (v) => v > 9000, text: 'Too high. Did you forget to divide by 86,400 seconds in a day?' },
        ],
        fallback: 'Not quite. Work it out: 1,000,000 × 20 ÷ 86,400, then double it for peak. Rounded answers are fine.',
      },
      story: 'Marketing expects 1,000,000 daily active users after the launch. Each user makes about 20 requests a day, and peak traffic is about twice the average. Scale your servers up to survive it.',
      goals: [
        { id: 'est', type: 'gate', text: 'Estimate the peak traffic' },
        servedGoal(targets), latGoal(targets),
        { id: 'cost', type: 'struct', text: 'Spend at most $500 per month', test: (g) => g.cost <= 500, val: (m, g) => '$' + g.cost },
        { id: 'crash', type: 'exp', text: 'Break it: crash the web server' },
        { id: 'spike', type: 'exp', text: `Break it: send ${spikeFactor}× traffic` },
      ],
      hint: 'Each tier must carry the full peak, and a server slows down sharply as it fills up. Find the cheapest sizes that keep both tiers well below 100% busy. After the targets pass, use the Break it buttons while the simulation runs.',
      takeaway: `Vertical scaling got you through launch day, but you saw its two limits: when the server crashed the whole site went down (no failover), and at ${spikeFactor}× traffic no size was big enough (hard limit). Level 2 fixes both with a load balancer and more servers.`,
    },
  ],

  // Break-it experiments. kind 'crash' takes down the component `target` returns when it starts;
  // kind 'spike' multiplies traffic by `factor`. Each counts once it has run for 1.5 simulated seconds.
  experiments: [
    {
      id: 'crash', kind: 'crash', target: webOf,
      label: 'Crash web server', labelOn: 'Restart web server',
      needsDesign: 'Build the design first: connect Users to DNS and to a web server, then crash it.',
      on: 'You pulled the plug on the web server.', onTone: 'bad',
      off: 'Web server restarted.',
      issue: 'The web server is down. With only one server, every request fails.',
      observed: 'Observed: one server down means the whole site is down. No failover, no redundancy.',
    },
    {
      id: 'spike', kind: 'spike', factor: spikeFactor,
      label: `${spikeFactor}× traffic`, labelOn: 'Back to normal traffic', hud: `${spikeFactor}× spike`,
      needsDesign: 'Build the design first: connect Users to DNS and to a web server, then send the spike.',
      on: (qps) => `Traffic spike: ${fmt(qps)} req/s.`, onTone: 'warn',
      off: 'Traffic back to normal.',
      note: (base) => `At ${fmt(base)} req/s, even the largest size (XL, 1,600 req/s) is not enough. One machine can only grow so far: that is the hard limit of scaling up.`,
      observed: `Observed: no single machine can absorb ${spikeFactor}× traffic. Scaling up has a hard limit.`,
    },
  ],

  // Messages the engine shows for this level's design.
  text: {
    noWeb: 'Users have nowhere to send requests. Connect Users to a web server.',
    noDns: 'Browsers cannot find example.com. Connect Users to DNS so the name resolves to your server\'s IP.',
    combinedOver: ' It runs code and data on one machine, so it only gets half its capacity.',
    nosqlOver: ' NoSQL cannot join, so each request costs 3 lookups.',
    dnsAnswered: `DNS answered: example.com is at ${address}. The device caches it.`,
    ipTag: `IP ${address} cached`,
    levelComplete: levelComplete(1),
  },

  quiz: {
    passScore: 8,
    passText: passText(1, 'Load balancer and horizontal scaling'),
    failText,
    questions: [
      { q: 'A user types api.example.com. What does DNS send back?', o: ['The HTML page for the site', 'A JSON response from the API', 'The IP address of the server', 'A cached copy of the data'], a: 2, e: `DNS turns a domain name into an IP address, for example ${address}. The device then sends requests straight to that address. DNS never carries the page itself.`, r: 'How does a phone find your server?' },
      { q: 'The dashboard shows Served at 92%. What happened to the other 8% of requests?', o: ['They failed: a server was overloaded or down', 'They are still waiting in line to be answered', 'They were answered from a cache', 'They will be counted in the next second'], a: 0, e: 'Served is the share of requests that got an answer. The other 8% failed: more load arrived than a server could carry, or a server was down. A slow answer still counts as served.', r: 'How do you know your design works?' },
      { q: `A server with a capacity of ${rate(quizBusy.cap)} is getting ${rate(quizBusy.load)}. Each request needs ${ms(quizBusy.work)} of work. About how long does each request take?`, o: [ms(quizBusy.work), ms(Math.round(quizBusy.work / quizBusy.busy)), ms(quizBusy.ms), `${fmt(quizBusy.ms * 10)} ms`], a: 2, e: `${fmt(quizBusy.load)} ÷ ${fmt(quizBusy.cap)} = ${percent(quizBusy.busy)} busy. Time = ${ms(quizBusy.work)} ÷ (1 − ${quizBusy.busy}) = ${ms(quizBusy.work)} ÷ ${Math.round((1 - quizBusy.busy) * 10) / 10} = ${ms(quizBusy.ms)}, ten times the work time.`, r: 'Why is a busy server slow?' },
      { q: 'In this game, when do requests to a server start to fail?', o: ['Once it is more than half busy', `As soon as it passes ${percent(0.75)} busy`, 'Never: requests only slow down', 'Above 100% of its capacity'], a: 3, e: `Up to its capacity a server answers every request, only more slowly as it fills up: ${times(0.75)} as long at ${percent(0.75)} busy. Requests fail only when the load is more than the capacity.`, r: 'Why is a busy server slow?' },
      { q: 'Why move the database onto its own server?', o: ['So it can run a different OS', 'To remove every single point of failure', 'So every query returns instantly', 'So each tier can scale independently'], a: 3, e: 'Separating web traffic (web tier) from the database (data tier) lets you scale each one on its own. You still have single points of failure: now there are two.', r: 'Why give the database its own machine?' },
      { q: `An M server (${rate(M.cap)}) runs your code and the database on the same machine. How much traffic can it carry in this game?`, o: [rate(M.cap), rate(M.cap * sharedCapacity), rate(M.cap * sharedCapacity / 2), rate(M.cap * 2)], a: 1, e: `A server that runs code and data together handles ${percent(sharedCapacity)} of its capacity: ${fmt(M.cap)} × ${percent(sharedCapacity)} = ${rate(M.cap * sharedCapacity)}. With the database on its own server, it gets the full ${rate(M.cap)} back.`, r: 'Why give the database its own machine?' },
      { q: 'Which of these is a reason to stay with a relational database?', o: ['The app needs very low latency', 'You need joins across many tables', 'The data is unstructured', 'You must store huge volumes of data'], a: 1, e: 'Joins are what relational databases do best, and most NoSQL databases do not offer them. Very low latency, data with no fixed shape and huge volume are all reasons to look at NoSQL.', r: 'Which kind of database?' },
      { q: `A NoSQL store serves ${quizPages} pages a second. It cannot join, so each page needs ${nosqlLookups} lookups. What load reaches the store?`, o: [`${quizPages} lookups/s`, `${Math.round(quizPages / nosqlLookups)} lookups/s`, `${quizPages * nosqlLookups} lookups/s`, `${quizPages + nosqlLookups} lookups/s`], a: 2, e: `${quizPages} pages/s × ${nosqlLookups} lookups = ${quizPages * nosqlLookups} lookups/s. Without joins, each piece is fetched on its own, so the store carries ${nosqlLookups} times the page rate.`, r: 'Which kind of database?' },
      { q: 'A music app has 30 million daily users, each making about 15 requests a day. Roughly what is the peak QPS?', o: ['~52,000', '~10,400', '~1,000', '~5,200'], a: 1, e: '30 million × 15 ÷ 86,400 s ≈ 5,200 requests per second on average. Peak is about 2 × the average, so ≈ 10,400. Picking ~5,200 means you stopped at the average.', r: 'How many requests is "a million users"?' },
      { q: 'Your only server is at its CPU limit, so you move to a bigger machine. What did you do, and what problem remains?', o: ['Vertical scaling; a size limit and no failover', 'Horizontal scaling; nothing remains', 'Sharding; joins across shards get harder', 'Vertical scaling; queries can no longer use SQL'], a: 0, e: 'Adding CPU and RAM to one server is vertical scaling (scale up). It is simple, but one machine can only get so big, and when it stops, the whole site stops.', r: 'A bigger machine, or more machines?' },
    ],
  },

  lesson,

  // Lesson diagrams. `f` provides the engine's drawing helpers. Each figure sets its own viewBox.
  drawFigures(f) {
    const { $, svgEl, figNode, figArrow, figDefs, figLabel } = f;
    const f1 = $('figFlow'); f1.textContent = ''; f1.setAttribute('viewBox', '0 0 640 250'); figDefs(f1);
    figNode(f1, 'users', 150, 52, 'User', 'Browser + app');
    figNode(f1, 'dns', 500, 52, 'DNS', 'Third-party');
    figNode(f1, 'web', 150, 205, 'Web server', address);
    figArrow(f1, 246, 42, 404, 42, 'example.com?', '1', 272, 34);
    figArrow(f1, 404, 64, 246, 64, address, '2', 272, 84);
    figArrow(f1, 130, 84, 130, 173, 'HTTP request', '3', 40, 132);
    figArrow(f1, 172, 173, 172, 84, 'page or data', '4', 202, 132);

    // Before: one machine runs code and data at part of its capacity. After: a web tier and a data tier.
    const f2 = $('figTiers'); f2.textContent = ''; f2.setAttribute('viewBox', '0 0 640 420'); figDefs(f2);
    svgEl('rect', { x: 20, y: 14, width: 600, height: 122, rx: 12, class: 'tier-box' }, f2);
    figLabel(f2, 34, 33, 'Before: one machine', 'start', 'tier-label');
    figNode(f2, 'users', 145, 76, 'User', 'Browser + app');
    figNode(f2, 'web', 470, 76, 'One server', 'Code + data');
    figLabel(f2, 470, 124, `at ${Math.round(COMPONENTS.web.alone.capFactor * 100)}% of its capacity`);
    figArrow(f2, 241, 76, 374, 76, 'HTTP', null, 307, 68, 'middle');
    figLabel(f2, 34, 160, 'After: two tiers', 'start', 'tier-label');
    svgEl('rect', { x: 40, y: 290, width: 210, height: 112, rx: 12, class: 'tier-box' }, f2);
    svgEl('rect', { x: 390, y: 290, width: 210, height: 112, rx: 12, class: 'tier-box' }, f2);
    figLabel(f2, 54, 309, 'Web tier', 'start', 'tier-label');
    figLabel(f2, 404, 309, 'Data tier', 'start', 'tier-label');
    figNode(f2, 'users', 145, 202, 'User', 'Browser + app');
    figNode(f2, 'web', 145, 352, 'Web server', 'Scale on its own');
    figNode(f2, 'db', 495, 352, 'Database', 'Scale on its own');
    figArrow(f2, 145, 234, 145, 320, 'HTTP', null, 156, 280);
    figArrow(f2, 241, 342, 399, 342, 'queries', null, 320, 332, 'middle');
    figArrow(f2, 399, 364, 241, 364, 'rows', null, 320, 382, 'middle');

    // Time per request against how busy the server is, drawn with the simulation's own rule (qmul).
    const f3 = $('figQueue'); f3.textContent = ''; f3.setAttribute('viewBox', '0 0 640 250');
    const cap = qmul(1), X = (u) => 56 + u * 540, Y = (m) => 210 - (Math.min(m, cap) / cap) * 180;
    for (let m = 5; m <= cap; m += 5) {
      svgEl('line', { x1: X(0), y1: Y(m), x2: X(1), y2: Y(m), class: 'ch-grid' }, f3);
      figLabel(f3, X(0) - 8, Y(m) + 4, m + '×', 'end', 'ch-t');
    }
    const pts = [];
    for (let i = 0; i <= 200; i++) pts.push([X(i / 200), Y(qmul(i / 200))]);
    svgEl('path', { d: `M${X(0)} ${Y(0)} L` + pts.map(p => p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' L') + ` L${X(1)} ${Y(0)}Z`, class: 'ch-area' }, f3);
    svgEl('rect', { x: X(SLOWDOWN_CAP_FROM), y: Y(cap), width: X(1) - X(SLOWDOWN_CAP_FROM), height: Y(0) - Y(cap), class: 'ch-cap' }, f3);
    svgEl('path', { d: 'M' + pts.map(p => p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' L'), class: 'ch-curve' }, f3);
    svgEl('line', { x1: X(0), y1: Y(0), x2: X(1), y2: Y(0), class: 'ch-axis' }, f3);
    for (const u of [0, 0.25, 0.5, 0.75, 1]) figLabel(f3, X(u), Y(0) + 18, Math.round(u * 100) + '%', 'middle', 'ch-t');
    figLabel(f3, X(1), Y(cap) - 8, `capped at ${cap}× from ${Math.round(SLOWDOWN_CAP_FROM * 100)}%`, 'end', 'ch-cap-t');
    for (const u of [0.5, 0.75, 0.9]) {
      svgEl('circle', { cx: X(u), cy: Y(qmul(u)), r: 4.5, class: 'ch-pt' }, f3);
      figLabel(f3, X(u) - 10, Y(qmul(u)) - 10, `${Math.round(qmul(u) * 10) / 10}× at ${Math.round(u * 100)}%`, 'end', 'ch-pt-t');
    }
    figLabel(f3, X(0.5), 246, 'busy (load ÷ capacity)', 'middle', 'ch-t');

    // The finished design, shown on the intro and again on the wrap-up: one drawing, two svgs.
    const built = (svg) => {
      svg.textContent = ''; svg.setAttribute('viewBox', '0 0 640 250'); figDefs(svg);
      figNode(svg, 'users', 150, 52, 'Users', 'Browser + app');
      figNode(svg, 'dns', 500, 52, 'DNS', 'Finds your server');
      figNode(svg, 'web', 150, 205, 'Web server', 'Web tier');
      figNode(svg, 'db', 500, 205, 'Database', 'Data tier');
      figArrow(svg, 246, 52, 404, 52, 'lookup', null, 325, 44, 'middle');
      figArrow(svg, 150, 84, 150, 173, 'requests', null, 162, 132);
      figArrow(svg, 246, 205, 404, 205, 'queries', null, 325, 197, 'middle');
    };
    built($('figBuilt'));
    built($('figBuiltEnd'));
  },
};
