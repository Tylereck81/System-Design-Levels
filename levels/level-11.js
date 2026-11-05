// Level 11: Consistent hashing.
// Everything specific to this level lives here: components, rules, missions, quiz and text.
import { fmt } from '../js/format.js';
import { servedGoal, latGoal, costGoal, servedAtLeast, fmtPct } from './shared/goals.js';
import { serverNames, ringPoints, keyHome } from '../js/engine/hashring.js';
import { dns, lb, NO_DB_NOTE, autoscaleSubOf, scalingChoices, db } from './shared/components.js';
import { dnsLookup, usersToLb, lbToWeb, webToDb, lbBad } from './shared/connections.js';
import { lbText, levelComplete } from './shared/text.js';
import { failText, passText } from './shared/quiz.js';
import { dayTraffic } from './shared/workload.js';

const targets = { latencyMs: 150, servedPct: 99 };
const PCT = { scale: 100 }; // percentages are given as 0–1 shares
const BUDGET = 1400;
const SALE_BUDGET = 1700;
const MOVE_MAX = 0.25;
const SPREAD_MAX = 0.1;

const even = (m) => m.ringSpread != null && m.ringSpread <= SPREAD_MAX + 1e-9;
const spreadGoal = {
  id: 'spread', type: 'metric', text: `Busiest cache server at most ${Math.round(SPREAD_MAX * 100)}% above the average`, test: even,
  val: (m) => (m.ringSpread == null ? '—' : '+' + fmtPct(m.ringSpread, PCT)),
};
const served99 = servedAtLeast(targets.servedPct);
const fewMoved = (m) => m.ringMoved != null && m.ringMoved <= MOVE_MAX + 1e-9;
const hashShort = { mod: 'hash % N', ring: 'ring', v10: 'ring · 10 vnodes', v100: 'ring · 100 vnodes', v500: 'ring · 500 vnodes' };
const dbOver = (m) => { const st = Object.values(m.node).find((s) => s.unit === 'queries/s'); return st ? st.load : 0; };

