// @ts-check
/** @import { Level, Goal } from '../js/types.js' */
// Level 12: Distributed key-value store.
// Everything specific to this level lives here: components, rules, missions, quiz and text.
import { servedGoal, latGoal, costGoal, servedAtLeast, fmtPct } from './shared/goals.js';
import { dns, lb, NO_DB_NOTE, autoscaleSubOf, scalingChoices } from './shared/components.js';
import { dnsLookup, usersToLb, lbToWeb, lbBad } from './shared/connections.js';
import { lbText, levelComplete } from './shared/text.js';
import { failText, passText } from './shared/quiz.js';
import { dayTraffic } from './shared/workload.js';

const targets = { latencyMs: 150, servedPct: 99 };
const BUDGET = 1600;

// The store's setting as the canvas shows it (saved settings are checked on load, so these are valid options).
const quorumOf = (n) => { const N = Number(n.n) || 3; return { N, W: Math.min(N, Number(n.w) || 1), R: Math.min(N, Number(n.r) || 1), sloppy: n.mode === 'sloppy' }; };
/** @type {Goal} */
const replicasGoal = { id: 'replicas', type: 'metric', text: 'Every key kept on at least 3 replicas', test: (m) => !!m.kvQuorum && m.kvQuorum.N >= 3, val: (m) => (m.kvQuorum ? `N = ${m.kvQuorum.N}` : '—') };
const fresh = (m) => m.kvStalePct != null && m.kvStalePct < 1e-9;
/** @type {Goal} */
const freshGoal = { id: 'fresh', type: 'metric', text: 'No read returns an old seat map', test: fresh, val: (m) => (m.kvStalePct == null ? '—' : fmtPct(m.kvStalePct)) };
/** @type {Goal} */
const writeGoal = { id: 'durable', type: 'metric', text: 'Each cart change confirmed by at least 2 replicas', test: (m) => !!m.kvQuorum && m.kvQuorum.W >= 2, val: (m) => (m.kvQuorum ? `W = ${m.kvQuorum.W}` : '—') };
/** @type {Goal} */
const fastGoal = { id: 'fastread', type: 'metric', text: 'Seat reads answered by the store in 2 ms', test: (m) => m.kvReadMs != null && m.kvReadMs <= 2, val: (m) => (m.kvReadMs == null ? '—' : m.kvReadMs + ' ms') };
const served99 = servedAtLeast(targets.servedPct);
const CART = 1; // the mission that keeps answering through the partition; the others must never be stale

