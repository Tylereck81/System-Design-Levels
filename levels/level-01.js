// @ts-check
/** @import { Level, Lesson } from '../js/types.js' */
// Level 1: One server to two tiers.
// Everything specific to this level lives here: components, rules, missions, quiz and text.
import { fmt, percent, ms } from '../js/format.js';
import { SIZES, T, COMPONENTS, SLOWDOWN_CAP_FROM, qmul } from '../js/engine/catalog.js';
import { STEPS, INTERVIEW_MINUTES } from './mock-steps.js';
import { servedGoal, latGoal } from './shared/goals.js';
import { levelComplete } from './shared/text.js';
import { failText, passText } from './shared/quiz.js';

const targets = { latencyMs: 150, servedPct: 99 };
/** The web server's placeholder address, from the range set aside for examples. */
const address = '203.0.113.42';
/** How many times normal traffic the spike experiment sends. */
const spikeFactor = 10;

// The web server Users reach first, and the database it connects to (null when there is none).
const webOf = (g) => g.entry.find((n) => n.type === 'web') || null;
const dbOf = (g) => { const web = webOf(g); return web ? g.next(web).find((n) => n.type === 'db') || null : null; };


// ---------------- Lesson ----------------
// Small text helpers. Nothing here changes a number; they only format it.
const times = (busy) => `${Math.round(qmul(busy) * 10) / 10}×`; // how much longer a request takes: 0.75 → "4×"
const perUnit = (size) => `$${(Math.round((size.cost / size.cap) * 100) / 100).toFixed(2)}`; // S → "$0.20" per req/s

// Step 3's example server: the M size's capacity, with 300 req/s arriving (our example load, not a game number).
const ex = { cap: SIZES.M.cap, load: 300 };
ex.busy = ex.load / ex.cap;

// Step 6's table: one row per server size, straight from the catalog.
const sizeNames = Object.keys(SIZES);
const largest = sizeNames[sizeNames.length - 1];
const sizeRows = sizeNames.map((name) => {
  const size = SIZES[name];
  return [`${name} · ${size.cpu} vCPU${name === largest ? ' (largest)' : ''}`, `${fmt(size.cap)} req/s`, `$${size.cost}`, perUnit(size)];
});
const { S, L, XL } = SIZES;

// The web server's rule when it has no database server, and the two database types.
const sharedCapacity = COMPONENTS.web.alone.capFactor;
const sqlQueries = COMPONENTS.db.kinds.sql.per;
const nosqlLookups = COMPONENTS.db.kinds.nosql.per;

// The slowdown cap: where it starts, and what qmul returns for a full server.
const capFrom = SLOWDOWN_CAP_FROM;
const capTimes = `${qmul(1)}×`;

// Step 8's interview timings, from the mock interview's steps: "Scope it 5–8 min, Sketch it 10–12, …".
const minutes = (step) => (step.min === step.max ? `${step.min}` : `${step.min}–${step.max}`);
const interviewSteps = STEPS.map((step, i) => `<b>${step.name}</b> ${minutes(step)}${i === 0 ? ' min' : ''}`).join(', ');