export default {
  id: 11,
  saveKey: 'sdl-level11-v1',
  saveVersion: 1,
  targets,
  // The day's traffic curve (for the autoscaled web servers), and the profiles the cache cluster holds.
  workload: { day: dayTraffic(), catalogGB: 40, readGapSecs: 60, cacheTtlSecs: 3600 },

  components: {
    users: {
      name: 'Users', sub: 'Open profiles',
      desc: 'People opening profiles in a social app. Every page reads one profile by its key, such as user:17. 5% of the requests are profile edits, which write the database.',
    },
    dns: dns(),
    lb: lb(),
    web: {
      name: 'Web server', short: 'Your back-end code',
      desc: 'Runs your back-end code. For each profile it asks the cache cluster first; on a miss it reads the database and stores the profile in the cache. These are autoscaled groups of L servers, as in Level 6.',
      noDbNote: NO_DB_NOTE,
      subOf: autoscaleSubOf,
      choices: scalingChoices(),
    },
    db: { ...db(), desc: 'The database with every profile. It is the slowest part, so it should only see what the cache misses, plus the edits.' },
    ring: {
      name: 'Cache cluster', short: 'Profiles in memory',
      desc: 'Cache servers A, B, C… that keep the profiles in memory, read cache-aside as in Level 4. The hashing decides which server holds each key. When a server joins or leaves, every key that moves misses once. 10,000 lookups/s per server in this game.',
      sizeLabel: 'Memory per server (scale up)',
      subOf: (n, size) => `${n.count || 5} × ${size.mem} GB · ${hashShort[n.hashing] || hashShort.mod}`,
      choices: [
        {
          key: 'count', label: 'Cache servers',
          options: [3, 5, 6, 8, 10].map((k) => ({ id: String(k), name: `${k} servers`, sub: serverNames(k).join(' '), note: `${k} cache servers, named ${serverNames(k)[0]} to ${serverNames(k).at(-1)}. Memory and cost add up; each server holds its share of the keys.`, log: `Cache cluster set to ${k} servers.` })),
        },
        {
          key: 'hashing', label: 'Hashing',
          options: [
            { id: 'mod', name: 'hash % N', sub: 'server = hash(key) % N', note: 'The key\'s hash modulo the number of servers picks the server. Even while N stays the same; when N changes, most keys get a new server.', log: 'Cache cluster set to hash % N.' },
            { id: 'ring', name: 'Hash ring', sub: '1 point per server', note: 'Servers and keys are hashed onto a ring. A key is stored on the first server clockwise from it. A change moves only the keys next to that server, but with one point each the servers own arcs of very different sizes.', log: 'Cache cluster set to a hash ring with one point per server.' },
            { id: 'v10', name: 'Ring, 10 virtual nodes', sub: '10 points per server', note: 'Each server is placed on the ring 10 times. Its keys are spread over 10 arcs, so the shares even out, but not yet within 10%.', log: 'Cache cluster set to a hash ring with 10 virtual nodes per server.' },
            { id: 'v100', name: 'Ring, 100 virtual nodes', sub: '100 points per server', note: 'Each server has 100 points. Shares vary by about 10% (one standard deviation), so with few servers the busiest can still be well above average.', log: 'Cache cluster set to a hash ring with 100 virtual nodes per server.' },
            { id: 'v500', name: 'Ring, 500 virtual nodes', sub: '500 points per server', note: 'Each server has 500 points: shares vary by about 4–5%. The ring table is bigger (500 entries per server), still small enough for every web server to keep in memory.', log: 'Cache cluster set to a hash ring with 500 virtual nodes per server.' },
          ],
        },
      ],
    },
  },
  palette: ['dns', 'lb', 'web', 'db', 'ring'],
  limits: { dns: 1, lb: 1, web: 2, db: 1, ring: 1 },
  limitMsg: {
    dns: 'You only need one DNS service.',
    lb: 'One load balancer is enough in this level.',
    web: 'Two autoscaled groups of web servers are enough: they grow on their own.',
    db: 'One database is enough here: the cache cluster takes the reads.',
    ring: 'One cache cluster is enough: choose how many servers it runs in the inspector.',
  },
  // One data center: autoscaled web servers, five cache servers placed by hash % 5, and one database.
  startNodes: [
    { id: 'u', type: 'users', x: 380, y: 60 },
    { id: 'd', type: 'dns', x: 120, y: 60 },
    { id: 'l', type: 'lb', x: 380, y: 168, algo: 'rr' },
    { id: 'w1', type: 'web', x: 250, y: 276, size: 'L', scaling: 'auto' },
    { id: 'w2', type: 'web', x: 510, y: 276, size: 'L', scaling: 'auto' },
    { id: 'k', type: 'ring', x: 250, y: 420, size: 'L', count: '5', hashing: 'mod' },
    { id: 'b', type: 'db', x: 510, y: 420, size: 'L', kind: 'sql' },
  ],
  startEdges: [
    { id: 's1', from: 'u', to: 'd' }, { id: 's2', from: 'u', to: 'l' },
    { id: 's3', from: 'l', to: 'w1' }, { id: 's4', from: 'l', to: 'w2' },
    { id: 's5', from: 'w1', to: 'k' }, { id: 's6', from: 'w2', to: 'k' },
    { id: 's7', from: 'w1', to: 'b' }, { id: 's8', from: 'w2', to: 'b' },
  ],
  slots: {
    dns: { x: 120, y: 60 }, lb: { x: 380, y: 168 }, web: { x: 510, y: 276 }, ring: { x: 250, y: 420 }, db: { x: 510, y: 420 },
  },

  connections: {
    ok: {
      'dns|users': dnsLookup(),
      'lb|users': usersToLb(),
      'lb|web': lbToWeb(),
      'db|web': webToDb(),
      'ring|web': { from: 'web', to: 'ring', label: 'lookups', desc: 'For each profile the web server hashes its key, finds the cache server that holds it, and asks that one. On a miss it reads the database and stores the profile there.' },
    },
    bad: {
      ...lbBad(),
      'db|ring': 'In cache-aside the cache never talks to the database: the web server reads the database on a miss. Connect each web server to the cache cluster and to the database.',
      'ring|users': 'Users never reach the cache. Their requests go through the load balancer to a web server, which asks the cache cluster.',
      'lb|ring': 'The load balancer spreads requests over web servers. The web servers ask the cache cluster.',
      'dns|ring': 'The cache cluster does not need DNS. Connect the web servers to it.',
    },
  },

  missions: [
    {
      title: 'Server C fails', ref: 'The rehashing problem', qps: 2000, writes: 0.05, budget: BUDGET,
      gate: {
        hidesTraffic: false,
        lo: 79, hi: 81,
        prompt: '<b>Estimate before you build.</b> Five cache servers, A to E, hold the profiles by hash(key) % 5. Server C fails, so the web servers switch to % 4 over A, B, D and E. What percentage of all keys are now looked up on a different server than before?',
        label: 'Keys that move (%)',
        placeholder: 'e.g. 50',
        acceptedHtml: '<p><b>Estimate accepted.</b></p><div class="calc">A key keeps its server only if hash % 5 and hash % 4 still pick the same one<br>Of every 20 hash values in a row, 4 do<br>20% stay, so 80% of the keys move: four times C\'s own fifth</div>',
        acceptedLog: 'Estimate accepted: 80% of the keys move. Play is unlocked.',
        notNumber: 'Type the estimate as a percentage, for example 50.',
        hints: [
          { test: (v) => v > 0.7 && v < 0.9, text: 'Type it as a percentage: 0.8 is 80.' },
          { test: (v) => v >= 19 && v <= 21, text: 'That is C\'s own keys. But % 4 gives most of the other keys a new server too.' },
          { test: (v) => v >= 24 && v <= 26, text: 'Not a quarter. A key stays only when hash % 5 and hash % 4 agree on its server; count that over 20 hash values in a row.' },
          { test: (v) => v >= 95, text: 'Not all of them: some hash values give the same server under % 5 and % 4.' },
        ],
        fallback: 'Not quite. Take 20 hash values in a row (0 to 19), and count those where % 5 and % 4 pick the same server.',
      },
      story: 'Profiles are cached on five servers, picked by hash(key) % 5. Server C is about to fail. With % 4, most keys (4 in 5) get a new server, which doesn\'t hold them yet: the database gets most reads at once. Place keys so that losing C moves only C\'s keys.',
      goals: [
        { id: 'est', type: 'gate', text: 'Estimate the keys that move when C fails' },
        servedGoal(targets), latGoal(targets), costGoal(BUDGET),
        { id: 'lose-c', type: 'exp', text: `Break it: server C fails; at most ${Math.round(MOVE_MAX * 100)}% of keys move` },
      ],
      hint: 'Select the cache cluster and set Hashing to a hash ring. On a ring a key goes to the first server clockwise, so when C leaves, only C\'s keys move: to the next server.',
      takeaway: 'Only C\'s keys moved, and the database carried their misses. With hash % N most keys move when N changes: (N − 1) / N of them. On a ring, only the keys of the server that left. But C\'s arc was small: with one point per server, E owns 61% of the ring, so had E failed, 61% of the keys would have moved, all to one server. Mission 2 fixes that.',
    },
    {
      title: 'One more server for the sale', ref: 'Virtual nodes', qps: 2000, writes: 0.05, budget: BUDGET,
      story: 'A sale is coming, and you add a cache server. On a ring with one point per server, the servers own arcs of very different sizes: one holds far more profiles than its memory fits, while another sits half empty. Keep every server within 10% of the average, before and after the new one joins.',
      goals: [
        servedGoal(targets), latGoal(targets), spreadGoal, costGoal(BUDGET),
        { id: 'add-server', type: 'exp', text: `Break it: add a server; at most ${Math.round(MOVE_MAX * 100)}% of keys move, and the spread stays within ${Math.round(SPREAD_MAX * 100)}%` },
      ],
      hint: 'Give each server many points on the ring: virtual nodes. Ten even out the shares a little; with 100, five servers still differ by about 16% here. Try 500.',
      takeaway: 'Each server now owns hundreds of small arcs, so the shares even out, and a new server takes a little from every other one. More virtual nodes cost only a bigger ring table in each web server\'s memory.',
    },
    {
      title: 'The sale doubles the reads', ref: 'k/n keys move', qps: 4000, writes: 0.05, budget: SALE_BUDGET,
      story: 'The sale doubles the traffic: 4,000 requests a second, of which 3,800 read a profile. If server C fails now, its fifth of the keys misses all at once: 3,800 × 98% hits × 1/5 ≈ 745 more reads a second, on top of the 270 the database already gets, and the four servers left hold only 32 GB of the 40, so they miss more too: over 1,000 reads a second. It takes 800. The budget allows no more cache memory than 5 L servers have: 40 GB.',
      goals: [
        servedGoal(targets), latGoal(targets), spreadGoal, costGoal(SALE_BUDGET),
        { id: 'lose-c', type: 'exp', text: 'Break it: server C fails during the sale; at least 99% served' },
      ],
      hint: 'A server that fails moves 1/N of the keys. Same memory, same price: 10 M servers (4 GB each) instead of 5 L (8 GB each). Keep 500 virtual nodes so the spread stays within 10%.',
      takeaway: 'Ten smaller servers hold the same 40 GB for the same price, and losing one moves a tenth of the keys instead of a fifth. On a ring, k/n keys move: more servers, smaller storms.',
    },
  ],

  // Break-it experiments. An event only checks its outcome; `resize` adds or removes a cache server while it runs.
  experiments: [
    {
      id: 'lose-c', kind: 'event', resize: -1,
      label: 'Server C fails', labelOn: 'Bring C back',
      needsDesign: 'Build the design first: the web servers need the cache cluster and the database.',
      on: 'Cache server C is down. Every key whose server changed misses until it is read from the database again.', onTone: 'bad',
      off: 'Server C is back, and the keys return to it.',
      expect: (m) => served99(m) && fewMoved(m),
      notMet: (m) => (m.ringMoved != null && !fewMoved(m)
        ? `${fmtPct(m.ringMoved, PCT)} of the keys moved to another server, not just C's fifth. Each of those reads misses and goes to the database: ${fmt(dbOver(m))} queries a second. Set the hashing to a hash ring.`
        : `Only ${m.servedPct.toFixed(1)}% served: the database gets ${fmt(dbOver(m))} queries a second, the misses of the moved keys on top of its normal load. Losing a server moves 1/N of the keys: use more, smaller cache servers.`),
      observed: (m) => `Observed: server C failed, and only ${fmtPct(m.ringMoved, PCT)} of the keys moved. The database carried their misses.`,
    },
    {
      id: 'add-server', kind: 'event', resize: 1,
      label: 'Add a server', labelOn: 'Remove it again',
      needsDesign: 'Build the design first: the web servers need the cache cluster and the database.',
      on: 'A new cache server joins the cluster. Keys it takes over miss once, until they are read from the database.', onTone: '',
      off: 'The new server is removed again.',
      expect: (m) => served99(m) && fewMoved(m) && even(m),
      notMet: (m) => (!fewMoved(m)
        ? `${fmtPct(m.ringMoved, PCT)} of the keys moved to another server. With hash % N most keys move; on a ring, only those the new server takes.`
        : !even(m)
          ? `The busiest cache server holds ${fmtPct(m.ringSpread, PCT)} more keys than the average. Give each server more virtual nodes.`
          : `Only ${m.servedPct.toFixed(1)}% served: the database can't carry the misses.`),
      observed: (m) => `Observed: the new server took ${fmtPct(m.ringMoved, PCT)} of the keys, a little from every other server, and the busiest is ${fmtPct(m.ringSpread, PCT)} above the average.`,
    },
  ],

  // Messages the engine shows for this level's design.
  text: {
    ...lbText(),
    levelComplete: levelComplete(11),
  },

  quiz: {
    passScore: 8,
    passText: passText(11, 'Distributed key-value store'),
    failText,
    questions: [
      { q: 'Six cache servers use hash(key) % 6. One fails and the cluster switches to % 5. Roughly what share of keys get a new server?', o: ['About 1/6', 'About 5/6', 'About 1/5', 'All of them'], a: 1, e: 'A key keeps its server only when % 6 and % 5 still pick the same one: 5 of every 30 hash values in a row, 1 in 6. So 5/6 of the keys move, not just the failed server\'s sixth. Their new servers don\'t hold them yet, so they all miss at once: a cache-miss storm.', r: 'The rehashing problem' },
      { q: 'On a hash ring, which server stores a key?', o: ['The next server clockwise', 'The server with the closest number', 'The server named by hash % N', 'A random server, chosen on every read'], a: 0, e: 'Servers and keys are hashed onto the same ring. From the key\'s position, go clockwise until you reach a server: that one stores it.', r: 'The hash ring' },
      { q: 'A ring holds k keys on n servers. About how many keys move when one server is added?', o: ['k', 'k / 2', 'k / n', 'n'], a: 2, e: 'The new server takes over one range of the ring, about 1/n of the keys. Every other key keeps its server.', r: 'The hash ring' },
      { q: 'Server S is added to a ring. Which keys move to it?', o: ['Keys between S and the next server clockwise', 'Every key with an even hash', 'Keys spread evenly over all servers', 'From S back to the previous server'], a: 3, e: 'S now comes first clockwise for the keys between the previous server and S. Going anticlockwise from S to the previous server gives that range; those keys used to belong to the server after S.', r: 'The hash ring' },
      { q: 'Why do virtual nodes help?', o: ['A server\'s share sums many small arcs', 'They copy every key to two servers', 'They make each lookup faster than hash % N', 'They stop servers from failing'], a: 0, e: 'With one point each, arcs vary a lot in size. With many points per server, each server\'s share is the sum of many small arcs, which averages out.', r: 'Virtual nodes' },
      { q: 'With 100 virtual nodes per server, the shares vary by about 10%. About how much with 400?', o: ['About 2.5%', 'About 5%', 'About 10%', 'About 1%'], a: 1, e: 'The spread falls with the square root of the number of virtual nodes: 1 ÷ √100 = 10%, 1 ÷ √400 = 5%. Four times the nodes halves it.', r: 'Virtual nodes' },
      { q: 'What does a cluster pay for more virtual nodes?', o: ['More memory for every cached key', 'A higher miss rate on every read', 'Slower network between servers', 'A bigger ring table'], a: 3, e: 'Every client keeps the ring\'s points. More virtual nodes means more entries to store and search, and more ranges to track when servers change. The data itself is the same.', r: 'Virtual nodes' },
      { q: 'Three creator accounts, each with 50 million followers, are read all the time. What does consistent hashing do for them?', o: ['It puts each one on its own server', 'It splits each account over all servers', 'Little: one key, one server', 'It moves them to the database'], a: 2, e: 'Consistent hashing spreads many keys evenly, so hot keys are less likely to pile up on one server. But a single hot key still lives on one server. To spread its reads, keep copies on several servers or in each web server\'s memory.', r: 'Hot keys' },
      { q: 'You keep the cost and memory of 4 large cache servers but use 8 of half the size. Why can that be better?', o: ['A failure moves 1/8 of keys', 'Each lookup gets answered faster', 'They hold more keys in memory', 'They need no virtual nodes'], a: 0, e: 'On a ring, a failed server\'s keys move: k/n of them. With 8 servers that is an eighth, so the miss storm on the database is half as big.', r: 'Numbers to carry into the interview' },
      { q: 'A cluster answers 9,000 reads/s with 95% hits. One of 6 servers fails. About how many more reads/s reach the database right after?', o: ['About 9,000', 'About 1,425', 'About 450', 'About 7,125'], a: 1, e: 'Its sixth of the keys now misses: 9,000 × 95% × 1/6 ≈ 1,425 more reads a second, until those keys are cached again.', r: 'Numbers to carry into the interview' },
    ],
  },

  // Lesson tab content (HTML). The diagrams below draw into figRing and figAdd.
  lessonHtml: `
    <p class="label">Level 11 · Consistent hashing</p>
    <h1>Consistent hashing</h1>
    <p class="lede">Your social app keeps its profiles on a cluster of cache servers. In this level a server fails, a server joins, and the traffic doubles. You pick how keys are placed, so that each change moves as few of them as possible and every server carries a fair share.</p>
    <div class="goals-box">
      <div><b>You will learn</b>Why hash % N breaks when servers change, the hash ring, and virtual nodes.</div>
      <div><b>You will decide</b>The hashing, the number of servers, and their size.</div>
      <div><b>You will estimate</b>How many keys move, and how many reads hit the database.</div>
    </div>

    <section>
      <h2>The rehashing problem</h2>
      <p class="src">hash % N</p>
      <p>To spread keys over N cache servers, a common first idea is <code>server = hash(key) % N</code>. With five servers, A to E, that is <code>% 5</code>. It is even, and it works as long as N never changes.</p>
      <p>Now server C fails, and the web servers switch to <code>% 4</code> over A, B, D and E. The hash of each key is the same, but the remainder is not:</p>
      <div class="tbl-wrap"><table class="t">
        <thead><tr><th>Key</th><th>hash % 5</th><th>hash % 4</th><th>Server</th></tr></thead>
        <tbody>
          <tr><td><code>user:17</code></td><td class="n">4 → E</td><td class="n">3 → E</td><td>stays</td></tr>
          <tr><td><code>user:204</code></td><td class="n">0 → A</td><td class="n">2 → D</td><td>moves</td></tr>
          <tr><td><code>user:3311</code></td><td class="n">3 → D</td><td class="n">1 → B</td><td>moves</td></tr>
          <tr><td><code>user:58</code></td><td class="n">3 → D</td><td class="n">0 → A</td><td>moves</td></tr>
          <tr><td><code>user:902</code></td><td class="n">0 → A</td><td class="n">1 → B</td><td>moves</td></tr>
          <tr><td><code>user:76</code></td><td class="n">2 → C</td><td class="n">1 → B</td><td>moves</td></tr>
        </tbody>
      </table></div>
      <p>Most keys move, not just C's. Over all keys, 80% get a new server. The new server doesn't hold them yet, so their reads miss and go to the database at once: a <b>cache-miss storm</b>.</p>
    </section>

    <section>
      <h2>The hash ring</h2>
      <p class="src">Consistent hashing</p>
      <p>Consistent hashing changes as few keys as possible when servers change: on average only <b>k / n</b> of them, for k keys and n servers. Take the output range of a hash function, here 0 to 2<sup>32</sup> − 1, and join its two ends into a ring. Hash each server's name onto the ring, and each key too. A key is stored on the <b>first server clockwise</b> from it.</p>
      <figure class="fig"><svg id="figRing" viewBox="0 0 660 300" role="img" aria-label="A hash ring with servers A, B, C and D. Keys user:17, user:4410, user:204, user:3311 and user:58 each go clockwise to the next server: A, B, D, C and C."></svg><figcaption>Each key goes clockwise to the next server. Real positions from the game's hash</figcaption></figure>
      <p><b>Remove a server</b> and only its keys move, to the next server clockwise. <b>Add a server</b> and it takes the keys between it and the previous server: start at the new server and go anticlockwise until you reach another one. That is the affected range; every other key stays.</p>
      <figure class="fig"><svg id="figAdd" viewBox="0 0 660 300" role="img" aria-label="Server E joins the ring between D and C. The keys between D and E, such as user:3311 and user:58, move from C to E. All other keys stay."></svg><figcaption>E joins: only the keys from D to E move, all from C</figcaption></figure>
    </section>

    <section>
      <h2>Virtual nodes</h2>
      <p class="src">Two problems, one fix</p>
      <p>With one point per server, two things go wrong. The arcs between servers can be very different in size: on the ring above, C owns 71% of it and D only 6%. And when a server leaves, its whole arc goes to one neighbour, which can double that neighbour's share.</p>
      <p>The fix is <b>virtual nodes</b>: place each server on the ring many times, as <code>A#0</code>, <code>A#1</code>, and so on. A server's share is then the sum of many small arcs, which averages out. The spread falls with the square root of the count: with 100 virtual nodes per server, shares vary by about 10% (one standard deviation); with 200, about 7%. When a server leaves, each of its arcs goes to a different neighbour, so its keys spread over all the others.</p>
      <p>The cost is a bigger ring table: every client stores and searches all the points, and there are more ranges to track when servers change. Pick the count that makes the spread small enough.</p>
    </section>

    <section>
      <h2>Hot keys</h2>
      <p class="src">What it doesn't fix</p>
      <p>Consistent hashing spreads many keys evenly, so busy keys are less likely to pile up on one server. But each key still lives on one server. Three creator accounts with 50 million followers each are read all day; whichever server holds one of them gets all its reads. Spread those differently: keep copies of hot keys on several servers, or in each web server's own memory.</p>
      <p>Consistent hashing is used wherever data or requests are partitioned over servers that come and go: partitioned databases, distributed caches, content delivery networks and load balancers.</p>
    </section>

    <section>
      <h2>How this level is simulated</h2>
      <p class="src">Game assumptions</p>
      <p>Every page reads one profile from a 40 GB catalog; popular profiles follow the 80/20 rule, as in Level 4. Each cache server keeps as much of its own share of the keys as its memory holds, the most read first, so a server with a bigger share answers fewer of its reads. Profiles stay cached for an hour. Right after a server joins or leaves, every key whose server changed misses once; the Break-it tests measure those first seconds.</p>
      <p class="assume">Game assumptions: servers and keys are placed with a 32-bit hash (MurmurHash3) of their names, such as <code>cache-A</code> and <code>cache-A#7</code>. Shares and moved keys are measured on the ring, not estimated. A cache server handles 10,000 lookups a second; a server that fails is server C. The web servers are autoscaled groups.</p>
    </section>

    <section>
      <h2>Numbers to carry into the interview</h2>
      <p class="src">Capacity estimates</p>
      <p><b>Keys that move</b> when n servers become n − 1: with hash % n, most of them ((n − 1) / n); on a ring, 1 / n.</p>
      <p><b>The miss storm</b> = reads × hit rate × share of keys moved. 3,800 × 98% × 1/5 ≈ 745 extra reads a second.</p>
      <p><b>The spread</b> with v virtual nodes per server: about 1 ÷ √v. 100 → 10%.</p>
    </section>

    <section>
      <h2>How each mission maps to the interview</h2>
      <p class="src">Interview loop · times for a 45-minute interview (formats vary by company)</p>
      <div class="steps4">
        <div><span>Step 1 · 5–8 min</span><b>Scope it</b>How many keys, how many servers, and how often do servers change?</div>
        <div><span>Step 2 · 10–12 min</span><b>Sketch it</b>Clients hash keys onto a ring of cache servers.</div>
        <div><span>Step 3 · 15–20 min</span><b>Go deep</b>Clockwise lookup, virtual nodes, the affected range.</div>
        <div><span>Step 4 · 5 min</span><b>Stress it</b>A server fails or joins: how many keys move, and can the database take the misses?</div>
      </div>
      <p>Consistent hashing is rarely the whole question. It comes up inside a bigger design, such as a distributed cache or key-value store, the moment you say "partition the data".</p>
    </section>
`,

  // Lesson diagrams: two rings drawn from the game's own hash. `f` provides the engine's drawing helpers.
  drawFigures(f) {
    const { $, svgEl } = f;
    const keys = ['user:17', 'user:4410', 'user:204', 'user:3311', 'user:58'];
    const ring = (svg, names, added) => {
      svg.textContent = '';
      const cx = 170, cy = 150, R = 105, method = { vnodes: 1 }, before = added ? names.filter((s) => s !== added) : null;
      const at = (p, r) => { const a = 2 * Math.PI * p - Math.PI / 2; return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; };
      svgEl('circle', { cx, cy, r: R, class: 'd-line' }, svg);
      if (added) {
        // The affected range: anticlockwise from the new server to the one before it.
        const pts = ringPoints(names, 1).map(([p, s]) => [p / 2 ** 32, s]), i = pts.findIndex(([, s]) => s === added);
        const to = pts[i][0], from = pts[(i + pts.length - 1) % pts.length][0];
        const [x1, y1] = at(from, R), [x2, y2] = at(to, R), large = ((to - from + 1) % 1) > 0.5 ? 1 : 0;
        svgEl('path', { d: `M ${x1} ${y1} A ${R} ${R} 0 ${large} 1 ${x2} ${y2}`, class: 'd-arc' }, svg);
      }
      for (const [p, s] of ringPoints(names, 1)) {
        const [x, y] = at(p / 2 ** 32, R), [lx, ly] = at(p / 2 ** 32, R + 20);
        svgEl('rect', { x: x - 7, y: y - 7, width: 14, height: 14, rx: 2, class: s === added ? 'd-step' : 'ic-data' }, svg);
        const t = svgEl('text', { x: lx, y: ly + 4, class: 'd-label', 'text-anchor': 'middle' }, svg); t.textContent = s;
      }
      keys.forEach((k, i) => {
        const home = keyHome(k, names, method), [x, y] = at(home.pos, R), [lx, ly] = at(home.pos, R - 17);
        svgEl('circle', { cx: x, cy: y, r: 4, class: 'ch-pt' }, svg);
        const n = svgEl('text', { x: lx, y: ly + 4, class: 'd-label', 'text-anchor': 'middle' }, svg); n.textContent = i + 1;
        const was = before ? keyHome(k, before, method).server : home.server;
        const t = svgEl('text', { x: 360, y: 82 + i * 34, class: 'd-label' }, svg);
        t.textContent = `${i + 1}  ${k} → ${home.server}${was !== home.server ? ` (was ${was})` : ''}`;
      });
    };
    ring($('figRing'), serverNames(4));
    ring($('figAdd'), serverNames(5), 'E');
  },
};