/** @type {Level} */
export default {
  id: 12,
  saveKey: 'sdl-level12-v1',
  saveVersion: 1,
  targets,
  // The day's traffic curve (for the autoscaled web servers). recentShare: reads whose key was written so recently that
  // the write is still spreading. partitionFar: the users cut off with floor(N / 3) of each key's replicas in a network partition.
  workload: { day: dayTraffic(), recentShare: 0.2, partitionFar: 0.3 },

  components: {
    users: {
      name: 'Users', sub: 'Pick seats, fill carts',
      desc: 'Travellers on an airline\'s site. They open seat maps, pick seats and fill shopping carts. Every page reads or writes one key in the key-value store, such as seats:FL204 or cart:8812.',
    },
    dns: dns(),
    lb: lb(),
    web: {
      name: 'Web server', short: 'Your back-end code',
      desc: 'Runs your back-end code. For each page it calls get(key) or put(key, value) on the key-value store. These are autoscaled groups of L servers, as in Level 6.',
      noDbNote: NO_DB_NOTE,
      subOf: autoscaleSubOf,
      choices: scalingChoices(),
    },
    kv: {
      name: 'Key-value store', short: 'Replicated, by key',
      desc: 'Nodes on a hash ring, as in Level 11. Each key is copied to N replicas: the first N different nodes clockwise. Any node can be the coordinator: it sends a request to the N replicas and answers once W (a write) or R (a read) have replied. $150 a month per replica in this game.',
      subOf: (n) => { const q = quorumOf(n); return `N ${q.N} · W ${q.W} · R ${q.R} · ${q.sloppy ? 'sloppy' : 'strict'}`; },
      choices: [
        {
          key: 'n', label: 'Replicas (N)',
          options: [
            { id: '1', name: 'N = 1', sub: 'one copy', note: 'One copy of each key: always consistent, but lost if its node is lost.', log: 'Key-value store set to 1 replica.' },
            { id: '3', name: 'N = 3', sub: 'three copies', note: 'Three copies on three different nodes: the usual choice.', log: 'Key-value store set to 3 replicas.' },
            { id: '5', name: 'N = 5', sub: 'five copies', note: 'Five copies: survives more failures, costs more, and a full quorum waits for slower replicas.', log: 'Key-value store set to 5 replicas.' },
          ],
        },
        {
          key: 'w', label: 'Write quorum (W)',
          options: [1, 2, 3, 4, 5].map((k) => ({ id: String(k), name: `W = ${k}`, sub: `${k} ${k === 1 ? 'reply' : 'replies'}`, note: `A write succeeds once ${k} ${k === 1 ? 'replica has' : 'replicas have'} stored it; the others get it a little later. At most N.`, log: `Write quorum set to ${k}.` })),
        },
        {
          key: 'r', label: 'Read quorum (R)',
          options: [1, 2, 3, 4, 5].map((k) => ({ id: String(k), name: `R = ${k}`, sub: `${k} ${k === 1 ? 'reply' : 'replies'}`, note: `A read waits for ${k} ${k === 1 ? 'replica' : 'replicas'} and returns the newest value among them. At most N.`, log: `Read quorum set to ${k}.` })),
        },
        {
          key: 'mode', label: 'When replicas can\'t be reached',
          options: [
            { id: 'strict', name: 'Strict quorum', sub: 'fail without W or R', note: 'A request that can\'t reach W (or R) of its own replicas fails. Consistent, but unavailable on the cut-off side.', log: 'Key-value store set to a strict quorum.' },
            { id: 'sloppy', name: 'Sloppy quorum', sub: 'other nodes stand in', note: 'Healthy nodes stand in for unreachable replicas and keep the data with a hint; when the replica is back, they hand it over (hinted handoff). Always available, but a read can miss writes made on the other side.', log: 'Key-value store set to a sloppy quorum with hinted handoff.' },
          ],
        },
      ],
    },
  },
  palette: ['dns', 'lb', 'web', 'kv'],
  limits: { dns: 1, lb: 1, web: 2, kv: 1 },
  limitMsg: {
    dns: 'You only need one DNS service.',
    lb: 'One load balancer is enough in this level.',
    web: 'Two autoscaled groups of web servers are enough: they grow on their own.',
    kv: 'One key-value store is enough: choose its replicas and quorums in the inspector.',
  },
  // One data center: autoscaled web servers and a key-value store with 3 replicas, W = 1, R = 1.
  startNodes: [
    { id: 'u', type: 'users', x: 380, y: 60 },
    { id: 'd', type: 'dns', x: 120, y: 60 },
    { id: 'l', type: 'lb', x: 380, y: 168, algo: 'rr' },
    { id: 'w1', type: 'web', x: 250, y: 276, size: 'L', scaling: 'auto' },
    { id: 'w2', type: 'web', x: 510, y: 276, size: 'L', scaling: 'auto' },
    { id: 'k', type: 'kv', x: 380, y: 420, n: '3', w: '1', r: '1', mode: 'strict' },
  ],
  startEdges: [
    { id: 's1', from: 'u', to: 'd' }, { id: 's2', from: 'u', to: 'l' },
    { id: 's3', from: 'l', to: 'w1' }, { id: 's4', from: 'l', to: 'w2' },
    { id: 's5', from: 'w1', to: 'k' }, { id: 's6', from: 'w2', to: 'k' },
  ],
  slots: { dns: { x: 120, y: 60 }, lb: { x: 380, y: 168 }, web: { x: 510, y: 276 }, kv: { x: 380, y: 420 } },

  connections: {
    ok: {
      'dns|users': dnsLookup(),
      'lb|users': usersToLb(),
      'lb|web': lbToWeb(),
      'kv|web': { from: 'web', to: 'kv', label: 'get / put', desc: 'The web server calls get(key) or put(key, value). A node acting as coordinator sends it to the key\'s replicas and waits for the quorum.' },
    },
    bad: {
      ...lbBad(),
      'kv|users': 'Users never reach the store directly. Their requests go through the load balancer to a web server, which calls the store.',
      'kv|lb': 'The load balancer spreads requests over web servers. The web servers call the key-value store.',
      'dns|kv': 'The store does not need DNS. Connect the web servers to it.',
    },
  },

  missions: [
    {
      title: 'Never sell a seat twice', ref: 'Quorum consensus', qps: 2000, writes: 0.1, budget: BUDGET,
      gate: {
        hidesTraffic: false,
        lo: 2, hi: 2,
        prompt: '<b>Estimate before you build.</b> Each seat map is kept on N = 3 replicas, and a write waits for W = 2 of them. What is the smallest read quorum R that makes every read see the latest write?',
        label: 'Read quorum R',
        placeholder: 'e.g. 1',
        acceptedHtml: '<p><b>Estimate accepted.</b></p><div class="calc">Strong consistency needs W + R > N<br>2 + R > 3, so R = 2<br>Any 2 replicas you read overlap the 2 that took the write</div>',
        acceptedLog: 'Estimate accepted: R = 2. Play is unlocked.',
        notNumber: 'Type the read quorum as a number, for example 1.',
        hints: [
          { test: (v) => v === 1, text: '2 + 1 = 3 is not more than N: the one replica you read may be the one the write hasn\'t reached yet.' },
          { test: (v) => v === 3, text: 'That works, but it waits for the slowest replica. A smaller R is enough: you need W + R > N.' },
        ],
        fallback: 'Not quite. A read is sure to include a replica with the latest write when W + R > N.',
      },
      story: 'Seat maps are stored on 3 replicas, and both reads and writes wait for just one. A seat map read right after a booking can come from a replica the booking hasn\'t reached yet, and the seat is sold twice. Make every read return the latest seat map. In a network partition, errors are fine; selling a seat twice is not.',
      goals: [
        { id: 'est', type: 'gate', text: 'Estimate the read quorum' },
        servedGoal(targets), latGoal(targets), replicasGoal, freshGoal, costGoal(BUDGET),
        { id: 'partition', type: 'exp', text: 'Break it: split the network; still no old seat maps' },
      ],
      hint: 'Select the key-value store and pick W and R with W + R > N, such as W = 2 and R = 2. Keep the strict quorum: in a partition, the cut-off side must fail rather than answer from old data.',
      takeaway: 'W + R > N, so every read overlaps the latest write. In the partition the cut-off side returned errors instead of old seat maps: this store chose consistency over availability, a CP system.',
    },
    {
      title: 'Carts that always work', ref: 'Sloppy quorum', qps: 2000, writes: 0.3, budget: BUDGET,
      story: 'Shopping carts are different: a cart that sometimes misses the last item added is annoying, but a cart that returns an error loses the sale. Every change must still be stored on 2 replicas before it is confirmed. Keep carts working through a network partition.',
      goals: [
        servedGoal(targets), latGoal(targets), replicasGoal, writeGoal, costGoal(BUDGET),
        { id: 'partition', type: 'exp', text: 'Break it: split the network; at least 99% still served' },
      ],
      hint: 'With a strict quorum of W = 2, the cut-off side has only one replica, so its writes fail. Switch to a sloppy quorum: other nodes stand in and hand the data back later.',
      takeaway: 'Both sides kept answering, and some reads missed the other side\'s changes: this store chose availability over consistency, an AP system. When the network heals, hinted handoff and repair bring the replicas back in line, and conflicting versions are merged.',
    },
    {
      title: 'Seat maps on every page', ref: 'Fast reads', qps: 2000, writes: 0.05, budget: BUDGET,
      story: 'Seat maps now show on every page, and the store must answer reads in 2 ms: only the nearest replica is that fast. Reads still may never return an old seat map. Bookings are rare, so writes can be slower.',
      goals: [
        servedGoal(targets), latGoal(targets), replicasGoal, freshGoal, fastGoal, costGoal(BUDGET),
        { id: 'partition', type: 'exp', text: 'Break it: split the network; still no old seat maps' },
      ],
      hint: 'R = 1 answers from the fastest replica. To keep W + R > N, writes must then wait for all of them: W = N.',
      takeaway: 'R = 1 and W = N: reads are fast and always current, and writes wait for every replica. In the partition no write could reach all three, so bookings failed while seat maps stayed readable. Tune W and R to what the system does most.',
    },
  ],

  // Break-it experiments. An event only checks its outcome; `partition` splits the network while it runs.
  experiments: [
    {
      id: 'partition', kind: 'event', partition: true,
      label: 'Split the network', labelOn: 'Heal the network',
      needsDesign: 'Build the design first: the web servers need the key-value store.',
      on: 'The network splits: 30% of users and one replica of each key are cut off from the rest.', onTone: 'bad',
      off: 'The network is healed. Replicas catch up with the writes they missed.',
      expect: (m) => (m.mission === CART ? served99(m) : fresh(m)),
      notMet: (m) => (m.mission === CART
        ? `Only ${m.servedPct.toFixed(1)}% served: ${fmtPct(m.kvFailPct)} of requests fail where their side of the partition can't reach W replicas. Use a sloppy quorum.`
        : `${fmtPct(m.kvStalePct)} of reads return an old seat map. ${m.kvFailPct > 0 ? '' : 'Both sides keep answering, so each misses the other\'s bookings. '}Keep W + R > N with a strict quorum, so the cut-off side fails instead.`),
      observed: (m) => (m.mission === CART
        ? `Observed: the network split, and ${m.servedPct.toFixed(1)}% of requests were still served. ${fmtPct(m.kvStalePct)} of cart reads missed a change from the other side.`
        : `Observed: the network split, and no read returned an old seat map. ${fmtPct(m.kvFailPct)} of requests failed instead.`),
    },
  ],

  // Messages the engine shows for this level's design.
  text: {
    ...lbText(),
    kvNote: (kv) => {
      if (kv.failed > 0) {
        // A share of 1 means neither side of the partition has enough replicas; less means only the cut-off side.
        const where = (share, what, q) => (share > 0.999
          ? ` ${what} fail on both sides: neither has ${q} replicas.`
          : ` ${what} fail on the cut-off side: it can't reach ${q} replicas.`);
        return `${(100 * kv.failed).toFixed(0)}% of requests fail (strict quorum).`
          + (kv.writeFail > 0 ? where(kv.writeFail, 'Writes', kv.W) : '') + (kv.readFail > 0 ? where(kv.readFail, 'Reads', kv.R) : '');
      }
      if (!(kv.stale > 0)) return null;
      return `${(100 * kv.stale).toFixed(1)}% of reads return an old value: ` + (kv.W + kv.R > kv.N
        ? 'in the partition both sides keep answering, so a read can miss writes made on the other side.'
        : `W + R = ${kv.W + kv.R}, not more than N = ${kv.N}, so a read can miss every replica the latest write has reached.`);
    },
    levelComplete: levelComplete(12),
  },

  quiz: {
    passScore: 8,
    passText: passText(12, 'Unique ID generator'),
    failText,
    questions: [
      { q: 'Why can\'t a real distributed store be "CA" (consistent and available, but not partition tolerant)?', o: ['Disks are too slow to keep up', 'Consistency needs a single server', 'CA systems cost too much to run', 'Networks do fail'], a: 3, e: 'Networks fail, so a distributed system must keep working through partitions. When one happens, it has to give up either consistency (answer from old data) or availability (return errors).', r: 'CAP theorem' },
      { q: 'N = 3, W = 2, R = 2. Why does every read see the latest write?', o: ['Every replica is written before the reply', 'Reads always go to the leader', 'Read and write sets overlap', 'The coordinator caches every value'], a: 2, e: 'Any 2 replicas read share at least one with the 2 that took the write, because 2 + 2 > 3. The read returns the newest version among them.', r: 'Quorum consensus' },
      { q: 'You need fast reads and every read current. Which setting, with N = 3?', o: ['W = 1, R = 1', 'W = 3, R = 1', 'W = 2, R = 1', 'W = 1, R = 3'], a: 1, e: 'R = 1 answers from the fastest replica; W + R > N then needs W = 3. Writes wait for the slowest replica. W = 1, R = 3 is consistent too, but optimizes writes instead.', r: 'Quorum consensus' },
      { q: 'A seat map store is cut off by a partition. What does a CP store do on the cut-off side?', o: ['Returns errors', 'Answers from the replica it can reach', 'Waits until the network heals, then answers', 'Asks the client to merge versions'], a: 0, e: 'A CP system keeps consistency by refusing requests it can\'t confirm with a quorum, so the cut-off side is unavailable until the network heals.', r: 'CAP theorem' },
      { q: 'What do a sloppy quorum and hinted handoff do?', o: ['Writes are dropped until the quorum returns', 'Reads go only to the coordinator', 'Each key keeps fewer replicas', 'Stand-ins keep data, then hand it back'], a: 3, e: 'With a sloppy quorum the first W (or R) healthy nodes on the ring take the request, even if they aren\'t the key\'s replicas. They keep the data with a hint and hand it back when the replica returns. Available, but reads can miss writes.', r: 'Handling failures' },
      { q: 'Versions with vector clocks [A:2, B:1] and [A:2, C:1]. What is their relationship?', o: ['The first came after the second', 'They conflict', 'They are the same version', 'The second came after the first'], a: 1, e: 'Neither has all counters at least as big as the other: B:1 is only in the first, C:1 only in the second. Both changed the same [A:2] version independently, so they conflict and must be merged.', r: 'Inconsistency resolution' },
      { q: 'How do nodes learn that a node has failed, without every node pinging every other?', o: ['Gossip: heartbeats spread to random nodes', 'The coordinator checks each node every second', 'Clients report failed requests', 'A central server tracks every node'], a: 0, e: 'Each node bumps its heartbeat counter and sends its membership list to a few random nodes, which pass it on. A node whose heartbeat stops rising for a while is marked down.', r: 'Handling failures' },
      { q: 'Two replicas of keys 1–16 differ in one key. How does a Merkle tree help?', o: ['It stores every key twice', 'It encrypts the keys', 'It finds which bucket to sync', 'It sorts every key on disk by its hash'], a: 2, e: 'Each bucket of keys has a hash, and each parent hashes its children. Compare roots, then go down only where hashes differ: you sync one bucket, not all 16 keys.', r: 'Handling failures' },
      { q: 'On a write, where does the data go first?', o: ['An SSTable on disk', 'The bloom filter', 'A commit log', 'The read cache'], a: 2, e: 'The write is appended to the commit log, then stored in memory; when memory fills, it is flushed to an SSTable on disk. The log means a crash loses nothing that was confirmed.', r: 'Write and read paths' },
      { q: '200 million carts, 10 KB each, N = 3. About how much storage?', o: ['2 TB', '6 TB', '600 GB', '60 TB'], a: 1, e: '200 million × 10 KB = 2 TB of carts, and each is stored 3 times: 6 TB.', r: 'Numbers to carry into the interview' },
    ],
  },

  // Lesson tab content (HTML). The diagrams below draw into figQuorum and figPartition.
  lessonHtml: `
    <p class="label">Level 12 · Distributed key-value store</p>
    <h1>Distributed key-value store</h1>
    <p class="lede">An airline keeps its seat maps and shopping carts in a key-value store: put(key, value) and get(key), with every key copied to several nodes. In this level you choose how many copies, how many must answer, and what happens when the network splits: errors, or old data.</p>
    <div class="goals-box">
      <div><b>You will learn</b>CAP, quorums, vector clocks, failure handling, and the write and read paths.</div>
      <div><b>You will decide</b>N, W and R, and strict or sloppy quorum.</div>
      <div><b>You will estimate</b>The read quorum that makes every read current.</div>
    </div>

    <section>
      <h2>CAP: pick two, and P is not optional</h2>
      <p class="src">CAP theorem</p>
      <p>A distributed system can't guarantee all three of: <b>consistency</b> (every client sees the same data at the same time), <b>availability</b> (every request gets an answer, even with nodes down) and <b>partition tolerance</b> (it keeps working when the network between nodes breaks). Networks do break, so a real system must tolerate partitions. When one happens, it chooses:</p>
      <ul>
        <li><b>CP</b>: refuse requests it can't confirm, and return errors. An airline seat map must never sell the same seat twice.</li>
        <li><b>AP</b>: keep answering, possibly with old data, and fix it later. A shopping cart that misses one change is better than no cart.</li>
      </ul>
      <p>A "CA" system would need a network that never fails, so it doesn't exist in practice.</p>
    </section>

    <section>
      <h2>Partitioning and replication</h2>
      <p class="src">Data partition · Data replication</p>
      <p>Keys are spread over nodes with consistent hashing, as in Level 11. Each key, such as <code>cart:8812</code>, is copied to <b>N</b> replicas: walk clockwise from its position and take the first N different nodes (skipping virtual nodes of a node already chosen). Put replicas in different data centers too, since nodes in one data center fail together.</p>
    </section>

    <section>
      <h2>Quorum: N, W and R</h2>
      <p class="src">Quorum consensus</p>
      <p>A <b>coordinator</b> node takes each request and sends it to the key's N replicas. A write succeeds when <b>W</b> replicas confirm it; a read waits for <b>R</b> replies and returns the newest. W = 1 doesn't mean one copy: all N get the write, the coordinator just stops waiting after the first.</p>
      <figure class="fig"><svg id="figQuorum" viewBox="0 0 660 230" role="img" aria-label="A coordinator sends a write to replicas a, b and c. With W = 2 it answers once a and b confirm; c gets the write a little later."></svg><figcaption>N = 3, W = 2: the coordinator answers after two confirmations</figcaption></figure>
      <ul>
        <li><b>W + R > N</b>: every read overlaps the latest write, so reads are always current (strong consistency). Usually N = 3, W = R = 2.</li>
        <li><b>R = 1, W = N</b>: fast reads. <b>W = 1, R = N</b>: fast writes.</li>
        <li><b>W + R ≤ N</b>: faster, but a read can miss the latest write.</li>
      </ul>
      <p>The bigger W or R, the longer a request waits: for the slowest of the replicas it needs.</p>
    </section>

    <section>
      <h2>Consistency models and conflicts</h2>
      <p class="src">Consistency models · Vector clocks</p>
      <p><b>Strong</b> consistency: a read always returns the latest write. <b>Weak</b>: it may not. <b>Eventual</b>: given time, every replica gets every update. Highly available stores usually choose eventual consistency, and accept that two replicas can take conflicting writes.</p>
      <p>A <b>vector clock</b> tells which version came first: a list of [server, counter] pairs, where the server handling a write adds 1 to its own counter. A shared shopping list:</p>
      <ol>
        <li>Written through server A: <code>[A:1]</code>. Updated through A again: <code>[A:2]</code>.</li>
        <li>One client updates it through B: <code>[A:2, B:1]</code>. Another, also starting from <code>[A:2]</code>, through C: <code>[A:2, C:1]</code>.</li>
        <li>Neither version has every counter at least as big as the other's, so they <b>conflict</b>. The next client to read gets both, merges them, and writes through A: <code>[A:3, B:1, C:1]</code>.</li>
      </ol>
      <p>A version X is an ancestor of Y when every counter in Y is at least X's. The costs: clients must merge conflicts, and clocks grow with every server, so old pairs are trimmed past a limit.</p>
    </section>

    <section>
      <h2>Handling failures</h2>
      <p class="src">Failure detection · Temporary and permanent failures</p>
      <ul>
        <li><b>Detection with gossip.</b> One node's word isn't enough to mark another down. Each node keeps a membership list of heartbeat counters, bumps its own, and sends the list to a few random nodes. A node whose counter stops rising for a while is marked down.</li>
        <li><b>Sloppy quorum and hinted handoff.</b> A strict quorum blocks when replicas can't be reached. A sloppy quorum uses the first W (or R) <i>healthy</i> nodes instead; a stand-in keeps the data with a hint and hands it back when the replica returns. Available, but W + R > N no longer guarantees current reads.</li>
        <li><b>Repair with Merkle trees.</b> For lasting differences, replicas compare data. Split keys 1–16 into 4 buckets, hash each key, hash each bucket, then hash pairs up to a root. Two replicas compare roots, then children, and sync only the buckets whose hashes differ. In real systems a bucket holds about a thousand keys.</li>
      </ul>
      <figure class="fig"><svg id="figPartition" viewBox="0 0 660 230" role="img" aria-label="A network partition separates replicas a and b with 70% of users from replica c with 30% of users. With W = 2, the cut-off side can't confirm a write."></svg><figcaption>A partition: the cut-off side has one replica of three</figcaption></figure>
    </section>

    <section>
      <h2>Write and read paths</h2>
      <p class="src">Inside a node</p>
      <p><b>Write:</b> append to a commit log on disk, store it in a memory table, and when that fills, flush it to disk as an <b>SSTable</b> (a sorted list of key-value pairs). <b>Read:</b> check memory first; on a miss, a <b>bloom filter</b> tells which SSTables might hold the key, so the node reads only those.</p>
    </section>

    <section>
      <h2>How this level is simulated</h2>
      <p class="src">Game assumptions</p>
      <p>The replicas of a key reply in 2, 4, 10, 12 and 20 ms: the first two share the coordinator's zone, the others are further away. A request waits for the W-th or R-th fastest. 20% of reads come so soon after a write to their key that the write is still spreading; a read then misses it if none of its R replicas has it yet. In a network partition, 30% of users and one replica of each key are cut off from the rest.</p>
      <p class="assume">Game assumptions: $150 a month per replica; a read picks its R replicas at random among the N; the store answers 20,000 requests a second. With a sloppy quorum, writes and reads always find stand-in nodes on their own side.</p>
    </section>

    <section>
      <h2>Numbers to carry into the interview</h2>
      <p class="src">Capacity estimates</p>
      <p><b>Consistent reads</b> need W + R > N. N = 3: W = R = 2, or W = 3 with R = 1.</p>
      <p><b>Storage</b> = keys × value size × N. 200 million carts × 10 KB × 3 = 6 TB.</p>
    </section>

    <section>
      <h2>How each mission maps to the interview</h2>
      <p class="src">Interview loop · times for a 45-minute interview (formats vary by company)</p>
      <div class="steps4">
        <div><span>Step 1 · 5–8 min</span><b>Scope it</b>Value size, data size, and above all: consistent or available when the network splits?</div>
        <div><span>Step 2 · 10–12 min</span><b>Sketch it</b>Nodes on a ring, N replicas, a coordinator, get and put.</div>
        <div><span>Step 3 · 15–20 min</span><b>Go deep</b>Quorums, vector clocks, gossip, hinted handoff, Merkle trees, write and read paths.</div>
        <div><span>Step 4 · 5 min</span><b>Stress it</b>A node fails, a data center goes dark, the network splits.</div>
      </div>
    </section>
`,

  // Lesson diagrams. `f` provides the engine's drawing helpers.
  drawFigures(f) {
    const { $, figNode, figArrow, figDefs, svgEl } = f;
    const label = (svg, x, y, t, anchor = 'middle') => { const e = svgEl('text', { x, y, class: 'd-label', 'text-anchor': anchor }, svg); e.textContent = t; };

    const f1 = $('figQuorum'); f1.textContent = ''; figDefs(f1);
    figNode(f1, 'web', 110, 115, 'Web server', 'put(cart:8812)');
    figNode(f1, 'kv', 330, 115, 'Coordinator', 'Waits for W = 2');
    figNode(f1, 'kv', 560, 40, 'Replica a', 'Confirms, 2 ms');
    figNode(f1, 'kv', 560, 115, 'Replica b', 'Confirms, 4 ms');
    figNode(f1, 'kv', 560, 190, 'Replica c', 'Gets it later');
    figArrow(f1, 206, 115, 234, 115, '', null, 0, 0);
    figArrow(f1, 426, 100, 464, 52, '', null, 0, 0);
    figArrow(f1, 426, 115, 464, 115, '', null, 0, 0);
    svgEl('line', { x1: 426, y1: 130, x2: 464, y2: 178, class: 'd-line d-dash' }, f1);

    const f2 = $('figPartition'); f2.textContent = ''; figDefs(f2);
    figNode(f2, 'users', 120, 50, 'Users, 70%', 'Reach a and b');
    figNode(f2, 'kv', 120, 130, 'Replica a', 'Reachable');
    figNode(f2, 'kv', 120, 200, 'Replica b', 'Reachable');
    figNode(f2, 'users', 540, 50, 'Users, 30%', 'Reach only c');
    figNode(f2, 'kv', 540, 165, 'Replica c', 'Cut off');
    svgEl('line', { x1: 330, y1: 10, x2: 330, y2: 222, class: 'd-line d-dash' }, f2);
    label(f2, 330, 120, 'partition');
    label(f2, 330, 140, 'W = 2: c alone');
    label(f2, 330, 158, 'can\'t confirm');
  },
};
