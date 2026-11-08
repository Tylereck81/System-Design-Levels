// @ts-check
/** @import { Level, Goal } from '../js/types.js' */
// Level 3: Database replication.
// Everything specific to this level lives here: components, rules, missions, quiz and text.
import { servedGoal, latGoal, costGoal, spofGoal, servedAtLeast } from './shared/goals.js';
import { shopUsers, dns, lb, NO_DB_NOTE, replicaDb } from './shared/components.js';
import { dnsLookup, usersToLb, lbToWeb, webToReplicas, lbBad, replicaBad } from './shared/connections.js';
import { lbText, replicaText, levelComplete } from './shared/text.js';
import { ONE_DNS, TWO_LBS } from './shared/limits.js';
import { failText, passText } from './shared/quiz.js';

const targets = { latencyMs: 150, servedPct: 99 };
const DB_BUSY = 0.7;

const served99 = servedAtLeast(targets.servedPct);

const dbsOf = (g, n) => g.next(n).filter((c) => c.type === 'db');
/** @type {Goal} */
const splitGoal = {
  id: 'split', type: 'struct', text: 'Every web server sends writes to the primary and reads to a replica',
  test: (g) => { const webs = g.onPath('web'); return webs.length > 0 && webs.every((w) => dbsOf(g, w).some((d) => d.role === 'primary') && dbsOf(g, w).some((d) => d.role === 'replica')); },
};
// Busy-ness of the databases that are serving (a waiting or crashed one does not count).
const dbLoads = (m) => m.g.onPath('db').map((n) => m.node[n.id]).filter((st) => st && !st.down);
/** @type {Goal} */
const dbBusyGoal = {
  id: 'dbbusy', type: 'metric', text: `Every database under ${DB_BUSY * 100}% busy`,
  test: (m) => dbLoads(m).length > 0 && dbLoads(m).every((st) => st.util < DB_BUSY),
  val: (m) => (dbLoads(m).length ? Math.round(100 * Math.max(...dbLoads(m).map((st) => st.util))) + '% max' : '—'),
};

const replicasUp = (m) => m.g.onPath('db').filter((n) => n.role === 'replica' && !m.down.has(n.id)).length;
const primaryUp = (m) => m.g.onPath('db').some((n) => n.role === 'primary' && !m.down.has(n.id));

