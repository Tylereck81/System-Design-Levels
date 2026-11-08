// @ts-check
/** @import { Level, Goal } from '../js/types.js' */
// Level 7: Multiple data centers.
// Everything specific to this level lives here: components, rules, missions, quiz and text.
// From this level on, one box stands for a whole data center: the design built in Levels 2 to 6.
import { fmt } from '../js/format.js';
import { servedGoal, latGoal, costGoal, spofGoal, servedAtLeast, fmtPct } from './shared/goals.js';
import { regionUsers, cdn } from './shared/components.js';
import { dnsLookup, usersToCdn, CDN_DNS_BAD } from './shared/connections.js';
import { lbText, replicaText, levelComplete } from './shared/text.js';
import { ONE_DNS, ONE_CDN } from './shared/limits.js';
import { failText, passText } from './shared/quiz.js';
import { filesWorkload } from './shared/workload.js';

const targets = { latencyMs: 150, servedPct: 99 };
const PCT = { wholeFrom: 10 }; // percentages: whole numbers from 10% up
const FAR_PAGE_MS = 100;
const BUDGET = 3100;
const FAILOVER_BUDGET = 3500;
const NO_DATA_MAX = 0.05; // % of requests: below this, nobody missed their data

/** @type {Goal} */
const farPageGoal = {
  id: 'far-page', type: 'metric', text: `Pages reach shoppers in America in under ${FAR_PAGE_MS} ms`,
  test: (m) => m.farPageMs != null && m.farPageMs < FAR_PAGE_MS,
  val: (m) => (m.farPageMs == null ? '—' : fmt(m.farPageMs) + ' ms'),
};
const served99 = servedAtLeast(targets.servedPct);
const place = (n) => (n.region === 'far' ? 'Virginia' : 'Frankfurt');

