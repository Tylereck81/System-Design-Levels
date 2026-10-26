// Level 1: One server to two tiers.
// Everything specific to this level lives here: components, rules, missions, quiz and text.
import { fmt } from '../js/format.js';

const targets = { latencyMs: 150, servedPct: 99 };

const servedGoal = { id: 'served', type: 'metric', text: `Serve at least ${targets.servedPct}% of requests`, test: (m) => m.servedPct >= targets.servedPct, val: (m) => m.servedPct.toFixed(1) + '%' };
const latGoal = { id: 'lat', type: 'metric', text: `Response time under ${targets.latencyMs} ms`, test: (m) => m.latency != null && m.latency < targets.latencyMs, val: (m) => m.latency == null ? '—' : fmt(m.latency) + ' ms' };

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
        { id: 'web', type: 'struct', text: 'Requests reach a web server', test: (g) => !!g.web },
        servedGoal, latGoal,
      ],
      hint: 'Drag DNS and a Web server onto the canvas. Then drag from the + under Users onto each of them (or select Users and use Connections in the inspector), and press Play.',
      takeaway: 'One server ran everything. DNS returned the IP once, then HTTP requests went straight to your server.',
    },
    {
      title: 'Separate the data tier', ref: 'Two tiers', qps: 150, budget: 150,
      story: 'Traffic tripled: about 300,000 people a day, 150 requests per second at peak. Your one server runs both the code and the database, so they compete for the same CPU. The app stores users, products and orders, and every order links a user to products.',
      goals: [
        { id: 'tier', type: 'struct', text: 'Data lives on its own database server', test: (g) => !!g.db },
        { id: 'kind', type: 'struct', text: 'Pick the right database type for this data', test: (g) => !!g.db && g.db.kind === 'sql' },
        servedGoal, latGoal,
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
        servedGoal, latGoal,
        { id: 'cost', type: 'struct', text: 'Spend at most $500 per month', test: (g) => g.cost <= 500, val: (m, g) => '$' + g.cost },
        { id: 'crash', type: 'exp', text: 'Break it: crash the web server' },
        { id: 'spike', type: 'exp', text: 'Break it: send 10× traffic' },
      ],
      hint: 'Each tier must carry the full peak, and a server slows down sharply as it fills up. Find the cheapest sizes that keep both tiers well below 100% busy. After the targets pass, use the Break it buttons while the simulation runs.',
      takeaway: 'Vertical scaling got you through launch day, but you saw its two limits: when the server crashed the whole site went down (no failover), and at 10× traffic no size was big enough (hard limit). Level 2 fixes both with a load balancer and more servers.',
    },
  ],

  // Break-it experiments. kind 'crash' takes down the component `target` returns when it starts;
  // kind 'spike' multiplies traffic by `factor`. Each counts once it has run for 1.5 simulated seconds.
  experiments: [
    {
      id: 'crash', kind: 'crash', target: (g) => g.web,
      label: 'Crash web server', labelOn: 'Restart web server',
      needsDesign: 'Build the design first: connect Users to DNS and to a web server, then crash it.',
      on: 'You pulled the plug on the web server.', onTone: 'bad',
      off: 'Web server restarted.',
      issue: 'The web server is down. With only one server, every request fails.',
      observed: 'Observed: one server down means the whole site is down. No failover, no redundancy.',
    },
    {
      id: 'spike', kind: 'spike', factor: 10,
      label: '10× traffic', labelOn: 'Back to normal traffic', hud: '10× spike',
      needsDesign: 'Build the design first: connect Users to DNS and to a web server, then send the spike.',
      on: (qps) => `Traffic spike: ${fmt(qps)} req/s.`, onTone: 'warn',
      off: 'Traffic back to normal.',
      note: (base) => `At ${fmt(base)} req/s, even the largest size (XL, 1,600 req/s) is not enough. One machine can only grow so far: that is the hard limit of scaling up.`,
      observed: 'Observed: no single machine can absorb 10× traffic. Scaling up has a hard limit.',
    },
  ],

  // Messages the engine shows for this level's design.
  text: {
    noWeb: 'Users have nowhere to send requests. Connect Users to a web server.',
    noDns: 'Browsers cannot find example.com. Connect Users to DNS so the name resolves to your server\'s IP.',
    combinedOver: ' It runs code and data on one machine, so it only gets half its capacity.',
    nosqlOver: ' NoSQL cannot join, so each request costs 3 lookups.',
    dnsAnswered: 'DNS answered: example.com is at 203.0.113.42. The device caches it.',
    ipTag: 'IP 203.0.113.42 cached',
    levelComplete: 'Level 1 complete. Take the quiz.',
  },

  quiz: {
    passScore: 8,
    passText: 'Level 1 is done. Level 2, Load balancer and horizontal scaling, is next. It isn\'t built yet: it comes after your review of Level 1.',
    failText: (pass) => `You need ${pass} to pass. Reread the lesson sections behind the questions you missed, then try again.`,
    questions: [
      { q: 'A user types api.example.com. What does DNS send back?', o: ['The HTML page for the site', 'A JSON response from the API', 'The IP address of the server', 'A cached copy of the data'], a: 2, e: 'DNS turns a domain name into an IP address, for example 203.0.113.42. The device then sends HTTP requests straight to that IP. DNS never carries the page itself.', r: 'DNS · RFC 1034' },
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

  // Lesson diagrams. `f` provides the engine's drawing helpers.
  drawFigures(f) {
    const { $, svgEl, figNode, figArrow, figDefs } = f;
    const f1 = $('figFlow'); f1.textContent = ''; figDefs(f1);
    figNode(f1, 'users', 150, 52, 'User', 'Browser + app');
    figNode(f1, 'dns', 500, 52, 'DNS', 'Third-party');
    figNode(f1, 'web', 150, 205, 'Web server', '203.0.113.42');
    figArrow(f1, 246, 42, 404, 42, 'api.example.com?', '1', 272, 34);
    figArrow(f1, 404, 64, 246, 64, '203.0.113.42', '2', 272, 84);
    figArrow(f1, 130, 84, 130, 173, 'HTTP request', '3', 40, 132);
    figArrow(f1, 172, 173, 172, 84, 'HTML / JSON', '4', 202, 132);

    const f2 = $('figTiers'); f2.textContent = ''; figDefs(f2);
    svgEl('rect', { x: 40, y: 138, width: 210, height: 112, rx: 12, class: 'tier-box' }, f2);
    svgEl('rect', { x: 390, y: 138, width: 210, height: 112, rx: 12, class: 'tier-box' }, f2);
    let t = svgEl('text', { x: 54, y: 157, class: 'tier-label' }, f2); t.textContent = 'Web tier';
    t = svgEl('text', { x: 404, y: 157, class: 'tier-label' }, f2); t.textContent = 'Data tier';
    figNode(f2, 'users', 145, 50, 'User', 'Browser + app');
    figNode(f2, 'web', 145, 200, 'Web server', 'Scale on its own');
    figNode(f2, 'db', 495, 200, 'Database', 'Scale on its own');
    figArrow(f2, 145, 82, 145, 168, 'HTTP', null, 156, 128);
    figArrow(f2, 241, 190, 399, 190, 'read/write/update', null, 320, 180, 'middle');
    figArrow(f2, 399, 212, 241, 212, 'return data', null, 320, 230, 'middle');

    const f3 = $('figQueue'); f3.textContent = '';
    const X = (u) => 56 + u * 540, Y = (m) => 210 - (Math.min(m, 20) / 20) * 180;
    for (const m of [5, 10, 15, 20]) {
      svgEl('line', { x1: X(0), y1: Y(m), x2: X(1), y2: Y(m), class: 'ch-grid' }, f3);
      const tt = svgEl('text', { x: X(0) - 8, y: Y(m) + 4, class: 'ch-t', 'text-anchor': 'end' }, f3); tt.textContent = m + '×';
    }
    svgEl('rect', { x: X(0.95), y: Y(20), width: X(1) - X(0.95), height: Y(0) - Y(20), class: 'ch-fail' }, f3);
    const pts = [];
    for (let u = 0; u <= 0.9501; u += 0.005) pts.push([X(u), Y(1 / (1 - u))]);
    svgEl('path', { d: `M${X(0)} ${Y(0)} L` + pts.map(p => p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' L') + ` L${X(0.95)} ${Y(0)}Z`, class: 'ch-area' }, f3);
    svgEl('path', { d: 'M' + pts.map(p => p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' L'), class: 'ch-curve' }, f3);
    svgEl('line', { x1: X(0), y1: Y(0), x2: X(1), y2: Y(0), class: 'ch-axis' }, f3);
    for (const u of [0, 0.25, 0.5, 0.75, 1]) {
      const tt = svgEl('text', { x: X(u), y: Y(0) + 18, class: 'ch-t', 'text-anchor': 'middle' }, f3); tt.textContent = Math.round(u * 100) + '%';
    }
    const ft = svgEl('text', { x: X(0.975), y: Y(20) + 14, class: 'ch-fail-t', 'text-anchor': 'middle' }, f3); ft.textContent = 'fail';
    for (const [u, lab] of [[0.5, '2× at 50%'], [0.75, '4× at 75%'], [0.9, '10× at 90%']]) {
      svgEl('circle', { cx: X(u), cy: Y(1 / (1 - u)), r: 4.5, class: 'ch-pt' }, f3);
      const tt = svgEl('text', { x: X(u) - 10, y: Y(1 / (1 - u)) - 10, class: 'ch-pt-t', 'text-anchor': 'end' }, f3); tt.textContent = lab;
    }
    const xl = svgEl('text', { x: X(0.5), y: 246, class: 'ch-t', 'text-anchor': 'middle' }, f3); xl.textContent = 'utilization (load ÷ capacity)';
  },
};