/** @type {Level} */
export default {
  id: 3,
  saveKey: 'sdl-level3-v1',
  saveVersion: 2, // 2: break-it results are kept per mission
  quizVersion: 1,
  targets,

  components: {
    users: shopUsers(),
    dns: dns(),
    lb: lb(),
    web: {
      name: 'Web server', short: 'Your back-end code',
      desc: 'Runs your back-end code on a private IP. It sends every write to the primary database and shares the reads over the replicas it is connected to.',
      noDbNote: NO_DB_NOTE,
    },
    db: replicaDb(),
  },
  palette: ['dns', 'lb', 'web', 'db'],
  limits: { dns: 1, lb: 2, web: 2, db: 4 },
  limitMsg: {
    dns: ONE_DNS,
    lb: TWO_LBS,
    web: 'Two XL web servers carry this level\'s traffic: 3,200 req/s together. This level is about the database.',
    db: 'Four databases is the limit here: one primary and up to three replicas.',
  },
  // Level 2's finished design, now on two XL web servers. The one database is the primary.
  startNodes: [
    { id: 'u', type: 'users', x: 250, y: 60 },
    { id: 'd', type: 'dns', x: 510, y: 60 },
    { id: 'l1', type: 'lb', x: 250, y: 168, algo: 'rr' },
    { id: 'l2', type: 'lb', x: 510, y: 168, algo: 'rr' },
    { id: 'w1', type: 'web', x: 250, y: 276, size: 'XL' },
    { id: 'w2', type: 'web', x: 510, y: 276, size: 'XL' },
    { id: 'b', type: 'db', x: 120, y: 384, size: 'XL', kind: 'sql', role: 'primary' },
  ],
  startEdges: [
    { id: 's1', from: 'u', to: 'd' }, { id: 's2', from: 'u', to: 'l1' }, { id: 's3', from: 'u', to: 'l2' },
    { id: 's4', from: 'l1', to: 'w1' }, { id: 's5', from: 'l1', to: 'w2' }, { id: 's6', from: 'l2', to: 'w1' }, { id: 's7', from: 'l2', to: 'w2' },
    { id: 's8', from: 'w1', to: 'b' }, { id: 's9', from: 'w2', to: 'b' },
  ],
  slots: {
    dns: { x: 510, y: 60 }, lb: { x: 510, y: 168 }, web: { x: 510, y: 276 },
    // Replicas beside the primary and under the web servers, so no connection runs under another database.
    db: [{ x: 640, y: 384 }, { x: 250, y: 468 }, { x: 510, y: 468 }, { x: 120, y: 384 }],
  },

  connections: {
    ok: {
      'dns|users': dnsLookup(),
      'lb|users': usersToLb(),
      'lb|web': lbToWeb(),
      'db|web': webToReplicas(),
    },
    bad: { ...lbBad(), ...replicaBad() },
  },

  missions: [
    {
      title: 'Reads swamp the database', ref: 'Read replicas', qps: 1500, writes: 0.1, budget: 2400,
      story: 'example.com keeps growing: 1,500 req/s at peak. Nine in ten requests only read data, such as product pages and search; one in ten writes, such as an order. The web servers cope. The one database does not: it is XL, the largest size, and 94% busy, so every query waits in line. Add read replicas: copies that take the reads, while the primary keeps every write.',
      goals: [
        splitGoal, dbBusyGoal,
        servedGoal(targets), latGoal(targets), costGoal(2400),
        { id: 'crash-replica', type: 'exp', text: 'Break it: crash a replica and still serve at least 99%' },
      ],
      hint: 'Add a database: it becomes a read replica. Connect both web servers to it. The replicas share the 1,350 reads a second evenly, and each one also applies all 150 writes a second the primary makes. Select a replica to see both numbers. Each replica carries its share of the reads plus every write. Work out how big each must be to stay under 70% busy.',
      takeaway: 'Reads now spread over the replicas, and the primary only handles writes. When a replica crashed, the others took its reads: slower, but nothing failed. Each replica also applied every write. That was cheap while writes were few.',
    },
    {
      title: 'Writes catch up', ref: 'Replicas and writes', qps: 2000, writes: 0.2, budget: 2800,
      gate: {
        lo: 360, hi: 440,
        prompt: '<b>Estimate before you build.</b> Peak QPS = DAU × requests per user per day ÷ 86,400, then × 2 for peak. Then take the share that writes.',
        label: 'Peak writes/s',
        placeholder: 'e.g. 300',
        acceptedHtml: '<p><b>Estimate accepted.</b></p><div class="calc">3,600,000 DAU × 24 req ÷ 86,400 s = 1,000 req/s average<br>Peak ≈ 2 × 1,000 = 2,000 req/s<br>1 in 5 writes: 2,000 ÷ 5 = 400 writes/s</div>',
        acceptedLog: 'Estimate accepted: about 400 writes/s in a 2,000 req/s peak. Play is unlocked.',
        notNumber: 'Type the estimate as a number, for example 300.',
        hints: [
          { test: (v) => v >= 180 && v <= 220, text: 'That is the average write rate. Peak traffic is about twice the average.' },
          { test: (v) => v >= 1800 && v <= 2200, text: 'That is every request at peak. Only 1 in 5 is a write.' },
          { test: (v) => v >= 900 && v <= 1100, text: 'That is the average for all requests. Double it for peak, then take 1 in 5.' },
          { test: (v) => v > 20000, text: 'Too high. Did you forget to divide by 86,400 seconds in a day?' },
        ],
        fallback: 'Not quite. Work it out: 3,600,000 × 24 ÷ 86,400, double it for peak, then take 1 in 5.',
      },
      story: 'Shoppers can now keep carts and wishlists and post reviews, so 1 in 5 requests is a write. Daily users grew to 3,600,000, each sending about 24 requests, and peak traffic is about twice the average. Estimate the peak writes per second, then grow the database tier.',
      goals: [
        { id: 'est', type: 'gate', text: 'Estimate the peak writes per second' },
        splitGoal, dbBusyGoal,
        servedGoal(targets), latGoal(targets), costGoal(2800),
        { id: 'crash-replica', type: 'exp', text: 'Break it: crash a replica and still serve at least 99%' },
      ],
      hint: 'Each replica carries its share of the reads plus every write. At 400 writes a second, an L replica (800 queries/s) is half busy before it serves a single read, so use XL replicas. Then make sure the replicas left after a crash can still carry the reads.',
      takeaway: 'More replicas spread the reads, but every replica still applies every write, and the primary takes them all alone. As writes grow, each replica has less room for reads. Replicas scale reads, not writes. Spreading writes takes sharding, in Level 9.',
    },
    {
      title: 'The primary fails', ref: 'Promoting a replica', qps: 2000, writes: 0.2, budget: 2800,
      story: 'Replicas cover for each other, but every write still goes to one primary. If it fails, nobody can place an order. Crash it, then promote a replica: it becomes the new primary and takes the writes. Read what the log says about the newest writes.',
      goals: [
        splitGoal, spofGoal(), dbBusyGoal,
        servedGoal(targets), latGoal(targets), costGoal(2800),
        { id: 'crash-primary', type: 'exp', text: 'Break it: crash the primary, promote a replica, and serve at least 99%' },
      ],
      hint: 'Press Crash primary: every write fails, so only 80% is served. Select a replica on the canvas and press Promote to primary in the inspector. Both web servers must already be connected to it. Then press Restart old primary: it comes back as a replica.',
      takeaway: 'The primary died and the site stayed up: a replica became the new primary and the others kept serving reads. You also saw the cost: the old primary\'s newest writes never reached the replica. Real systems detect the failure and promote a replica automatically, keep replicas close behind, and some wait for one replica to confirm each write.',
    },
  ],

  // Break-it experiments. A crash takes down the component `target` picks when it starts;
  // `expect` is the outcome that must hold for the whole run before it counts.
  experiments: [
    {
      // Any replica could fail; the test takes down the one the others can least cover for.
      id: 'crash-replica', kind: 'crash', targets: (g) => g.onPath('db').filter((n) => n.role === 'replica'),
      label: 'Crash replica', labelOn: 'Restart replica',
      needsDesign: 'Build the design first: add a read replica and connect the web servers to it, then crash it.',
      on: 'You pulled the plug on the read replica the site can least afford to lose.', onTone: 'bad',
      off: 'Replica restarted. It catches up on the writes it missed, then serves reads again.',
      expect: served99,
      notMet: (m) => `Only ${m.servedPct.toFixed(1)}% served with one replica down: the databases left cannot carry the reads. Add another replica, so the others can cover for one (N + 1).`,
      issue: 'Every replica is down and there is no primary to fall back on, so reads fail.',
      observed: (m) => {
        const k = replicasUp(m);
        return `Observed: one replica down, ${m.servedPct.toFixed(1)}% still served. Its reads moved to ${k === 0 ? 'the primary' : k === 1 ? 'the other replica' : `the other ${k} replicas`}.`;
      },
    },
    {
      id: 'crash-primary', kind: 'crash', target: (g) => g.onPath('db').find((n) => n.role === 'primary') || null,
      label: 'Crash primary', labelOn: 'Restart old primary',
      needsDesign: 'Build the design first: connect the web servers to the primary database, then crash it.',
      on: 'You pulled the plug on the primary database. Every write now fails.', onTone: 'bad',
      off: 'The old primary is back. If you promoted a replica, it rejoins as a replica and copies from the new primary.',
      expect: served99,
      notMet: (m) => {
        if (primaryUp(m)) return `${m.servedPct.toFixed(1)}% served after the promotion: the replicas left cannot carry the reads. Keep enough replicas that one can become the primary.`;
        if (!replicasUp(m)) return `${m.servedPct.toFixed(0)}% served: the primary is down and no replica can take over. Add a replica first.`;
        return `${m.servedPct.toFixed(0)}% served: the primary is down, so every write fails. Select a replica and press Promote to primary.`;
      },
      issue: 'The primary database is down, so every write fails. Promote a replica to take over.',
      observed: 'Observed: writes failed until you promoted a replica. The new primary took the writes and the other replicas kept serving reads.',
    },
  ],

  // Messages the engine shows for this level's design.
  text: { ...lbText(), ...replicaText(), levelComplete: levelComplete(3) },

  quiz: {
    passScore: 8,
    passText: passText(3, 'Cache tier'),
    failText,
    questions: [
      { q: 'A shopper changes their delivery address. Where does the web server send that update?', o: ['To any replica, picked at random', 'To the primary database', 'To every replica at the same time', 'To the replica with the most capacity'], a: 1, e: 'Every change to the data (insert, update, delete) goes to the primary. The primary then sends it on to each replica. Replicas only serve reads.', r: 'Primary-replica replication' },
      { q: 'Why do most designs run more replicas than primaries?', o: ['Replicas are cheaper machines to run', 'Each replica can accept writes as well', 'Most apps read far more than they write', 'A primary can only feed one replica'], a: 2, e: 'Reads usually outnumber writes by a wide margin: people browse far more than they buy or post. One primary handles the writes, and you add replicas to share the reads.', r: 'Read/write ratio' },
      { q: 'You run three replicas and one of them crashes. What happens to its reads?', o: ['The two healthy replicas take them', 'They fail until the replica is back', 'The primary takes all reads from now on', 'They wait in a queue on the web server'], a: 0, e: 'Reads move to the healthy replicas, which each get a bigger share. You replace the broken replica; the new one copies the data, catches up and starts taking reads.', r: 'When a replica fails' },
      { q: 'Your only replica crashes. Where do reads go until it is replaced?', o: ['Nowhere: reads fail until it is back', 'To a replica of another app', 'To the web server\'s own copy', 'To the primary, for the time being'], a: 3, e: 'With no healthy replica left, the primary serves the reads as well as the writes for a while. Make sure it has room for that, and replace the replica soon.', r: 'When a replica fails' },
      { q: 'The primary fails and you promote a replica. Why might the newest orders be missing?', o: ['Promotion deletes the newest rows', 'The replica was behind the primary', 'Replicas only store reads, not orders', 'The load balancer dropped them'], a: 1, e: 'Replication is usually asynchronous: the primary confirms a write first, then sends it on. Writes it had confirmed but not yet sent never reached the replica, so they have to be recovered from the old primary.', r: 'Promoting a replica' },
      { q: '5,000,000 daily users make 30 requests each, and 1 in 10 is a write. Roughly how many writes per second at peak?', o: ['~35', '~174', '~347', '~3,470'], a: 2, e: '5M × 30 ÷ 86,400 ≈ 1,736 req/s on average, so peak ≈ 3,472 req/s. One in ten is a write: ≈ 347 writes/s. ~174 is the average write rate; ~3,470 is every request at peak.', r: 'Estimating QPS' },
      { q: 'At peak, 1,200 reads/s and 300 writes/s go to a primary with three replicas. How many queries/s does each replica handle?', o: ['400', '500', '1,500', '700'], a: 3, e: 'Each replica serves its share of the reads, 1,200 ÷ 3 = 400, and also applies every write the primary makes, 300. That is 700 queries/s each.', r: 'Replica load' },
      { q: 'The primary is 90% busy with writes. Will adding replicas help?', o: ['No: every write still goes to the primary', 'Yes: the replicas share the writes evenly', 'Yes: each replica takes some of the writes', 'Yes, once the replicas catch up with it'], a: 0, e: 'Replicas take reads, not writes. Every write still goes to the one primary, and each replica has to apply it too. To spread writes you split the data over several primaries: sharding.', r: 'Scaling writes' },
      { q: 'Someone runs a DELETE that wipes the products table by mistake. What do the replicas do?', o: ['Keep the old rows, so you can restore them', 'Delete them too, within about a second', 'Refuse the change and alert the team', 'Wait for an admin to approve the change'], a: 1, e: 'A replica copies every change the primary makes, mistakes included. Replication protects you when a machine fails, not from bad writes. You still need backups.', r: 'Replication is not a backup' },
      { q: 'A fire takes out the server room with the primary. The replicas run in another building. What did replication save?', o: ['Nothing, since the primary was lost', 'Only the reads from the last second', 'The data, apart from the newest writes', 'Every write, even those from the last second'], a: 2, e: 'The replicas hold a copy of the data in another place, so it survives. The exception is the writes the primary had not sent yet. Promote a replica and recover what you can.', r: 'Reliability' },
    ],
  },

  // Lesson tab content (HTML). The diagrams below draw into its figRepl and figPromote.
  lessonHtml: `
    <p class="label">Level 3 · The data tier</p>
    <h1>Database replication</h1>
    <p class="lede">The web tier can grow by adding servers, but every request still ends at one database. It has a size ceiling, and when it stops, the site stops. In this level you add copies of the database that share the reads, then crash a copy and the original to see what replication protects and what it costs.</p>
    <div class="goals-box">
      <div><b>You will learn</b>How a primary and its replicas split writes from reads, and what happens when either fails.</div>
      <div><b>You will decide</b>How many replicas, what size, and when to promote one.</div>
      <div><b>You will estimate</b>Peak writes per second, and the load on each replica.</div>
    </div>

    <section>
      <h2>The last single point of failure</h2>
      <p class="src">Single points of failure</p>
      <p>Level 2 ended with a standby load balancer and spare web servers: any one of them can fail and the site stays up. The database is still one machine. It is already the biggest size, so it cannot grow, and nothing takes over when it fails.</p>
      <p>The fix is to keep copies of the data on several database servers and keep them in step. That is <b>database replication</b>.</p>
    </section>

    <section>
      <h2>A primary and its replicas</h2>
      <p class="src">Primary-replica replication</p>
      <figure class="fig"><svg id="figRepl" viewBox="0 0 640 300" role="img" aria-label="Web servers send writes to the primary database and reads to two replicas. The primary copies every write to both replicas."></svg><figcaption>Writes go to the primary, reads to the replicas, and the primary copies every write to the replicas</figcaption></figure>
      <ul>
        <li>One server is the <b>primary</b>. Every change to the data goes to it: each insert, update and delete.</li>
        <li>The others are <b>replicas</b>. Each gets a copy of every change from the primary and serves reads only.</li>
        <li>The web servers send writes to the primary and spread reads over the replicas.</li>
      </ul>
      <p>Most apps read far more than they write: people browse many pages for each order they place. So one primary usually has several replicas. Older docs call the two roles master and slave; you will also hear leader and follower.</p>
    </section>

    <section>
      <h2>What replication buys you</h2>
      <p class="src">Performance · reliability · availability</p>
      <ul>
        <li><b>Performance.</b> Reads run on several machines in parallel, and the primary spends its time on writes.</li>
        <li><b>Reliability.</b> A fire takes out one server room. Replicas in another building still hold the data.</li>
        <li><b>Availability.</b> When one database goes offline, the others still answer, so the site stays up.</li>
      </ul>
      <div class="note"><b>Replication is not a backup.</b> A replica copies every change, mistakes included. A DELETE run by accident reaches every replica within a second. Backups let you go back in time; replicas do not.</div>
    </section>

    <section>
      <h2>When a replica fails</h2>
      <p class="src">Replica failure</p>
      <p>Its reads move to the healthy replicas, which each take a bigger share. If it was the only replica, the primary serves the reads as well for a while. Either way you replace the broken one: the new replica copies the data, catches up on recent writes and starts taking reads.</p>
      <p>Plan replicas the way you planned web servers: <b>N + 1</b>, so the ones left after a crash can carry every read.</p>
    </section>

    <section>
      <h2>When the primary fails</h2>
      <p class="src">Promoting a replica</p>
      <figure class="fig"><svg id="figPromote" viewBox="0 0 640 260" role="img" aria-label="The old primary is down. A replica has been promoted to be the new primary: web servers send it the writes, and it copies them to the remaining replica, which still serves reads."></svg><figcaption>A replica is promoted to take the old primary's place</figcaption></figure>
      <p>Writes have nowhere to go, so one replica is <b>promoted</b>: it becomes the new primary and takes the writes. The other replicas copy from it, and a new replica replaces the one that was promoted. Keep replicas at least as big as the primary, so any of them can take over.</p>
      <p>The catch is that the promoted replica may be behind. Most setups replicate <b>asynchronously</b>: the primary confirms a write, then sends it on. Writes the old primary confirmed but had not sent yet are missing on the new primary, and have to be recovered from the old one with a recovery script. Some setups wait for one replica to confirm each write: the newest writes are safe on that replica, but every write takes longer.</p>
      <p>Other layouts exist, such as several primaries that all take writes, or a ring where each server copies from the next. They avoid the promotion step but must settle writes that conflict, which is much harder to get right.</p>
    </section>

    <section>
      <h2>Replicas scale reads, not writes</h2>
      <p class="src">Replica load</p>
      <p>Every replica applies every write the primary makes. So each replica's load is its share of the reads <b>plus all the writes</b>. At 1,000 queries/s with 1 in 5 writes, two replicas each handle 800 ÷ 2 = 400 reads plus 200 writes: 600 queries/s. Adding replicas shrinks only the read part.</p>
      <p>Meanwhile the primary still takes every write alone. When writes outgrow one primary, replicas cannot help: you split the data over several primaries, which is sharding (Level 9).</p>
    </section>

    <section>
      <h2>How this level is simulated</h2>
      <p class="src">Game assumptions</p>
      <p>Each request makes one query, a read or a write; the mission says what share writes. A web server sends its writes to the primary and shares its reads evenly over the healthy replicas it is connected to; with none healthy, reads go to the primary. Every replica also applies each write the primary serves. A crashed replica's reads move to the others at once. You promote a replica yourself, in the inspector.</p>
      <p class="assume">Game assumptions: applying a copied write costs a replica as much as running a query. Replicas run 1 second behind the primary, so a promotion after a crash loses about one second of writes. Sending changes to the replicas costs the primary nothing extra. Promotion is instant; real systems usually leave detection and promotion to a failover tool. Server sizes, the network times and the load balancer are the same as in Level 2.</p>
    </section>

    <section>
      <h2>Numbers to carry into the interview</h2>
      <p class="src">Sizing replicas</p>
      <p><b>Load on each replica</b> = reads ÷ replicas + writes.</p>
      <p><b>Replicas you need</b> = reads ÷ (comfortable load − writes), rounded up, plus one spare. For example: 3,000 reads/s and 300 writes/s on servers that handle 1,600 queries/s, kept under 70% (1,120). Each replica has 1,120 − 300 = 820 left for reads, so 3,000 ÷ 820 = 3.7 → 4 replicas, plus a spare: 5. Check: five replicas carry 600 + 300 = 900 each (56%); with one down, 750 + 300 = 1,050 (66%).</p>
    </section>

    <section>
      <h2>How each mission maps to the interview</h2>
      <p class="src">Interview loop · times for a 45-minute interview (formats vary by company)</p>
      <div class="steps4">
        <div><span>Step 1 · 5–8 min</span><b>Scope it</b>Read the brief. Estimate peak writes.</div>
        <div><span>Step 2 · 10–12 min</span><b>Sketch it</b>Primary, replicas, and which query goes where.</div>
        <div><span>Step 3 · 15–20 min</span><b>Go deep</b>Size replicas for reads plus copied writes.</div>
        <div><span>Step 4 · 5 min</span><b>Stress it</b>Crash a replica, then the primary.</div>
      </div>
      <p>When the interviewer says "the database is the bottleneck", first ask whether it is reads or writes. Too many reads: add replicas, or a cache (Level 4). Too many writes: split the data (Level 9).</p>
    </section>
`,

  // Lesson diagrams. `f` provides the engine's drawing helpers.
  drawFigures(f) {
    const { $, svgEl, figNode, figArrow, figDefs } = f;
    const dashedPath = (svg, d) => svgEl('path', { d, class: 'd-line d-dash', fill: 'none', 'marker-end': 'url(#figArr)' }, svg);
    const label = (svg, x, y, text, anchor) => { const t = svgEl('text', { x, y, class: 'd-label', 'text-anchor': anchor || 'start' }, svg); t.textContent = text; };

    const f1 = $('figRepl'); f1.textContent = ''; figDefs(f1);
    figNode(f1, 'web', 320, 46, 'Web servers', 'Private IPs');
    figNode(f1, 'db', 104, 196, 'Primary DB', 'Every write');
    figNode(f1, 'db', 320, 196, 'Read replica', 'Reads');
    figNode(f1, 'db', 536, 196, 'Read replica', 'Reads');
    figArrow(f1, 260, 76, 150, 166, 'writes', null, 192, 116, 'end');
    figArrow(f1, 320, 76, 320, 166, 'reads', null, 330, 126);
    figArrow(f1, 380, 76, 490, 166, 'reads', null, 448, 116);
    dashedPath(f1, 'M104 226 V262 H536 V230');
    dashedPath(f1, 'M320 262 V230');
    label(f1, 212, 284, 'copies every write', 'middle');

    const f2 = $('figPromote'); f2.textContent = ''; figDefs(f2);
    figNode(f2, 'web', 104, 130, 'Web servers', 'Private IPs');
    figNode(f2, 'db', 330, 50, 'Old primary', 'Down · writes lost');
    figNode(f2, 'db', 330, 205, 'New primary', 'Was a replica');
    figNode(f2, 'db', 536, 130, 'Read replica', 'Copies new primary');
    figArrow(f2, 160, 160, 250, 190, 'writes', null, 196, 196, 'end');
    figArrow(f2, 198, 130, 442, 130, 'reads', null, 300, 122, 'middle');
    dashedPath(f2, 'M424 205 H536 V164');
    label(f2, 470, 226, 'copies', 'middle');
  },
};
