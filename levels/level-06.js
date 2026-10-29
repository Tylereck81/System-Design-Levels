// Level 6: Stateless web tier and autoscaling.
// Everything specific to this level lives here: components, rules, missions, quiz and text.
import { fmt } from '../js/format.js';
import level2 from './level-02.js';
import level5 from './level-05.js';

const targets = { latencyMs: 150, servedPct: 99 };
const BUDGET = 3300;
const NIGHT_BUDGET = 2900;
const LOST_MAX = 0.05; // % of shoppers: below this, nobody was logged out

const servedGoal = { id: 'served', type: 'metric', text: `Serve at least ${targets.servedPct}% of requests`, test: (m) => m.servedPct >= targets.servedPct, val: (m) => m.servedPct.toFixed(1) + '%' };
const latGoal = { id: 'lat', type: 'metric', text: `Response time under ${targets.latencyMs} ms`, test: (m) => m.latency != null && m.latency < targets.latencyMs, val: (m) => m.latency == null ? '—' : fmt(m.latency) + ' ms' };
const costGoal = (max) => ({ id: 'cost', type: 'struct', text: `Spend at most $${fmt(max)} per month`, test: (g) => g.cost <= max, val: (m, g) => '$' + fmt(g.cost) });
const spofGoal = { id: 'spof', type: 'metric', text: 'No single point of failure', test: (m) => m.spof === 0, val: (m) => String(m.spof) };
const served99 = (m) => m.servedPct >= targets.servedPct;
const kept = (m) => m.lostPct < LOST_MAX;
const pct = (v) => (v >= 10 ? Math.round(v) : v.toFixed(1)) + '%';
const clock = (h) => String(h).padStart(2, '0') + ':00';

// Traffic over a day as a share of the 20:00 peak, hour by hour. It averages half the peak.
const day = [0.40, 0.30, 0.22, 0.18, 0.15, 0.16, 0.22, 0.32, 0.42, 0.49, 0.54, 0.56, 0.61, 0.57, 0.54, 0.52, 0.54, 0.61, 0.71, 0.86, 1.00, 0.88, 0.70, 0.50];