/** @type {Lesson} */
const lesson = {
  kicker: 'Level 1 · Foundations',
  title: 'One server to two tiers',
  promise: `It is launch week for your shop, example.com. Everything runs on one $${S.cost} server. By the end of this level you will know why it gets slow, what to split off, how big to make it, and where a single machine stops.`,
  minutes: 10,
  steps: [
    {
      title: 'How does a phone find your server?',
      hook: 'Someone types <b>example.com</b>. Their phone knows the name, but the internet delivers to numbers. Something has to turn the name into an address.',
      check: {
        kind: 'guess',
        q: 'Once DNS has answered, where do the page requests travel?',
        options: [
          { t: 'To DNS, which forwards them to your server', why: 'DNS does not forward traffic. It answers one question, "where is example.com?", and steps out of the way.' },
          { t: 'Straight to your server\'s IP address', right: true, why: 'DNS only hands back the address. Every page request then goes directly to your server.' },
          { t: 'To DNS first on every request, then to your server', why: 'The device keeps the answer for a while, so it does not ask again on every request. And pages never pass through DNS at all.' },
        ],
      },
      body: [
        {
          figure: 'figFlow',
          alt: `The user's device asks DNS where the site is and gets back the IP address ${address}. It then sends HTTP requests straight to the web server at that address and gets HTML or JSON back.`,
          caption: 'One lookup, then direct requests',
        },
        { ol: [
          'The browser or app asks <b>DNS</b> where <code>example.com</code> is. DNS is usually a paid outside service, not something you host.',
          `DNS returns an <b>IP address</b>, for example <code>${address}</code>.`,
          'The device sends <b>HTTP requests</b> straight to that address: your web server.',
          'The server sends back the page or the data.',
        ] },
        { p: 'The device keeps the DNS answer for a while, so the lookup is not repeated on every request.' },
      ],
      takeaway: 'DNS answers "where is it?" once, and your pages never travel through it.',
      missions: [0],
      quiz: [0],
    },
    {
      title: 'What does the server send back?',
      hook: 'Your shop has a website and a mobile app. Both ask the same server for product 42, but they need different things back.',
      body: [
        { ul: [
          '<b>Browser:</b> it needs something to show, so the server returns an <b>HTML</b> page.',
          '<b>Mobile app:</b> its screens are already built in. It only needs the data, so the server returns <b>JSON</b>: plain text that any language can read.',
        ] },
        { code: 'GET /products/42   → the app asks for product 42\n{\n  "id": 42,\n  "name": "Trail running shoes",\n  "priceCents": 8999,\n  "inStock": true\n}' },
        { p: '<b>Words you will hear.</b> The <i>front end</i> runs on the user\'s device. The <i>back end</i> is your code on servers. This game calls that machine the <b>web server</b>; people also say app server or API server.' },
      ],
      takeaway: 'Browsers usually get HTML, and apps get JSON: just the data.',
      missions: [0],
      quiz: [1],
    },
    {
      title: 'Why does a busy server get slow?',
      hook: `Your server can handle ${fmt(ex.cap)} requests a second and it is getting ${fmt(ex.load)}. Nothing is failing. So why are people saying the site feels slow?`,
      check: {
        kind: 'guess',
        q: `The server is ${percent(ex.busy)} busy. Compared with an idle server, how much longer does each request take?`,
        options: [
          { t: 'About 1.3× as long', why: 'It feels like a quarter of spare room should be plenty. But requests wait in line behind each other, and the wait grows much faster than the load.' },
          { t: `About ${times(0.5)} as long`, why: `That is what happens at ${percent(0.5)} busy. At ${percent(ex.busy)} it is already worse.` },
          { t: `About ${times(ex.busy)} as long`, right: true, why: `Time per request = base time ÷ (1 − busy). At ${percent(ex.busy)} busy that is 1 ÷ ${1 - ex.busy} = ${times(ex.busy)}.` },
        ],
      },
      body: [
        { p: 'Requests queue behind each other. Two numbers describe it: <b>busy = load ÷ capacity</b>, and <b>time per request = base time ÷ (1 − busy)</b>.' },
        {
          example: [
            `${fmt(ex.load)} req/s ÷ ${fmt(ex.cap)} req/s = ${ex.busy} → ${percent(ex.busy)} busy`,
            `${ms(T.web)} ÷ (1 − ${ex.busy}) = ${ms(T.web)} ÷ ${1 - ex.busy} = ${ms(T.web * qmul(ex.busy))}`,
          ],
          note: `The same ${ms(T.web)} of work now takes ${ms(T.web * qmul(ex.busy))}. At ${percent(0.9)} busy it would take ${ms(T.web * qmul(0.9))}.`,
        },
        {
          figure: 'figQueue',
          alt: `Time per request against how busy the server is. It climbs slowly at first, then steeply: ${times(0.5)} at ${percent(0.5)} busy, ${times(0.75)} at ${percent(0.75)}, ${times(0.9)} at ${percent(0.9)}, and it is capped at ${qmul(1)} times from ${percent(capFrom)}.`,
          caption: 'Time per request against how busy the server is',
        },
        { assume: `This is the rule the game uses. It is a standard queueing result (M/M/1); real servers differ in detail but bend the same way. From ${percent(capFrom)} busy, a request takes at most ${capTimes} its base time; only load above 100% fails.` },
      ],
      takeaway: `Slow comes long before down: ${times(0.5)} at ${percent(0.5)} busy, ${times(0.75)} at ${percent(0.75)}, ${times(0.9)} at ${percent(0.9)}.`,
      missions: [1, 2],
      quiz: [],
    },
    {
      title: 'Why give the database its own machine?',
      hook: 'Traffic has tripled. Your one machine runs the code and the database, and every request needs both, so they fight over the same CPU and memory.',
      body: [
        {
          figure: 'figTiers',
          alt: `Before: users send HTTP requests to one machine that runs both the code and the data, at ${percent(sharedCapacity)} of its capacity. After: users send HTTP requests to the web server in the web tier, which sends queries to the database server in the data tier and gets rows back. Each tier can be scaled on its own.`,
          caption: 'Before: one machine for code and data. After: a web tier and a data tier, each on its own machine',
        },
        { p: 'Put the database on its own server. Web servers answer requests (the <b>web tier</b>); the database server keeps the data (the <b>data tier</b>). Now each tier can <b>scale independently</b>: upgrade the one that is full and leave the other alone.' },
        { p: 'What it does not fix: each tier is still one machine. You now have two single points of failure instead of one.' },
        { assume: `Game rule: a server that runs both code and data handles ${percent(sharedCapacity)} of its listed capacity.` },
      ],
      takeaway: 'Two tiers let you grow the busy part without paying to grow the rest.',
      missions: [1],
      quiz: [2],
    },
    {
      title: 'SQL or NoSQL?',
      hook: 'A machine for the data means a choice you will be asked to defend in every interview: which kind of database runs on it?',
      check: {
        kind: 'guess',
        q: 'An app saves each user\'s settings as one object. It always reads and writes the whole object by user ID, thousands of times a second, and needs it back in a few milliseconds. Which fits better?',
        options: [
          { t: 'A relational (SQL) database', why: 'It would work, but nothing here needs joins or links between records. This is a look-up by key at a very high rate.' },
          { t: 'A key-value (NoSQL) store', right: true, why: 'Whole objects, fetched by key, very fast, at a very high rate, with no links between them: that is what key-value stores are built for.' },
        ],
      },
      body: [
        { table: { head: ['', 'Relational (SQL)', 'NoSQL'], rows: [
          ['<b>Examples</b>', 'PostgreSQL, MySQL, SQL Server', 'Redis (key-value), MongoDB (document), Cassandra (wide-column), Neo4j (graph)'],
          ['<b>Shape</b>', 'Tables with a fixed schema', 'Four families: key-value, document, wide-column, graph'],
          ['<b>Joins</b>', 'Yes, across tables in one query', 'Usually not: the app fetches each piece itself'],
        ] } },
        { p: '<b>Start with relational.</b> Joins, transactions and decades of tooling cover most apps. Reach for NoSQL when you can name the reason:' },
        { ul: [
          'you always read and write a whole object at once;',
          'you look things up by key and need answers in a few milliseconds, at very high request rates;',
          'the data has outgrown what one relational setup can hold;',
          'the records have no fixed shape, or few links between them.',
        ] },
        { assume: `Game rule: an order page needs a user, an order and its products. SQL fetches them in ${sqlQueries} query. NoSQL cannot join, so it needs ${nosqlLookups} lookups and fills up ${nosqlLookups / sqlQueries} times as fast.` },
      ],
      takeaway: 'Relational is the default: choose NoSQL only when you can say the reason out loud.',
      missions: [1],
      quiz: [3, 4],
    },
    {
      title: 'A bigger machine, or more machines?',
      hook: 'Launch day is coming and the server is nearly full. The fastest fix is to rent a bigger one. How far does that get you?',
      body: [
        { ul: [
          '<b>Vertical scaling (scale up):</b> a machine with more CPU and RAM. Nothing in the design changes, so it is the right first move.',
          '<b>Horizontal scaling (scale out):</b> more machines in a pool. That needs a load balancer, which is Level 2.',
        ] },
        { table: { head: ['Size (game)', 'Capacity', 'Cost / month', 'Cost per req/s'], num: true, rows: sizeRows } },
        { p: 'Scaling up runs into two walls:' },
        { ol: [
          '<b>A ceiling.</b> The biggest machine you can rent is still one machine.',
          '<b>No failover.</b> One server is one point of failure. When it stops, the site stops.',
        ] },
      ],
      check: {
        kind: 'turn',
        q: 'Look at the table. Which size gives you the most capacity for each dollar?',
        options: [
          { t: 'S', right: true, why: `$${S.cost} ÷ ${fmt(S.cap)} = ${perUnit(S)} per req/s. Every step up costs more per unit: XL is $${XL.cost} ÷ ${fmt(XL.cap)} ≈ ${perUnit(XL)}.` },
          { t: 'L', why: `$${L.cost} ÷ ${fmt(L.cap)} = ${perUnit(L)} per req/s. S is cheaper per unit at ${perUnit(S)}.` },
          { t: 'XL, because bigger is better value', why: `The opposite: XL is $${XL.cost} ÷ ${fmt(XL.cap)} ≈ ${perUnit(XL)} per req/s, the most expensive per unit. You pay extra for size.` },
        ],
      },
      takeaway: 'Scale up first, knowing it ends at the biggest machine and leaves you with one point of failure.',
      missions: [2],
      quiz: [5],
    },
    {
      title: 'How much traffic is coming?',
      hook: 'Marketing says "a million users". Servers are sized in requests per second. In an interview you have to turn one into the other, out loud.',
      body: [
        { p: '<b>Requests per second = daily users × requests per user per day ÷ 86,400</b> (the seconds in a day). Traffic is not flat, so plan for a <b>peak of about 2× the average</b>. Take a photo app with 40 million daily users, each loading 30 pages a day:' },
        { example: [
          '40,000,000 users × 30 requests a day = 1,200,000,000 requests a day',
          '1,200,000,000 requests ÷ 86,400 s ≈ 13,900 req/s on average',
          '13,900 req/s × 2 ≈ 28,000 req/s at peak',
        ] },
        { p: 'Round hard. For a first guess call a day 100,000 seconds: the answer comes out about 14% low, which is fine. Say each assumption, and put a unit on every number.' },
        { assume: '"Peak is about 2× the average" is a rule of thumb, not a law. Say it as an assumption.' },
      ],
      check: {
        kind: 'turn',
        q: 'A recipe site has 5 million daily users, each making 10 requests a day. Roughly what is the peak?',
        options: [
          { t: 'About 580 req/s', why: 'That is the average: 50,000,000 ÷ 86,400 ≈ 580. Double it for the peak.' },
          { t: 'About 1,160 req/s', right: true, why: '5,000,000 × 10 ÷ 86,400 ≈ 580 on average, × 2 ≈ 1,160 at peak.' },
          { t: 'About 50,000,000 req/s', why: 'That is requests per day. Divide by the 86,400 seconds in a day.' },
        ],
      },
      takeaway: 'Daily users × requests each ÷ 86,400, then × 2 for the peak.',
      missions: [2],
      quiz: [6],
    },
    {
      title: 'What do you carry into the interview?',
      hook: `Nobody expects exact figures from memory. They expect you to know what is fast, what is slow, and what to do in the first ${STEPS[0].min} minutes.`,
      body: [
        { table: { head: ['Operation', 'Time'], num: true, rows: [
          ['Read from main memory', '100 ns'],
          ['Read 1 MB in a row from memory', '250 µs'],
          ['Round trip inside one data center', '500 µs'],
          ['Disk seek', '10 ms'],
          ['Packet California → Netherlands → California', '150 ms'],
        ] } },
        { p: 'A disk seek costs as much as 100,000 memory reads, so keep hot data in memory. Crossing an ocean costs more than ten disk seeks, so keep users close to their data.' },
        { p: '<b>Availability.</b> 99.9% sounds high, but it allows 8.77 hours of downtime a year. Each extra nine cuts that by 10×.' },
        { p: `<b>The interview in four steps</b> (${INTERVIEW_MINUTES} minutes): ${interviewSteps}. Do not draw in the first minute: ask what it must do, for how many people, and how fast it will grow.` },
      ],
      check: {
        kind: 'turn',
        q: 'A provider promises 99.9% availability. About how much downtime does that allow in a 30-day month?',
        options: [
          { t: 'About 4 minutes', why: 'That is 99.99%, one more nine. At 99.9% the allowance is 10× larger.' },
          { t: 'About 43 minutes', right: true, why: '30 days × 24 hours × 60 minutes = 43,200 minutes. 0.1% of 43,200 minutes ≈ 43 minutes.' },
          { t: 'About 7 hours', why: 'That is 99%: 1% of 720 hours = 7.2 hours. 99.9% allows a tenth of that.' },
        ],
      },
      takeaway: 'Know that memory beats disk and disk beats distance, and scope the problem before you draw.',
      missions: [0, 1, 2],
      quiz: [7, 8, 9],
    },
  ],
  recap: {
    numbers: [
      ['86,400', 'seconds in a day'],
      ['2×', 'peak vs average (rule of thumb)'],
      [`${times(0.75)} at ${percent(0.75)}`, 'slowdown when busy'],
      ['10 ms', 'one disk seek'],
      ['8.77 h / year', 'downtime at 99.9%'],
    ],
    // One line per mission, in mission order. "Traffic triples" is checked against the missions in tests/unit/level-01-lesson.test.mjs.
    bridge: [
      'You connect Users to DNS and to one web server, then watch the lookup happen once and the requests go direct.',
      'Traffic triples. You split off the database, pick its type, and find out which server is too busy to hit the response target.',
      `You estimate the peak before Play unlocks, scale up to carry it, then crash the server and send ${spikeFactor}× traffic to hit both walls yourself.`,
    ],
  },
  rules: `Web server work ${ms(T.web)}, database query ${ms(T.db)} (about one disk seek), internet round trip ${ms(T.rtt)}, round trip inside the data center ${ms(T.dc)}, DNS $${T.dns} a month. A NoSQL lookup takes ${ms(T.nosqlLookup)}. From ${percent(capFrom)} busy, a request takes at most ${capTimes} its base time; only load above 100% fails.`,
};

