// Level 2: Load balancer and horizontal scaling.
// Everything specific to this level lives here: components, rules, missions, quiz and text.
import { fmt } from '../js/format.js';

const targets = { latencyMs: 150, servedPct: 99 };

const servedGoal = { id: 'served', type: 'metric', text: `Serve at least ${targets.servedPct}% of requests`, test: (m) => m.servedPct >= targets.servedPct, val: (m) => m.servedPct.toFixed(1) + '%' };
const latGoal = { id: 'lat', type: 'metric', text: `Response time under ${targets.latencyMs} ms`, test: (m) => m.latency != null && m.latency < targets.latencyMs, val: (m) => m.latency == null ? '—' : fmt(m.latency) + ' ms' };
const sharedDbGoal = { id: 'shared', type: 'struct', text: 'Every web server uses the shared database', test: (g) => g.everyReaches('web', 'db') };
const costGoal = (max) => ({ id: 'cost', type: 'struct', text: `Spend at most $${fmt(max)} per month`, test: (g) => g.cost <= max, val: (m, g) => '$' + fmt(g.cost) });
const served99 = (m) => m.servedPct >= targets.servedPct;

export default {
  id: 2,
  saveKey: 'sdl-level2-v1',
  saveVersion: 1,
  targets,

  components: {
    users: { name: 'Users', sub: 'Web + mobile app', desc: 'Your visitors. They look up example.com in DNS, then send HTTP requests to the address DNS returns.' },
    dns: { name: 'DNS', short: 'Domain → IP address', sub: 'Third-party · $5', desc: 'Turns example.com into the load balancer\'s public IP, 203.0.113.10. Costs $5/month in this game.' },
    lb: {
      name: 'Load balancer', short: 'Spreads traffic', sub: 'Active · 203.0.113.10', standbySub: 'Standby · same IP',
      desc: 'Users connect to its public IP, 203.0.113.10. It hands each request to a healthy web server over the private network and stops using a server that fails its health check. A second load balancer waits as a standby and takes over the same IP if the first one stops sending heartbeats. In this game it handles 5,000 req/s, adds 1 ms and costs $20/month.',
    },
    web: {
      name: 'Web server', short: 'Your back-end code',
      desc: 'Runs your back-end code on a private IP (10.0.0.x). Only the load balancer can reach it. Every web server should use the same shared database.',
      noDbNote: 'Not connected to the database, so this server keeps its own copy of the data and handles half its capacity. Connect it to the shared database.',
    },
    db: {
      name: 'Database', short: 'Stores data on disk', desc: 'The one shared database every web server reads and writes. It is still a single machine.',
      unsetSub: 'Pick SQL or NoSQL',
      kindsLabel: 'Database type',
      unsetNote: 'Not chosen yet. The app\'s data is relational: users, products and orders.',
      kinds: [
        { id: 'sql', short: 'SQL', name: 'Relational', sub: 'SQL · joins', tone: 'ok', log: 'Database set to relational (SQL). One query fetches an order with its user and products.', note: 'Relational: tables and rows, joins with SQL. One query per request here.' },
        { id: 'nosql', short: 'NoSQL', name: 'NoSQL', sub: 'no joins', tone: 'warn', log: 'Database set to NoSQL. It cannot join, so each request needs 3 lookups.', note: 'NoSQL: no joins, so 3 lookups per request for this relational data.' },
      ],
    },
  },
  palette: ['dns', 'lb', 'web', 'db'],
  limits: { dns: 1, lb: 2, web: 6, db: 1 },
  limitMsg: {
    dns: 'You only need one DNS service for example.com.',
    lb: 'Two load balancers is the limit: one active, one standby.',
    web: 'Six web servers is the limit in this level.',
    db: 'One shared database is the limit here. Copies (replicas) arrive in Level 3.',
  },
  // Level 1's launch-day setup: one large web server and its database. Users can no longer reach it directly.
  startNodes: [
    { id: 'u', type: 'users', x: 380, y: 64 },
    { id: 'd', type: 'dns', x: 640, y: 64 },
    { id: 'w1', type: 'web', x: 380, y: 280, size: 'L' },
    { id: 'b', type: 'db', x: 380, y: 456, size: 'L', kind: 'sql' },
  ],
  startEdges: [{ id: 's1', from: 'u', to: 'd' }, { id: 's2', from: 'w1', to: 'b' }],
  slots: { dns: { x: 640, y: 64 }, lb: { x: 380, y: 172 }, web: { x: 380, y: 280 }, db: { x: 380, y: 456 } },

  connections: {
    ok: {
      'dns|users': { from: 'users', to: 'dns', label: 'DNS lookup', desc: 'The device asks DNS for the IP of example.com and gets the load balancer\'s public IP, 203.0.113.10. It happens once, then the answer is cached.' },
      'lb|users': { from: 'users', to: 'lb', label: 'HTTP requests', desc: 'Users send every request to the load balancer\'s public IP. They never see the web servers.' },
      'lb|web': { from: 'lb', to: 'web', label: 'private IP', desc: 'The load balancer forwards each request to a web server over the private network (10.0.0.x), inside the same data center (about 0.5 ms).' },
      'db|web': { from: 'web', to: 'db', label: 'queries', desc: 'The web server reads and writes data in the shared database, inside the same data center (about 0.5 ms round trip).' },
    },
    bad: {
      'users|web': 'Web servers have private IPs now, so users cannot reach them. Connect Users to the load balancer; it forwards each request to a web server.',
      'dns|lb': 'DNS does not forward traffic. It only tells devices the load balancer\'s IP; then they connect to the load balancer themselves.',
      'dns|web': 'DNS does not forward traffic, and web servers are on private IPs. DNS points devices at the load balancer.',
      'db|users': 'Users never talk to the database. Requests go through the load balancer and a web server.',
      'db|dns': 'The database does not need DNS. DNS is used by your users\' devices to find the load balancer.',
      'db|lb': 'The load balancer only spreads requests over web servers. The web servers talk to the database.',
      'lb|lb': 'Connect both load balancers to Users instead. The first is active; the second waits as a standby and takes over the same IP if the heartbeats stop.',
      'web|web': 'Web servers do not send requests to each other here. Put them all behind the load balancer.',
    },
  },

  missions: [
    {
      title: 'One address, many servers', ref: 'Load balancer', qps: 463, budget: 500,
      story: 'Launch day ran on one large server, until it crashed and took example.com down with it. Traffic is the same, 463 req/s at peak. Put a load balancer in front and spread the traffic over several web servers, so one crash no longer takes the site offline.',
      goals: [
        { id: 'lb', type: 'struct', text: 'Users reach the web servers through a load balancer', test: (g) => g.count('lb') >= 1 && g.everyReaches('lb', 'web') },
        { id: 'pool', type: 'struct', text: 'At least two web servers behind it', test: (g) => g.count('web') >= 2 },
        sharedDbGoal,
        servedGoal, latGoal, costGoal(500),
        { id: 'crash-web', type: 'exp', text: 'Break it: crash a web server and still serve at least 99%' },
      ],
      hint: 'Add a load balancer and connect Users to it, then connect it to each web server, and each web server to the database. The load balancer gives every server the same share, so when one crashes, the others must carry all 463 req/s between them. Several small servers cost less than a few big ones.',
      takeaway: 'A server crashed and the site stayed up: the load balancer stopped sending it requests and the others took its share. That only works when the servers left can carry the whole peak. Plan for one more than you need: N + 1.',
    },
    {
      title: 'Traffic doubles', ref: 'Scaling out', qps: 1204, budget: 950,
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
        servedGoal, latGoal, costGoal(950),
        { id: 'crash-web', type: 'exp', text: 'Break it: crash a web server and still serve at least 99%' },
      ],
      hint: 'Every request still reaches the one database, so check it first: a large database handles 800 queries/s. Then add web servers until each is well under 75% busy, plus one spare for the crash test. Use same-size servers: each one gets an equal share.',
      takeaway: 'You grew the web tier one server at a time, and the spare kept the site up during a crash. The database could only grow bigger: it is now 75% busy, and still a single point of failure. Level 3 fixes that with replicas.',
    },
    {
      title: 'The load balancer is the new single point of failure', ref: 'Standby pair', qps: 1204, budget: 1000,
      story: 'Every web server now has a spare, but all traffic still enters through one load balancer. If it stops, example.com stops. Add a second load balancer as a standby: the pair send each other heartbeats, and if the active one goes quiet, the standby takes over its public IP.',
      goals: [
        { id: 'standby', type: 'struct', text: 'A standby load balancer is ready', test: (g) => g.count('lb') >= 2 && g.everyReaches('lb', 'web') },
        sharedDbGoal,
        servedGoal, latGoal, costGoal(1000),
        { id: 'crash-lb', type: 'exp', text: 'Break it: crash the load balancer and still serve at least 99%' },
      ],
      hint: 'Add a second load balancer, connect Users to it and connect it to every web server. It takes no traffic while the first one is healthy, and takes over all of it when the first one fails.',
      takeaway: 'With a standby load balancer and a spare web server, any one machine in the web tier can fail without taking the site down. The database is the last single point of failure, and it is 75% busy. Level 3 adds database replication.',
    },
  ],

  // Break-it experiments. A crash takes down the component `target` picks when it starts;
  // `expect` is the outcome that must hold for the whole run before it counts.
  experiments: [
    {
      id: 'crash-web', kind: 'crash', target: (g) => g.onPath('web')[0] || null,
      label: 'Crash web server', labelOn: 'Restart web server',
      needsDesign: 'Build the design first: connect Users to the load balancer and the load balancer to the web servers, then crash one.',
      on: 'You pulled the plug on one web server.', onTone: 'bad',
      off: 'Web server restarted.',
      expect: served99,
      notMet: (m) => `Only ${m.servedPct.toFixed(1)}% served with one web server down: the servers left cannot carry the peak. Add a spare web server (N + 1).`,
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
      notMet: (m) => `${m.servedPct.toFixed(0)}% served: every request enters through the load balancer, so it is a single point of failure. Add a standby load balancer connected to every web server.`,
      issue: 'The load balancer is down and nothing takes over, so every request fails.',
      observed: 'Observed: the standby noticed the missing heartbeats, took over the public IP and kept the site up.',
    },
  ],

  // Messages the engine shows for this level's design.
  text: {
    noWeb: 'Users have no way in. Add a load balancer, connect Users to it, and connect it to the web servers.',
    noDns: 'Browsers cannot find example.com. Connect Users to DNS so the name resolves to the load balancer\'s IP.',
    noBackend: 'The load balancer has no web servers to send requests to, so every request fails. Connect it to the web servers.',
    combinedOver: ' It is not connected to the database, so it keeps its own data and only gets half its capacity.',
    nosqlOver: ' NoSQL cannot join, so each request costs 3 lookups.',
    dnsAnswered: 'DNS answered: example.com is at 203.0.113.10, the load balancer\'s public IP. The device caches it.',
    ipTag: 'IP 203.0.113.10 cached',
    levelComplete: 'Level 2 complete. Take the quiz.',
  },

  quiz: {
    passScore: 8,
    passText: 'Level 2 is done. Level 3, database replication, is next. It isn\'t built yet.',
    failText: (pass) => `You need ${pass} to pass. Reread the lesson sections behind the questions you missed, then try again.`,
    questions: [
      { q: 'You put a load balancer in front of your web servers. Which IP does DNS now give users\' devices for example.com?', o: ['The private IP of the first web server', 'The load balancer\'s public IP', 'A web server IP picked at random', 'The database server\'s IP'], a: 1, e: 'Devices connect to the load balancer\'s public IP. The load balancer then forwards each request to a web server over the private network, so users never see the web servers.', r: 'Load balancing' },
      { q: 'Why are the web servers on private IPs once a load balancer is in front?', o: ['Only machines inside the network can reach them', 'Private IPs make every request faster', 'So DNS can cache all of their addresses', 'So each server can store more of the data'], a: 0, e: 'A private IP (for example 10.0.0.11) cannot be reached from the internet. Only the load balancer and other servers inside the network can talk to the web servers, which keeps them out of direct reach.', r: 'Private addresses · RFC 1918' },
      { q: 'One of three web servers starts failing its health check. What does the load balancer do?', o: ['Sends that server\'s share to the database', 'Keeps sending it requests until it is fixed', 'Stops using it; the other two share the load', 'Restarts the server and waits for it to return'], a: 2, e: 'The load balancer checks each server regularly and stops sending requests to one that fails. The healthy servers share its traffic until it is fixed or replaced.', r: 'Health checks and failover' },
      { q: 'Peak traffic is 1,000 req/s and each web server handles 300 req/s. How many servers survive one crash at peak?', o: ['3', '4', '6', '5'], a: 3, e: '1,000 ÷ 300 = 3.3, so 4 servers carry the peak. One more lets you lose any server and still have 4: that is N + 1 = 5.', r: 'N + 1 capacity' },
      { q: 'What does scaling out give you that scaling up cannot?', o: ['A faster response from each server', 'No ceiling, and no single machine to fail', 'A database that never has to grow', 'Cheaper DNS lookups for every user'], a: 1, e: 'Scaling up stops at the biggest machine you can buy, and that one machine is still a single point of failure. Scaling out adds servers behind a load balancer: no fixed ceiling, and one server can fail without taking the site down.', r: 'Scaling up vs scaling out' },
      { q: 'Round robin spreads 600 req/s over one M server (400 req/s) and one S server (200 req/s). What happens?', o: ['Both servers end up 75% busy', 'The M gets 400 req/s and the S gets 200', 'The S gets 300 and drops about 100 of them', 'Nothing fails, since 600 is exactly their capacity'], a: 2, e: 'Round robin gives each server the same share, 300 req/s. The S server can only serve 200, so about 100 requests a second fail (17%) even though the total capacity looks big enough. Use same-size servers, or a weighted method.', r: 'Load-balancing methods' },
      { q: 'A design has one load balancer, three web servers and one database. Which are single points of failure?', o: ['The load balancer and the database', 'Only the database', 'Each of the three web servers', 'None, because there are three servers'], a: 0, e: 'The three web servers back each other up. The load balancer and the database are each the only one of their kind, so either one failing takes the site down.', r: 'Single points of failure' },
      { q: 'How does a standby load balancer know it should take over?', o: ['The web servers elect a new one', 'Users report the errors to it', 'DNS moves the name to its IP', 'It stops getting heartbeats'], a: 3, e: 'The two load balancers send each other heartbeats, small regular "I am alive" signals. When the standby stops hearing them for a few seconds, it takes over the active one\'s public IP.', r: 'Active-passive failover' },
      { q: '4,000,000 daily users make about 15 requests each. Roughly what is the peak QPS?', o: ['~690', '~140', '~1,390', '~13,900'], a: 2, e: '4M × 15 ÷ 86,400 s ≈ 694 requests per second on average. Peak is about 2 × the average, so ≈ 1,390. Picking ~690 means you stopped at the average.', r: 'Estimating QPS' },
      { q: 'Two web servers are each up 99% of the time and fail independently. How often is at least one up?', o: ['99%', '99.99%', '98%', '99.5%'], a: 1, e: 'Both are down at once only 1% × 1% = 0.01% of the time, so at least one is up 99.99% of the time: about 53 minutes of downtime a year instead of 3.65 days. This only holds if their failures are independent.', r: 'Availability arithmetic' },
    ],
  },

  // Lesson tab content (HTML). The diagrams below draw into its figLb and figStandby.
  lessonHtml: `
    <p class="label">Level 2 · Scaling out</p>
    <h1>Load balancer and horizontal scaling</h1>
    <p class="lede">One big server ran out of road: it has a size ceiling, and when it crashes the site goes with it. In this level you put a load balancer in front, spread traffic over a pool of web servers, and keep the site up while you crash parts of it.</p>
    <div class="goals-box">
      <div><b>You will learn</b>How a load balancer spreads traffic and survives a server crash.</div>
      <div><b>You will decide</b>How many web servers, what size, and what to keep as a spare.</div>
      <div><b>You will estimate</b>The new peak, and what is left when one server fails.</div>
    </div>

    <section>
      <h2>Scale out instead of up</h2>
      <p class="src">Scaling up vs scaling out</p>
      <p>Level 1 ended with two problems. The biggest server you can rent is still one server, so there is a ceiling. And when that server stops, everything stops. Both have the same fix: run several smaller servers side by side and add more as traffic grows. That is <b>horizontal scaling</b>, or scaling out.</p>
      <p>It is often cheaper too. In this game a bigger server costs more for each request it can handle:</p>
      <div class="tbl-wrap"><table class="t">
        <thead><tr><th>Server size (game)</th><th>Capacity</th><th>Cost / month</th><th>Cost per 100 req/s</th></tr></thead>
        <tbody>
          <tr><td>S</td><td class="n">200 req/s</td><td class="n">$40</td><td class="n">$20.00</td></tr>
          <tr><td>M</td><td class="n">400 req/s</td><td class="n">$90</td><td class="n">$22.50</td></tr>
          <tr><td>L</td><td class="n">800 req/s</td><td class="n">$200</td><td class="n">$25.00</td></tr>
          <tr><td>XL</td><td class="n">1,600 req/s</td><td class="n">$450</td><td class="n">$28.13</td></tr>
        </tbody>
      </table></div>
      <p>Several servers need something in front of them that decides which one handles each request. That is the load balancer.</p>
    </section>

    <section>
      <h2>What a load balancer does</h2>
      <p class="src">Load balancing · private addresses RFC 1918</p>
      <figure class="fig"><svg id="figLb" viewBox="0 0 640 260" role="img" aria-label="Users look up example.com in DNS and get the load balancer's public IP, 203.0.113.10. They send HTTP requests to the load balancer, which forwards each one to a web server on a private IP, 10.0.0.11 or 10.0.0.12."></svg><figcaption>Users reach one public IP; the web servers sit on private IPs</figcaption></figure>
      <ol>
        <li>DNS now answers example.com with the <b>load balancer's public IP</b>, 203.0.113.10.</li>
        <li>Every request goes to the load balancer. It picks a web server and forwards the request over the private network.</li>
        <li>The web servers have <b>private IPs</b> such as 10.0.0.11 and 10.0.0.12. Addresses in 10.0.0.0/8, 172.16.0.0/12 and 192.168.0.0/16 are reserved for private networks and cannot be reached from the internet, so users can no longer reach a web server directly. Only the load balancer can.</li>
      </ol>
      <p>The web servers become interchangeable. Users only ever see one address, however many servers sit behind it.</p>
    </section>

    <section>
      <h2>When a web server dies</h2>
      <p class="src">Health checks and failover</p>
      <p>The load balancer checks each server every few seconds with a small request, a <b>health check</b>. When a server stops answering, the load balancer stops sending it traffic and the healthy servers share its load. Users never notice. You then replace the broken server and the load balancer starts using it again.</p>
      <p>That only works if the servers that are left can carry the whole peak. Plan for <b>N + 1</b>: N servers to carry the peak, plus one spare. For example, at a peak of 900 req/s with M servers (400 req/s each), 3 servers carry the load (75% busy), so you run 4.</p>
    </section>

    <section>
      <h2>When traffic grows</h2>
      <p class="src">Scaling out · load-balancing methods</p>
      <p>Add servers to the pool. The load balancer starts sending them requests straight away, with no downtime. How it picks a server:</p>
      <ul>
        <li><b>Round robin:</b> each server in turn. Simple, and fair when all servers are the same size. This game uses it.</li>
        <li><b>Least connections:</b> the server with the fewest requests in progress. Better when some requests take much longer than others.</li>
        <li><b>Weighted:</b> bigger servers get a bigger share, so you can mix sizes.</li>
      </ul>
      <p>With plain round robin, mix sizes and the small server overloads first: it gets the same share as the big one. Keep a pool to one size.</p>
      <div class="note"><b>Layer 4 or layer 7.</b> A layer 4 load balancer looks only at IP addresses and ports and forwards the connection. A layer 7 load balancer reads the HTTP request, so it can route by path or cookie, for example sending /api to one pool and /images to another. It costs a little more work per request.</div>
    </section>

    <section>
      <h2>The load balancer is the new single point of failure</h2>
      <p class="src">Active-passive failover</p>
      <p>Now every request goes through one load balancer. If it fails, the whole site fails, however many web servers you run. The usual fix is a <b>standby pair</b>:</p>
      <figure class="fig"><svg id="figStandby" viewBox="0 0 640 260" role="img" aria-label="Users send requests to the active load balancer at 203.0.113.10. A standby load balancer exchanges heartbeats with it and is connected to the same web servers, ready to take over the public IP."></svg><figcaption>Active and standby load balancers share one public IP</figcaption></figure>
      <ul>
        <li>The <b>active</b> load balancer handles all traffic. The <b>standby</b> is connected to the same web servers but handles none.</li>
        <li>The two send each other a <b>heartbeat</b>, a small "still alive" signal, every second or so.</li>
        <li>If the heartbeats stop for a few seconds, the standby takes over the public IP, 203.0.113.10, and carries on. DNS does not change.</li>
      </ul>
      <p>The other option is <b>active-active</b>: both load balancers take traffic and DNS returns both addresses. You use both machines, but each must still be able to carry the whole load alone when the other fails.</p>
    </section>

    <section>
      <h2>How this level is simulated</h2>
      <p class="src">Game assumptions</p>
      <p>The load balancer gives every healthy web server behind it the same share (round robin). A crashed server gets no traffic; its share moves to the others at once. A standby load balancer takes no traffic until the active one fails, then takes all of it.</p>
      <p class="assume">Game assumptions: the load balancer handles 5,000 req/s, adds 1 ms per request and costs $20/month. Health checks and the standby's takeover are instant here; in real systems they take a few seconds, and a few requests fail meanwhile. Server sizes, the 40 ms internet round trip, the 0.5 ms hop inside the data center and the database times are the same as in Level 1. A web server not connected to the database keeps its own copy of the data and gets half its capacity.</p>
    </section>

    <section>
      <h2>Numbers to carry into the interview</h2>
      <p class="src">N + 1 capacity · availability arithmetic</p>
      <p><b>Servers to run</b> = peak req/s ÷ what one server handles (rounded up), plus one spare. Size for a comfortable load, not 100%: a server at 75% busy already takes 4× its base time.</p>
      <p><b>Redundancy multiplies availability.</b> If one server is up 99% of the time (3.65 days of downtime a year), two independent servers are both down only 1% × 1% = 0.01% of the time. At least one is up 99.99% of the time: about 53 minutes a year. "Independent" matters: two servers on the same power supply, or updated by the same bad deploy, can fail together.</p>
    </section>

    <section>
      <h2>How each mission maps to the interview</h2>
      <p class="src">Interview loop · times for a 45-minute interview (formats vary by company)</p>
      <div class="steps4">
        <div><span>Step 1 · 5–8 min</span><b>Scope it</b>Read the brief. Estimate the peak.</div>
        <div><span>Step 2 · 10–12 min</span><b>Sketch it</b>Load balancer, pool, database.</div>
        <div><span>Step 3 · 15–20 min</span><b>Go deep</b>Size the pool. Keep a spare.</div>
        <div><span>Step 4 · 5 min</span><b>Stress it</b>Crash a server, then the load balancer.</div>
      </div>
      <p>When the interviewer asks "what happens if this server dies?", follow a request through your design and name the next single point of failure. After the load balancer and the pool, it is usually the database.</p>
    </section>
`,

  // Lesson diagrams. `f` provides the engine's drawing helpers.
  drawFigures(f) {
    const { $, svgEl, figNode, figArrow, figDefs } = f;
    const dashed = (svg, x1, y1, x2, y2) => svgEl('line', { x1, y1, x2, y2, class: 'd-line d-dash', 'marker-end': 'url(#figArr)' }, svg);

    const f1 = $('figLb'); f1.textContent = ''; figDefs(f1);
    figNode(f1, 'users', 104, 50, 'Users', 'Browser + app');
    figNode(f1, 'dns', 104, 205, 'DNS', 'example.com?');
    figNode(f1, 'lb', 320, 128, 'Load balancer', 'Public 203.0.113.10');
    figNode(f1, 'web', 536, 50, 'Web server', 'Private 10.0.0.11');
    figNode(f1, 'web', 536, 205, 'Web server', 'Private 10.0.0.12');
    figArrow(f1, 104, 82, 104, 173, 'lookup', '1', 118, 132);
    figArrow(f1, 168, 82, 240, 96, 'HTTP', '2', 208, 70);
    figArrow(f1, 400, 96, 472, 82, 'forward', '3', 418, 72);
    figArrow(f1, 400, 160, 472, 173, 'forward', null, 372, 190);

    const f2 = $('figStandby'); f2.textContent = ''; figDefs(f2);
    figNode(f2, 'users', 104, 128, 'Users', 'to 203.0.113.10');
    figNode(f2, 'lb', 320, 50, 'Load balancer', 'Active · has the IP');
    figNode(f2, 'lb', 320, 205, 'Load balancer', 'Standby · waiting');
    figNode(f2, 'web', 536, 128, 'Web servers', 'Private IPs');
    figArrow(f2, 168, 112, 240, 70, 'HTTP', null, 190, 82);
    figArrow(f2, 300, 82, 300, 173, 'heartbeat', null, 288, 132, 'end');
    figArrow(f2, 340, 173, 340, 82, '', null, 352, 132);
    figArrow(f2, 400, 70, 472, 112, 'forward', null, 438, 80);
    dashed(f2, 400, 186, 472, 146);
    const t = svgEl('text', { x: 438, y: 196, class: 'd-label', 'text-anchor': 'start' }, f2); t.textContent = 'if it takes over';
  },
};