/** @type {Level} */
export default {
  id: 7,
  saveKey: 'sdl-level7-v1',
  saveVersion: 1,
  targets,
  workload: filesWorkload(),

  components: {
    users: {
      ...regionUsers(),
      regions: null, // round trips depend on which data center each region reaches
      desc: 'Your shoppers: 70% in Europe and 30% in America. Each region is 40 ms from a data center of its own, and 120 ms from one across the ocean. Half of all requests are files, which come from the CDN.',
    },
    dns: {
      name: 'DNS', short: 'Domain → IP address',
      desc: 'Turns example.com into a data center\'s address. Costs $5/month in this game.',
      subOf: (n) => (n.routing === 'geo' ? 'GeoDNS' : 'Same answer for all'),
      choices: [
        {
          key: 'routing', label: 'Answers',
          options: [
            { id: 'rr', name: 'Same for everyone', sub: 'every data center\'s address', note: 'Every device gets the same answer: each data center\'s address. Each device picks one, so shoppers spread evenly over the data centers, wherever they are. Plain DNS does not check health, so it keeps handing out the address of a data center that is down.', log: 'DNS now gives every shopper the same answer.' },
            { id: 'geo', name: 'GeoDNS', sub: 'nearest healthy data center', note: 'Answers by where the shopper is: Europe gets Frankfurt\'s address, America gets Virginia\'s. It checks each data center\'s health, and sends everyone to the healthy one when the other is down.', log: 'DNS set to GeoDNS: each shopper gets the nearest healthy data center.' },
          ],
        },
      ],
    },
    cdn: cdn(),
    dc: {
      name: 'Data center', short: 'Your whole design',
      nameOf: (n) => `${place(n)} DC`,
      subOf: (n, size) => `${n.size} · ${fmt(size.cap)} pages/s`,
      desc: 'A whole data center running the design you built in Levels 2 to 6: load balancers, autoscaled web servers, caches, databases and a session store. A page takes about 50 ms inside it. Its size is how many pages a second its databases and network take at peak; above that, pages fail.',
      sizeLabel: 'Size (pages/s at peak)',
      choices: [
        {
          key: 'region', label: 'Location',
          options: [
            { id: 'near', name: 'Frankfurt', sub: 'Europe', note: 'In Frankfurt: 40 ms from shoppers in Europe, 120 ms from shoppers in America.', log: 'Data center placed in Frankfurt.' },
            { id: 'far', name: 'Virginia', sub: 'America', note: 'In Virginia: 40 ms from shoppers in America, 120 ms from shoppers in Europe.', log: 'Data center placed in Virginia.' },
          ],
        },
      ],
    },
  },
  palette: ['dns', 'cdn', 'dc'],
  limits: { dns: 1, cdn: 1, dc: 2 },
  limitMsg: {
    dns: ONE_DNS,
    cdn: ONE_CDN,
    dc: 'Two data centers is the limit here: one for each region.',
  },
  // Level 6's design, now one data center in Frankfurt, sized to carry every page; and Level 5's CDN.
  startNodes: [
    { id: 'u', type: 'users', x: 380, y: 60 },
    { id: 'd', type: 'dns', x: 120, y: 60, routing: 'rr' },
    { id: 'k', type: 'cdn', x: 640, y: 60, ttl: '86400', onChange: 'version', fallback: 'origin' },
    { id: 'f', type: 'dc', x: 250, y: 250, size: 'L', region: 'near' },
  ],
  startEdges: [
    { id: 's1', from: 'u', to: 'd' }, { id: 's2', from: 'u', to: 'f' }, { id: 's3', from: 'u', to: 'k' }, { id: 's4', from: 'k', to: 'f' },
  ],
  slots: { dns: { x: 120, y: 60 }, cdn: { x: 640, y: 60 }, dc: [{ x: 510, y: 250 }, { x: 250, y: 250 }] },

  connections: {
    ok: {
      'dns|users': dnsLookup(),
      'cdn|users': usersToCdn(),
      'dc|users': { from: 'users', to: 'dc', label: 'pages', desc: 'Shoppers send page requests to the data center DNS gave them the address of. Each data center has its own public IP.' },
      'cdn|dc': { from: 'cdn', to: 'dc', label: 'misses', desc: 'The CDN\'s origin. When an edge does not have a file, it fetches it from this data center.' },
      'dc|dc': { from: 'dc', to: 'dc', label: 'replicates', desc: 'Copies this data center\'s data (accounts, carts and orders) to the other one, asynchronously: each change is sent after it is saved, so the copy runs about a second behind. Connect both ways so either one can take over.' },
    },
    bad: {
      'dc|dns': 'DNS answers name lookups off the request path. Connect Users to DNS, and Users to each data center.',
      'cdn|dns': CDN_DNS_BAD,
      'cdn|cdn': ONE_CDN,
    },
  },

  missions: [
    {
      title: 'Pages for America', ref: 'GeoDNS', qps: 4000, writes: 0.2, files: 0.5, far: 0.3, budget: BUDGET,
      story: 'Files reach America from the CDN in 42 ms, but every page still crosses the ocean: 120 ms there and back, plus 50 ms inside Frankfurt. Open a second data center in Virginia and send shoppers in America to it. Frankfurt then serves only Europe, so it can be smaller: keep the bill at $3,100.',
      goals: [farPageGoal, servedGoal(targets), latGoal(targets), costGoal(BUDGET)],
      hint: 'Add a data center, set its location to Virginia, and connect Users to it. Select DNS and switch it to GeoDNS. Frankfurt now carries only Europe\'s 1,400 pages a second, so size M is enough.',
      takeaway: 'Each shopper now reaches the nearest data center: 90 ms for a page in America instead of 170. Each data center is sized for its own region. Mission 2 asks what happens when one of them goes dark.',
    },
    {
      title: 'Virginia goes dark', ref: 'Failover', qps: 4000, writes: 0.2, files: 0.5, far: 0.3, budget: FAILOVER_BUDGET,
      gate: {
        hidesTraffic: false,
        lo: 1950, hi: 2050,
        prompt: '<b>Estimate before you build.</b> At the evening peak, shoppers open 2,000 pages a second: 70% in Europe and 30% in America. Files come from the CDN. If Virginia goes offline, how many pages a second must Frankfurt carry?',
        label: 'Pages per second',
        placeholder: 'e.g. 1,000',
        acceptedHtml: '<p><b>Estimate accepted.</b></p><div class="calc">Europe: 70% × 2,000 = 1,400 pages/s<br>America: 30% × 2,000 = 600 pages/s<br>Frankfurt alone: 1,400 + 600 = 2,000 pages/s</div>',
        acceptedLog: 'Estimate accepted: Frankfurt must carry all 2,000 pages a second. Play is unlocked.',
        notNumber: 'Type the estimate as pages per second, for example 1,000.',
        hints: [
          { test: (v) => v >= 1350 && v <= 1450, text: 'That is Europe alone. Shoppers in America move to Frankfurt too.' },
          { test: (v) => v >= 550 && v <= 650, text: 'That is America alone. Frankfurt keeps serving Europe as well.' },
          { test: (v) => v >= 3900 && v <= 4100, text: 'That counts files too. Files come from the CDN, not the data center.' },
        ],
        fallback: 'Not quite. Add Europe\'s share of the 2,000 pages a second to America\'s.',
      },
      story: 'A power failure takes the Virginia data center offline at the evening peak. American shoppers must keep shopping from Frankfurt. That only works if DNS stops sending them to Virginia, Frankfurt is big enough for everyone, and it already has their accounts, carts and orders.',
      goals: [
        servedGoal(targets), latGoal(targets), spofGoal(), costGoal(FAILOVER_BUDGET),
        { id: 'dc-offline', type: 'exp', text: 'Break it: take Virginia offline and still serve at least 99%' },
      ],
      hint: 'Use GeoDNS, so it stops handing out Virginia\'s address. Make Frankfurt big enough for both regions. Then connect Virginia to Frankfurt, so Virginia\'s data is copied there.',
      takeaway: 'Shoppers in America barely noticed: pages took 170 ms instead of 90, and their data was in Frankfurt, apart from the last second of changes that had not crossed the ocean yet. That gap is the price of asynchronous replication. Keep DNS answers short-lived too, so devices pick up the new address quickly. If Frankfurt failed instead, Virginia could not cover: Europe\'s data is not copied there, and an S data center is far too small for 2,000 pages a second. Real setups copy data both ways and size every data center for the full load, or keep a third.',
    },
  ],

  // Break-it experiments. A crash takes down the component `target` picks when it starts;
  // `expect` is the outcome that must hold for the whole run before it counts.
  experiments: [
    {
      id: 'dc-offline', kind: 'crash', target: (g) => g.onPath('dc').find((n) => n.region === 'far') || null,
      label: 'Take Virginia offline', labelOn: 'Bring Virginia back',
      needsDesign: 'Build the design first: add a data center in Virginia, then take it offline.',
      on: 'The Virginia data center is offline.', onTone: 'bad',
      off: 'Virginia is back online.',
      expect: (m) => served99(m) && m.noDataPct < NO_DATA_MAX,
      notMet: (m) => {
        if (m.g.dns && m.g.dns.routing !== 'geo') return `Only ${m.servedPct.toFixed(1)}% served: plain DNS still hands out Virginia's address, and requests sent there fail. Switch DNS to GeoDNS: it checks each data center's health.`;
        if (m.noDataPct >= NO_DATA_MAX) return `${fmtPct(m.noDataPct, PCT)} of requests reach Frankfurt for shoppers whose accounts, carts and orders are only in Virginia, so they fail. Connect Virginia to Frankfurt to copy its data there.`;
        return `Only ${m.servedPct.toFixed(1)}% served: Frankfurt now gets every page and is over capacity. Make it bigger.`;
      },
      observed: (m) => `Observed: Virginia offline, ${m.servedPct.toFixed(1)}% served. Shoppers in America got pages from Frankfurt in ${fmt(m.farPageMs || 0)} ms. Their data was there, except the last second of changes: about ${fmt(Math.round(m.lagWrites / 10) * 10)} writes had not arrived yet.`,
    },
  ],

  // Messages the engine shows for this level's design.
  text: {
    ...lbText(),
    ...replicaText(),
    noWeb: 'Users have no way in. Connect Users to a data center.',
    noDns: 'Browsers cannot find example.com. Connect Users to DNS.',
    noOrigin: 'The CDN has no origin: on a miss it has nowhere to fetch a file from, so it never holds any. Connect the CDN to a data center.',
    dnsAnswered: 'DNS answered with a data center\'s address. The device caches it until the answer expires.',
    ipTag: 'Address cached',
    levelComplete: levelComplete(7),
  },

  quiz: {
    passScore: 8,
    passText: passText(7, 'Message queue, workers and monitoring'),
    failText,
    questions: [
      { q: 'What does GeoDNS do?', o: ['Caches pages in cities near users', 'Answers by where the user is', 'Copies data between data centers', 'Balances load across web servers'], a: 1, e: 'GeoDNS returns a different address depending on the user\'s location, usually the nearest data center. Copying data is replication; caching near users is a CDN.', r: 'GeoDNS' },
      { q: 'With GeoDNS, Virginia goes offline. Where does its traffic go?', o: ['Nowhere until Virginia is back online', 'To the CDN, which serves the pages itself', 'To Frankfurt, the healthy data center', 'To a standby DNS server'], a: 2, e: 'GeoDNS checks each data center\'s health and sends everyone to the healthy one. Users far from it get slower pages, but they keep working.', r: 'Failover' },
      { q: 'Why replicate data between data centers?', o: ['A user who fails over must find their data', 'So GeoDNS knows where each user is', 'So the CDN can pull files from both of them', 'So each data center can use a smaller database'], a: 0, e: 'After a failover, users land in a data center that did not serve them before. Their accounts, carts and orders must already be there.', r: 'Running several data centers' },
      { q: 'Data centers replicate asynchronously. What is the risk on failover?', o: ['Every write waits for an ocean round trip first', 'The newest writes may not have arrived', 'GeoDNS stops answering', 'The CDN serves stale files'], a: 1, e: 'Asynchronous replication sends each change after it is saved, so the copy runs a little behind. Changes from the last moments before an outage may be missing on the other side.', r: 'Running several data centers' },
      { q: 'What does synchronous replication between data centers cost?', o: ['Every write waits for the far side to confirm', 'Reads must always go to the data center far away', 'The CDN must be turned off during writes', 'Each data center needs its own domain name'], a: 0, e: 'With synchronous replication, a write is done only when the other data center has it too, so every write adds a round trip across the ocean. That is why asynchronous replication is common between data centers.', r: 'Running several data centers' },
      { q: 'Virginia is offline, but some phones still send requests there for a while. Why?', o: ['Phones cannot read GeoDNS answers', 'The load balancer in Frankfurt sends them back there', 'GeoDNS needs a day to update its records', 'They cached the old DNS answer until it expired'], a: 3, e: 'Devices cache DNS answers for their TTL. Until it runs out, they keep using the old address, so failover by DNS takes as long as that TTL. Keep it short.', r: 'Failover' },
      { q: 'Why use automated deployment with several data centers?', o: ['It keeps every data center on the same version', 'It moves users to the nearest data center', 'It makes replication synchronous for each release', 'It removes the need for a CDN'], a: 0, e: 'Deploying by hand to several places invites drift: one data center runs different code from another. Automated deployment keeps them the same, and testing from different locations catches regional problems.', r: 'Running several data centers' },
      { q: 'Two data centers split 5,000 req/s at peak, 60% and 40%. The 60% one goes offline. What must the other carry?', o: ['2,000 req/s', '3,000 req/s', '5,000 req/s', '10,000 req/s'], a: 2, e: 'All the traffic moves to the survivor: 3,000 + 2,000 = 5,000 req/s. Size each data center for that, or failover overloads it.', r: 'Numbers to carry into the interview' },
      { q: 'Shoppers in Europe and America use one data center in Europe. What does a second one in America mainly improve for Americans?', o: ['Their cart size limit', 'The CDN\'s hit rate for their files', 'The number of products the catalog can hold for them', 'Their page load times, by a shorter round trip'], a: 3, e: 'Pages built for each shopper cannot come from a CDN, so they make the trip to a data center. A nearby one cuts that round trip from 120 ms to 40 ms in this game.', r: 'Multiple data centers' },
      { q: 'Each data center is sized only for its own region. What breaks?', o: ['GeoDNS cannot tell the regions apart', 'Failover: the survivor can\'t carry both regions', 'Replication between the two data centers stops at peak', 'The CDN must serve every page'], a: 1, e: 'When one data center goes down, the other gets all the traffic. If it was sized for its own region alone, it overloads exactly when you need it.', r: 'Failover' },
    ],
  },

  // Lesson tab content (HTML). The diagrams below draw into figGeo and figFailover.
  lessonHtml: `
    <p class="label">Level 7 · Multiple data centers</p>
    <h1>Multiple data centers</h1>
    <p class="lede">Your data center is in Frankfurt, and every page for shoppers in America crosses the ocean twice. In this level you open a second data center in Virginia, send each shopper to the nearest one, and then take one offline to see whether the other can carry everyone, with their data.</p>
    <div class="goals-box">
      <div><b>You will learn</b>GeoDNS, data center failover, and keeping data in sync.</div>
      <div><b>You will decide</b>Where each data center is, how big it is, and which way data is copied.</div>
      <div><b>You will estimate</b>The traffic one data center must carry when the other fails.</div>
    </div>

    <section>
      <h2>Multiple data centers</h2>
      <p class="src">Geo-routing</p>
      <p>From this level on, one box on the canvas stands for a whole data center: everything you built in Levels 2 to 6, from load balancers to databases.</p>
      <figure class="fig"><svg id="figGeo" viewBox="0 0 660 250" role="img" aria-label="GeoDNS sends shoppers in Europe, 70% of traffic, to the Frankfurt data center, and shoppers in America, 30%, to the Virginia data center. The two data centers copy data to each other."></svg><figcaption>Each shopper is sent to the nearest data center; the two copy data to each other</figcaption></figure>
      <p>In normal operation each user is sent to the closest data center. Here that splits traffic 70% to Frankfurt and 30% to Virginia. Pages for shoppers in America no longer cross the ocean.</p>
    </section>

    <section>
      <h2>GeoDNS</h2>
      <p class="src">DNS by location</p>
      <p><b>GeoDNS</b> is a DNS service that answers by where the user is: it looks at the location of the request and returns the address of the nearest data center. Plain DNS gives everyone the same answer.</p>
      <p>GeoDNS services also check each data center's health, so they can stop handing out the address of one that is down.</p>
    </section>

    <section>
      <h2>Failover</h2>
      <p class="src">Data center outages</p>
      <figure class="fig"><svg id="figFailover" viewBox="0 0 660 250" role="img" aria-label="The Virginia data center is offline. GeoDNS sends all traffic, from Europe and America, to the Frankfurt data center."></svg><figcaption>When one data center is offline, all traffic goes to the healthy one</figcaption></figure>
      <p>If a data center has a serious outage, all traffic is directed to a healthy one. Two questions decide whether that works: is the survivor big enough for everyone, and does it have everyone's data?</p>
      <p>DNS failover is not instant. Devices cache a DNS answer until its TTL runs out, so keep the TTL short for addresses that may change.</p>
    </section>

    <section>
      <h2>Running several data centers</h2>
      <p class="src">Challenges</p>
      <ul>
        <li><b>Traffic redirection.</b> You need a reliable way to send users to the right data center. GeoDNS sends each one to the nearest.</li>
        <li><b>Data synchronization.</b> Each data center has its own databases and caches. After a failover, users may land where their data is not. The usual answer is to replicate data between data centers, most often <b>asynchronously</b>: each change is sent after it is saved, so the copy runs slightly behind, and the last changes before an outage can be missing. Synchronous replication avoids that, but every write then waits for a round trip across the ocean.</li>
        <li><b>Test and deployment.</b> Test the site from different locations. Use automated deployment tools so every data center runs the same version.</li>
      </ul>
    </section>

    <section>
      <h2>How this level is simulated</h2>
      <p class="src">Game assumptions</p>
      <p>A shopper is 40 ms from a data center in their own region and 120 ms from one across the ocean. A page takes 50 ms inside a data center, the time your Level 6 design took, up to the data center's size. Above that, the extra pages fail. Files still come from the CDN.</p>
      <p>Plain DNS spreads each region evenly over every data center, up or down. GeoDNS sends each region to its own healthy data center, or to the other one when its own is down. A page served by a data center that does not hold that shopper's data fails, unless the shopper's own data center replicates to it. Replicated data runs 1 second behind.</p>
      <p class="assume">Game assumptions: 70% of shoppers are in Europe, 30% in America. A data center costs $700 a month for 800 pages/s at peak, $1,200 for 1,600 and $1,700 for 2,400, including its servers, network and replication traffic. DNS failover is immediate here; real devices wait for their cached answer to expire.</p>
    </section>

    <section>
      <h2>Numbers to carry into the interview</h2>
      <p class="src">Failover capacity</p>
      <p><b>Failover load</b> = the traffic of every region the survivor takes over. With 70% and 30%, the survivor must carry 100% at peak.</p>
      <p><b>Writes at risk</b> = writes per second × replication lag. Here: 600 pages/s × 20% writes × 1 s = 120 writes.</p>
    </section>

    <section>
      <h2>How each mission maps to the interview</h2>
      <p class="src">Interview loop · times for a 45-minute interview (formats vary by company)</p>
      <div class="steps4">
        <div><span>Step 1 · 5–8 min</span><b>Scope it</b>Where are the users? How much traffic comes from each region?</div>
        <div><span>Step 2 · 10–12 min</span><b>Sketch it</b>A data center per region, GeoDNS in front.</div>
        <div><span>Step 3 · 15–20 min</span><b>Go deep</b>Replication between data centers, sync or async, deployment.</div>
        <div><span>Step 4 · 5 min</span><b>Stress it</b>Take a data center offline. Is the other big enough? Is the data there?</div>
      </div>
      <p>When you add a data center in an interview, say how users reach it, how much spare capacity each one keeps, and how data is copied between them.</p>
    </section>
`,

  // Lesson diagrams. `f` provides the engine's drawing helpers.
  drawFigures(f) {
    const { $, figNode, figArrow, figDefs } = f;
    const f1 = $('figGeo'); f1.textContent = ''; figDefs(f1);
    figNode(f1, 'users', 110, 40, 'Europe', 'Shoppers, 70% of traffic');
    figNode(f1, 'dns', 330, 40, 'GeoDNS', 'Picks the nearest');
    figNode(f1, 'users', 550, 40, 'America', 'Shoppers, 30% of traffic');
    figNode(f1, 'dc', 110, 200, 'Frankfurt DC', 'Data center 1');
    figNode(f1, 'dc', 550, 200, 'Virginia DC', 'Data center 2');
    figArrow(f1, 110, 70, 110, 168, 'nearest', null, 122, 124, 'start');
    figArrow(f1, 550, 70, 550, 168, 'nearest', null, 562, 124, 'start');
    figArrow(f1, 206, 192, 452, 192, 'replication', null, 330, 184, 'middle');
    figArrow(f1, 452, 208, 206, 208, '', null, 0, 0);

    const f2 = $('figFailover'); f2.textContent = ''; figDefs(f2);
    figNode(f2, 'users', 110, 40, 'Europe', 'Shoppers, 70% of traffic');
    figNode(f2, 'dns', 330, 40, 'GeoDNS', 'Health checks');
    figNode(f2, 'users', 550, 40, 'America', 'Shoppers, 30% of traffic');
    figNode(f2, 'dc', 110, 200, 'Frankfurt DC', 'Takes 100%');
    figNode(f2, 'dc', 550, 200, 'Virginia DC', 'Offline');
    figArrow(f2, 110, 70, 110, 168, 'as before', null, 122, 124, 'start');
    figArrow(f2, 500, 70, 170, 168, 'now to Frankfurt', null, 352, 132, 'start');
  },
};