/** @type {Level} */
export default {
  id: 1,
  saveKey: 'sdl-level1-v1',
  saveVersion: 2, // quiz options were reordered in v2, so older saved answers no longer line up
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
      title: 'Hello, example.com', ref: 'Single server', qps: 50, budget: null,
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
      title: 'Separate the data tier', ref: 'Two tiers', qps: 150, budget: 150,
      story: 'Traffic tripled: about 300,000 people a day, 150 requests per second at peak. Your one server runs both the code and the database, so they compete for the same CPU. The app stores users, products and orders, and every order links a user to products.',
      goals: [
        { id: 'tier', type: 'struct', text: 'Data lives on its own database server', test: (g) => !!dbOf(g) },
        { id: 'kind', type: 'struct', text: 'Pick the right database type for this data', test: (g) => dbOf(g)?.kind === 'sql' },
        servedGoal(targets), latGoal(targets),
        { id: 'cost', type: 'struct', text: 'Spend at most $150 per month', test: (g) => g.cost <= 150, val: (m, g) => '$' + g.cost },
      ],
      hint: 'Add a Database, connect Web server → Database, and choose its type. If the response time is still too slow, read the log: a server at 75% busy makes each request take 4× longer. The web server\'s work (20 ms) is slower than a query (10 ms), so its waiting costs you more. Spend where it helps most.',
      takeaway: 'Separate tiers scale independently. You also saw that a busy server gets slow long before it fails.',
    },
    {
      title: 'Launch day', ref: 'Estimation', qps: 463, budget: 500,
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
      { q: 'A user types api.example.com. What does DNS send back?', o: ['The HTML page for the site', 'A JSON response from the API', 'The IP address of the server', 'A cached copy of the data'], a: 2, e: `DNS turns a domain name into an IP address, for example ${address}. The device then sends HTTP requests straight to that IP. DNS never carries the page itself.`, r: 'DNS · RFC 1034' },
      { q: 'The mobile app calls GET /products/42. What does the server usually return?', o: ['A JSON object', 'An HTML page', 'A SQL table', 'An image file'], a: 0, e: 'Mobile apps talk to the server over HTTP, and JSON is the common API response format because it is simple. Browsers usually receive HTML pages.', r: 'HTTP APIs and JSON' },
      { q: 'Why move the database onto its own server?', o: ['So it can run a different OS', 'To remove every single point of failure', 'So every query returns instantly', 'So each tier can scale independently'], a: 3, e: 'Separating web traffic (web tier) from the database (data tier) lets you scale each one on its own. You still have single points of failure: now there are two.', r: 'Two-tier architecture' },
      { q: 'Which of these is a reason to stay with a relational database?', o: ['The app needs very low latency', 'You need joins across many tables', 'The data is unstructured', 'You must store huge volumes of data'], a: 1, e: 'Joins are what relational databases do best, and most NoSQL databases do not offer them. Very low latency, data with no fixed shape and huge volume are all reasons to look at NoSQL.', r: 'Choosing a database' },
      { q: 'NoSQL databases fall into four categories. Which list is right?', o: ['Tables, rows, indexes and views', 'Cache, queue, blob and log stores', 'Key-value, graph, column and document', 'Primary, replica, shard and backup stores'], a: 2, e: 'NoSQL databases are usually grouped into four families: key-value (Redis), document (MongoDB), wide-column (Cassandra) and graph (Neo4j).', r: 'Choosing a database' },
      { q: 'Your only server is at its CPU limit, so you move to a bigger machine. What did you do, and what problem remains?', o: ['Vertical scaling; a size ceiling and no failover', 'Horizontal scaling; nothing remains', 'Sharding; joins across shards get harder', 'Vertical scaling; queries can no longer use SQL'], a: 0, e: 'Adding CPU and RAM to one server is vertical scaling (scale up). It is simple, but one machine can only get so big, and when it stops, the whole site stops.', r: 'Scaling up vs scaling out' },
      { q: 'A music app has 30 million daily users, each making about 15 requests a day. Roughly what is the peak QPS?', o: ['~5,200', '~10,400', '~1,000', '~52,000'], a: 1, e: '30M × 15 ÷ 86,400 s ≈ 5,200 requests per second on average. Peak is about 2 × the average, so ≈ 10,400. Picking ~5,200 means you stopped at the average.', r: 'Estimating QPS' },
      { q: 'Which of these takes the longest?', o: ['Main memory reference', 'Round trip within the same data center', 'Reading 1 MB sequentially from memory', 'Disk seek'], a: 3, e: 'Roughly: memory reference 100 ns, 1 MB from memory 250 µs, data-center round trip 500 µs, disk seek 10 ms. Memory is fast and disk is slow, so avoid disk seeks.', r: 'Latency · Dean 2009' },
      { q: 'A provider promises 99.9% availability. About how much downtime is that per year?', o: ['3.65 days', '52.6 minutes', '8.77 hours', '5.26 minutes'], a: 2, e: '99.9% allows 1.44 minutes a day, which is 8.77 hours a year. 99% is 3.65 days, 99.99% is 52.6 minutes and 99.999% is 5.26 minutes.', r: 'Availability arithmetic' },
      { q: 'The interviewer says "Design a news feed." What should you do first?', o: ['Ask about features, users and scale', 'Draw the complete architecture', 'Choose the database technology', 'Estimate five years of storage needs'], a: 0, e: 'Step 1 is to scope it (about 5–8 minutes). Designing before you know the features and the scale is a red flag, however good the design is.', r: 'Interview loop · Scope it' },
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
    figArrow(f1, 172, 173, 172, 84, 'HTML / JSON', '4', 202, 132);

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
  },
};