export default {
  id: 6,
  saveKey: 'sdl-level6-v1',
  saveVersion: 1,
  targets,
  workload: { ...level5.workload, day },

  components: {
    users: {
      ...level5.components.users,
      desc: 'Your shoppers: 70% in Europe, near the data center in Frankfurt, and 30% in America. They log in and fill a cart, so every page they open needs their session. Half of all requests are files, which need no session.',
    },
    dns: level2.components.dns,
    lb: {
      ...level2.components.lb,
      algos: [
        ...level2.components.lb.algos,
        { id: 'sticky', short: 'sticky', name: 'Sticky sessions', sub: 'each shopper stays on one server', note: 'The load balancer sets a cookie that names a shopper\'s server and sends all their requests there. Sessions kept in a server\'s memory are always found, but that server is now the only place they live.', log: 'Load balancer set to sticky sessions: each shopper stays on the server they started on.' },
      ],
    },
    web: {
      name: 'Web server', short: 'Your back-end code',
      desc: 'Runs your back-end code for pages, and sends static files when the CDN misses. Every page needs the shopper\'s session: who they are and what is in their cart.',
      noDbNote: level2.components.web.noDbNote,
      statefulNote: 'Keeps the sessions of the shoppers it served in its own memory: it is stateful. A page that lands on another server finds no cart. Connect it to the session store.',
      subOf: (n, size, st) => {
        if (n.scaling !== 'auto') return null;
        return st && st.copies ? `${n.size} · auto, ×${st.copies} now` : `${n.size} · autoscaled`;
      },
      choices: [
        {
          key: 'scaling', label: 'Scaling',
          options: [
            { id: 'fixed', name: 'Fixed', sub: 'one server, all month', note: 'One server of this size runs all month, whatever the traffic.', log: 'Web server set to a fixed single server.' },
            { id: 'auto', name: 'Autoscale', sub: '1 to 10 servers, by the hour', note: 'This web server becomes a group of servers of its size. Each hour the autoscaler runs as many as keep them at most 60% busy, from 1 to 10, and you pay for the hours each one runs. The load balancer gives each group the same share.', log: 'Web server set to autoscale: a group of 1 to 10 servers of its size.' },
          ],
        },
      ],
    },
    db: level5.components.db,
    cache: level5.components.cache,
    cdn: level5.components.cdn,
    session: {
      name: 'Session store', short: 'Shared sessions', sub: 'Managed NoSQL',
      desc: 'A key-value store that holds every shopper\'s session (login and cart) under its session ID, which the browser keeps in a cookie. Web servers read and write sessions here, so any server can handle any shopper. It is a managed NoSQL service: the provider keeps copies on several machines. In this game it handles 10,000 lookups/s, takes 3 ms per lookup and costs $150/month.',
    },
  },
  palette: ['dns', 'lb', 'web', 'db', 'cache', 'cdn', 'session'],
  limits: { dns: 1, lb: 2, web: 2, db: 3, cache: 3, cdn: 1, session: 1 },
  limitMsg: {
    ...level5.limitMsg,
    web: 'Two web servers is the limit here. To carry more, set them to autoscale: each one becomes a group that runs more servers of its size as traffic grows.',
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
      ...level5.connections.ok,
      'session|web': { from: 'web', to: 'session', label: 'sessions', desc: 'Every page reads the shopper\'s session here first, by the session ID in their cookie: one lookup of 3 ms plus the hop. Changes to the cart are written back. The web server keeps nothing in its own memory between requests.' },
    },
    bad: {
      ...level5.connections.bad,
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
      title: 'Empty carts', ref: 'Sessions', qps: 4000, writes: 0.2, files: 0.5, far: 0.3, sessions: true, budget: BUDGET,
      story: 'Shoppers can now log in and fill a cart. Each web server keeps the carts of the shoppers it served in its own memory. The load balancer sends each request to the next server in turn, so half the time a shopper lands on the other server and finds an empty cart. Make every page find its cart.',
      goals: [servedGoal, latGoal, costGoal(BUDGET)],
      hint: 'Two fixes work. Select a load balancer and pick sticky sessions, so each shopper stays on one server. Or add a session store and connect both web servers to it, so any server can find any cart.',
      takeaway: 'Every page finds its cart now. With sticky sessions, each cart still lives on one server, and Mission 2 takes one away. With a session store, the web servers keep nothing between requests: they are stateless.',
    },
    {
      title: 'An update at 10:00', ref: 'Stateless web tier', qps: 4000, writes: 0.2, files: 0.5, far: 0.3, sessions: true, budget: BUDGET,
      story: 'You deploy a new version at 10:00, when traffic is 2,400 req/s: one web server leaves the pool while it restarts. Every shopper on it must keep their cart and stay logged in.',
      goals: [
        servedGoal, latGoal, spofGoal, costGoal(BUDGET),
        { id: 'update-web', type: 'exp', text: 'Break it: take a web server out; no shopper loses their cart' },
      ],
      hint: 'Carts kept in a server\'s memory leave with that server, sticky or not. Add a session store, connect both web servers to it, and round robin is fine again.',
      takeaway: 'Nobody noticed: the other web server read every cart from the session store. A stateless server can be removed, replaced or added at any time, which is what an autoscaler does all day.',
    },
    {
      title: 'Quiet nights', ref: 'Autoscaling', qps: 4000, writes: 0.2, files: 0.5, far: 0.3, sessions: true, budget: NIGHT_BUDGET,
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
        servedGoal, latGoal, spofGoal, costGoal(NIGHT_BUDGET),
        { id: 'run-day', type: 'exp', text: 'Break it: run a day; nobody is logged out, at least 99% served' },
      ],
      hint: 'Select each web server and set it to autoscale. A group can\'t shrink below one server of its size, so pick a smaller size, such as M. Keep the session store: the autoscaler removes servers every night.',
      takeaway: 'The web tier now follows traffic, and costs about half as much. That only works because the servers are stateless: the autoscaler removed servers all night, and no shopper noticed. Next, the whole data center: what if it goes offline?',
    },
  ],

  // Break-it experiments. A crash takes down the component `target` picks when it starts; `factor` sets the traffic
  // while it runs. A day plays 24 hours in `secs` seconds. `expect` is the outcome that must hold.
  experiments: [
    {
      id: 'update-web', kind: 'crash', factor: 0.6, hud: 'at 10:00',
      target: (g) => g.onPath('web').sort((a, b) => a.x - b.x || a.y - b.y)[0] || null, // the leftmost one
      label: 'Take a web server out', labelOn: 'Put it back',
      needsDesign: 'Build the design first: the load balancer needs web servers to take one out.',
      on: 'A web server is out of the pool for the update. Traffic is 2,400 req/s.', onTone: 'bad',
      off: 'The web server is back in the pool.',
      expect: (m) => served99(m) && kept(m),
      notMet: (m) => (!kept(m)
        ? `${pct(m.lostPct)} of shoppers had their session on the web server that left. They are logged out and their carts are empty. Keep sessions in a session store that both web servers use.`
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
        ? `The autoscaler removed servers that held carts in memory: ${pct(m.lostPct)} of shoppers were logged out. Keep sessions in the session store, so servers can be removed safely.`
        : `Only ${m.servedPct.toFixed(1)}% served. A web server ran out of capacity: a fixed server can't grow, and a group stops at 10 servers.`),
      observed: () => 'Observed: a whole day, and nobody was logged out. The groups shrank at night and grew for the 20:00 peak.',
    },
  ],

  // Messages the engine shows for this level's design.
  text: {
    ...level5.text,
    sessionMiss: (name, miss) => `${pct(100 * miss)} of pages reaching the ${name.toLowerCase()} fail: the shopper's session is on another server, so the cart looks empty. Pick sticky sessions on the load balancer, or share sessions in a session store.`,
    levelComplete: 'Level 6 complete. Take the quiz.',
  },

  quiz: {
    passScore: 8,
    passText: 'Level 6 is done. Level 7, multiple data centers, is next. It isn\'t built yet.',
    failText: (pass) => `You need ${pass} to pass. Reread the lesson sections behind the questions you missed, then try again.`,
    questions: [
      { q: 'What makes a web server stateful?', o: ['It runs on a private IP address in the data center', 'It remembers client data between requests', 'It reads data from a database', 'It sits behind a load balancer'], a: 1, e: 'A stateful server keeps client data, such as a session, from one request to the next. A stateless server keeps nothing between requests and fetches what it needs from a shared store.', r: 'State and sessions' },
      { q: 'Ana\'s cart is in Server 2\'s memory. Her next request goes to Server 3. What does she see?', o: ['Her cart, copied over by the load balancer', 'An error page until Server 2 recovers', 'An empty cart, and maybe a login page', 'Her cart, read from the browser cookie'], a: 2, e: 'Server 3 has no record of Ana\'s session, so her cart looks empty, and if her login was kept there too, she is logged out. Her cookie only holds a session ID.', r: 'State and sessions' },
      { q: 'What do sticky sessions do?', o: ['Send all of a user\'s requests to one server', 'Copy every session to every web server', 'Store sessions in the browser', 'Keep a server in the pool after it fails its check'], a: 0, e: 'The load balancer sends every request from one user to the same server, usually remembered in a cookie. Sessions in that server\'s memory are then always found.', r: 'Sticky sessions' },
      { q: 'Why are sticky sessions a weak fix?', o: ['They need a bigger load balancer', 'They slow every request by a full extra round trip', 'They only work with NoSQL databases', 'Removing or losing a server drops its sessions'], a: 3, e: 'Each session still lives on one server. Remove it for an update or because traffic fell, or lose it to a failure, and its users are logged out. Adding servers helps slowly too, since existing users stay where they are.', r: 'Sticky sessions' },
      { q: 'In a stateless web tier, where does session data live?', o: ['In each web server\'s own memory, as before', 'In a data store every web server shares', 'In the load balancer\'s routing table', 'In the CDN edge nearest the user'], a: 1, e: 'Sessions move to a shared store: a relational database, Redis or Memcached, or a NoSQL database. Any web server can then handle any request.', r: 'A stateless web tier' },
      { q: 'Why is NoSQL a common choice for the session store?', o: ['It joins tables faster than SQL', 'It needs no network hop', 'It is easy to scale out', 'Browsers can read it directly'], a: 2, e: 'Session data is simple: one value per session ID, with no joins. A key-value or NoSQL store handles that well and grows by adding machines.', r: 'A stateless web tier' },
      { q: 'What does autoscaling do?', o: ['Moves sessions between servers', 'Adds and removes servers as load changes', 'Picks the fastest server for each request', 'Resizes the database every night'], a: 1, e: 'An autoscaler watches a measure such as how busy the servers are. It adds servers when that rises and removes them when it falls, and you pay only for the hours they run.', r: 'Autoscaling' },
      { q: 'Why does autoscaling need a stateless web tier?', o: ['Removing a stateful server drops its sessions', 'Stateless servers boot faster', 'Stateful servers cannot be monitored', 'The load balancer cannot reach stateful servers'], a: 0, e: 'When traffic falls, the autoscaler removes servers. A stateful server takes its sessions with it, so those users are logged out. With sessions in a shared store, any server can go.', r: 'Autoscaling' },
      { q: 'Peak traffic is 3,000 req/s. Each server handles 500 req/s, and the autoscaler keeps each one at most 60% busy. How many servers run at the peak?', o: ['12', '6', '10', '8'], a: 2, e: '60% of 500 is 300 req/s per server, and 3,000 ÷ 300 = 10 servers. Six would run every server at 100% busy.', r: 'Numbers to carry into the interview' },
      { q: 'The session store is now on every page\'s path. What must you plan for?', o: ['It must also serve static files', 'It must sit in front of the load balancer', 'It must hold the product catalog', 'It must not be a single point of failure'], a: 3, e: 'If the session store fails, no web server can find any session. Run it on several machines, or use a managed service that does.', r: 'A stateless web tier' },
    ],
  },

  // Lesson tab content (HTML). The diagrams below draw into figStateful and figStateless.
  lessonHtml: `
    <p class="label">Level 6 · Stateless web tier and autoscaling</p>
    <h1>Stateless web tier and autoscaling</h1>
    <p class="lede">Shoppers now log in and fill a cart. Where does that cart live between two requests? In this level you see what goes wrong when each web server keeps its own carts, move them to a shared session store, and then let the web tier grow and shrink over a day of traffic.</p>
    <div class="goals-box">
      <div><b>You will learn</b>Stateful and stateless servers, sticky sessions, and autoscaling.</div>
      <div><b>You will decide</b>Where sessions live, how the load balancer routes, and how the web tier scales.</div>
      <div><b>You will estimate</b>How many servers an autoscaled group runs at the peak.</div>
    </div>

    <section>
      <h2>State and sessions</h2>
      <p class="src">Stateful and stateless servers</p>
      <p>A <b>session</b> is what a site remembers about one user between requests: who they are once logged in, and what is in their cart. The browser keeps only a cookie with a session ID. The data itself is kept on the server side.</p>
      <p>A <b>stateful</b> server keeps that data in its own memory, so it remembers a user from one request to the next. A <b>stateless</b> server keeps nothing between requests: for each one, it fetches what it needs from a shared store.</p>
      <figure class="fig"><svg id="figStateful" viewBox="0 0 640 280" role="img" aria-label="Ana's requests reach a load balancer that uses round robin. Her first request, adding a jacket to her cart, goes to Server 2, which keeps the cart in its memory. Her next request goes to Server 3, which has no cart for her."></svg><figcaption>Each cart lives on one server, so a request that lands elsewhere finds nothing</figcaption></figure>
      <p>With stateful servers, every request from a user must reach the server that holds their session. Ana adds a jacket to her cart on Server 2. Her next request goes to Server 3, which has never seen her: her cart is empty, and if her login was kept there too, she is logged out.</p>
    </section>

    <section>
      <h2>Sticky sessions</h2>
      <p class="src">Load balancer session affinity</p>
      <p>Most load balancers can send every request from one user to the same server. This is called <b>sticky sessions</b>, or session affinity. The load balancer usually remembers each user's server in a cookie.</p>
      <p>That fixes the empty carts, but it adds overhead to the load balancer and makes the web tier hard to change:</p>
      <ul>
        <li><b>Removing a server</b>, for an update or because traffic fell, drops every session it holds. Those users are logged out and lose their carts.</li>
        <li><b>Adding a server</b> helps slowly: existing users stay where they are, so only new users go to the new server.</li>
        <li><b>A server failure</b> takes its sessions with it, and its users must start again on another server.</li>
      </ul>
    </section>

    <section>
      <h2>A stateless web tier</h2>
      <p class="src">Shared session store</p>
      <figure class="fig"><svg id="figStateless" viewBox="0 0 640 350" role="img" aria-label="Ana's requests reach a load balancer that uses round robin and sends them to any of three web servers, which keep nothing between requests. Each web server reads and writes sessions in one shared session store."></svg><figcaption>Any server can handle any request, because sessions live in the shared store</figcaption></figure>
      <p>Move the sessions out of the web servers into a store they all share. Each web server reads the user's session from it at the start of a request and writes any change back. Now any server can handle any request, so the load balancer can use plain round robin, and servers can be added or removed at any time.</p>
      <p>The store can be a relational database, an in-memory store such as Redis or Memcached, or a NoSQL database. NoSQL is a common choice because it is easy to scale. Whatever you pick is now on the path of every page, so it must not be a single point of failure.</p>
    </section>

    <section>
      <h2>Autoscaling</h2>
      <p class="src">Autoscaling</p>
      <p><b>Autoscaling</b> adds web servers when traffic rises and removes them when it falls, based on a measure such as how busy the servers are. You pay for servers only in the hours they run.</p>
      <p>It needs a stateless web tier. Removing a stateful server drops its sessions, and with sticky sessions a new server only gets new users. Once sessions live in a shared store, the autoscaler can add and remove servers freely.</p>
      <p>Traffic over a day averages about half its peak, so a web tier that follows traffic runs far fewer server-hours than one sized for the peak all day. Smaller servers follow it more closely: a group can never shrink below one server, and one large server is a lot of capacity at 4 a.m.</p>
    </section>

    <section>
      <h2>How this level is simulated</h2>
      <p class="src">Game assumptions</p>
      <p>Every page needs the shopper's session; files do not. A web server that is not connected to a session store keeps sessions in its own memory. With round robin, a page finds its session only if it lands on the server that holds it: with two servers, half the pages fail. With sticky sessions it is always found. When a server that holds sessions goes down or is removed, its shoppers are logged out and lose their carts.</p>
      <p>With a session store, each page first reads its session there: one lookup of 3 ms, plus the 0.5 ms hop. An autoscaled web server is a group of servers of its size. Each hour it runs as many as keep them at most 60% busy, from 1 to 10, and you pay for the hours each one runs.</p>
      <p class="assume">Game assumptions: the session store is a managed service that handles 10,000 lookups/s for $150 a month and is not a single point of failure. Each page does one session lookup. Traffic follows the same day every day, averaging half the 20:00 peak. The autoscaler sizes each hour for that hour's traffic, and new servers start at once; real ones take minutes, which is why autoscalers leave headroom. The load balancer gives each group the same share. Sticky sessions cost nothing extra here.</p>
    </section>

    <section>
      <h2>Numbers to carry into the interview</h2>
      <p class="src">Capacity estimates</p>
      <p><b>Servers needed</b> = traffic ÷ (what one server handles × the highest share busy you allow), rounded up. For example, 1,000 req/s on servers that handle 400 req/s, kept at most 60% busy: 1,000 ÷ 240 ≈ 4.2, so 5 servers.</p>
      <p><b>What autoscaling saves</b>: traffic averages about half its peak over a day, so a tier that followed traffic exactly would run about half the server-hours of one sized for the peak all day.</p>
    </section>

    <section>
      <h2>How each mission maps to the interview</h2>
      <p class="src">Interview loop · times for a 45-minute interview (formats vary by company)</p>
      <div class="steps4">
        <div><span>Step 1 · 5–8 min</span><b>Scope it</b>Do users log in? What state does a request need? How does traffic change over a day?</div>
        <div><span>Step 2 · 10–12 min</span><b>Sketch it</b>A load balancer, stateless web servers, a shared session store.</div>
        <div><span>Step 3 · 15–20 min</span><b>Go deep</b>Where sessions live, sticky or shared, the scaling rule and server size.</div>
        <div><span>Step 4 · 5 min</span><b>Stress it</b>Remove a server. Run a day of traffic.</div>
      </div>
      <p>When you scale out the web tier in an interview, say where session data lives, and why that lets you add and remove servers freely.</p>
    </section>
`,

  // Lesson diagrams. `f` provides the engine's drawing helpers.
  drawFigures(f) {
    const { $, figNode, figArrow, figDefs } = f;
    const f1 = $('figStateful'); f1.textContent = ''; figDefs(f1);
    figNode(f1, 'users', 320, 34, 'Ana', 'Logged in, shopping');
    figNode(f1, 'lb', 320, 136, 'Load balancer', 'Round robin');
    figNode(f1, 'web', 100, 246, 'Server 1', 'Other shoppers');
    figNode(f1, 'web', 320, 246, 'Server 2', 'Ana\'s cart in memory');
    figNode(f1, 'web', 540, 246, 'Server 3', 'No cart for Ana');
    figArrow(f1, 320, 64, 320, 104, 'Ana\'s requests', null, 332, 89, 'start');
    figArrow(f1, 320, 166, 320, 214, '1 · add a jacket', null, 308, 195, 'end');
    figArrow(f1, 380, 166, 500, 214, '2 · view cart: empty', null, 452, 182, 'start');

    const f2 = $('figStateless'); f2.textContent = ''; figDefs(f2);
    figNode(f2, 'users', 320, 34, 'Ana', 'Logged in, shopping');
    figNode(f2, 'lb', 320, 126, 'Load balancer', 'Round robin');
    figNode(f2, 'web', 100, 220, 'Server 1', 'Keeps nothing');
    figNode(f2, 'web', 320, 220, 'Server 2', 'Keeps nothing');
    figNode(f2, 'web', 540, 220, 'Server 3', 'Keeps nothing');
    figNode(f2, 'session', 320, 316, 'Session store', 'Ana\'s cart, by session ID');
    figArrow(f2, 320, 64, 320, 94, 'Ana\'s requests', null, 332, 84, 'start');
    figArrow(f2, 270, 156, 150, 188, '', null, 0, 0);
    figArrow(f2, 320, 156, 320, 188, 'any server', null, 332, 177, 'start');
    figArrow(f2, 370, 156, 490, 188, '', null, 0, 0);
    figArrow(f2, 150, 250, 250, 286, '', null, 0, 0);
    figArrow(f2, 320, 250, 320, 284, 'read and write sessions', null, 332, 272, 'start');
    figArrow(f2, 490, 250, 390, 286, '', null, 0, 0);
  },
};
