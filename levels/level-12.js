// @ts-check
/** @import { Level, Goal, Lesson } from '../js/types.js' */
// Level 12: Distributed key-value store.
// Everything specific to this level lives here: components, rules, missions, quiz and text.
import { fmt, ms, count } from '../js/format.js';
import { COMPONENTS } from '../js/engine/catalog.js';
import { REPLICA_MS } from '../js/engine/quorum.js';
import { servedGoal, latGoal, costGoal, servedAtLeast, fmtPct } from './shared/goals.js';
import { dns, lb, NO_DB_NOTE, autoscaleSubOf, scalingChoices } from './shared/components.js';
import { dnsLookup, usersToLb, lbToWeb, lbBad } from './shared/connections.js';
import { lbText, levelComplete } from './shared/text.js';
import { failText, passText } from './shared/quiz.js';
import { dayTraffic } from './shared/workload.js';
import { STEPS } from './mock-steps.js';

const targets = { latencyMs: 150, servedPct: 99 };
// N = 3 replicas fit, N = 5 do not: DNS $5 + LB $20 + 2 L web groups × $333 + N × $150 = $1,141 (N = 3), $1,441 (N = 5).
const BUDGET = 1300;
/** The fewest replicas of every key (all missions), and the fewest that must confirm a cart change (Mission 2). */
const MIN_COPIES = 3;
const CART_COPIES = 2;
/** Mission 3's read time: only the nearest replica answers this fast, so R must be 1. */
const FAST_READ_MS = REPLICA_MS[0];

// ---------------- Lesson ----------------
const [scope, sketch, deep, stress] = STEPS.map((step) => `<b>${step.name}</b>`);
const kvPart = COMPONENTS.kv;
// Quorum example (ours): N = 5, W = 3, so R = 5 − 3 + 1 = 3, and 3 + 3 = 6 is more than 5. Mission 1 asks about
// N = 3, W = 2 and the quiz about N = 3, W = R = 2, so the picture draws this example too, not those.
const qEx = { n: 5, w: 3 };
qEx.r = qEx.n - qEx.w + 1;
// Check yourself: N = 5, W = 4, so R = 2: 4 + 1 = 5 is not more than 5, and 4 + 2 = 6 is.
const qCheck = { n: 5, w: 4 };
qCheck.r = qCheck.n - qCheck.w + 1;
// Storage example (ours): 50 million seat maps of 20 KB = 1 billion KB = 1 TB, on 3 replicas = 3 TB. The quiz uses
// 200 million carts of 10 KB.
const KB_PER_TB = 1e9;
const store = { items: 50e6, kb: 20, n: 3 };
store.oneTb = store.items * store.kb / KB_PER_TB;
store.allTb = store.oneTb * store.n;
/** Replicas `from` to `to`, 1-based, as words: "replicas 1, 2 and 3". */
const replicaList = (from, to) => {
  const ids = Array.from({ length: to - from + 1 }, (_, i) => from + i);
  return `replicas ${ids.slice(0, -1).join(', ')} and ${ids[ids.length - 1]}`;
};
const readFrom = qEx.n - qEx.r + 1; // the first replica the picture's read asks

/** @type {Lesson} */
const lesson = {
  intro: {
    kicker: 'Level 12 · Part 2: Building blocks',
    title: 'Distributed key-value store',
    story: 'The shop now sells concert tickets. Seat maps and carts live in a store that keeps three copies of everything and must stay up when servers fail. But three copies can disagree, and yesterday one seat was sold twice.',
    picture: 'figBuilt',
    alt: 'The finished design: web servers read and write a key-value store whose nodes sit on a ring. Each key is copied to three neighbouring nodes, and two settings, W and R, decide how many must answer.',
    outcomes: [
      'say what N, W and R mean',
      'use W + R > N to make reads current',
      'explain the choice a network split forces on a store',
      'say when an old answer is better than an error',
      'tune W and R for fast reads or fast writes',
    ],
  },
  last: 'Level 11 put cache servers on a ring, so losing one moved only its keys. A cache can afford to lose data. A store cannot, so every key now needs several copies.',
  parts: [
    {
      title: 'Never sell a seat twice',
      mission: 0,
      minutes: 10,
      lead: 'Several copies keep data safe when a server dies. They also create a new question: which copy do you believe?',
      newParts: [
        { type: 'kv', what: 'A store that keeps each value under a key, on several servers arranged as a ring.', does: 'Copies every key to several nodes. A read or a write is done once enough of them have answered.', game: `$${kvPart.cost} a month for each copy. You set N, W and R.` },
      ],
      sections: [
        {
          title: 'How can a store with three copies give an old answer?',
          hook: 'Each key is kept on <b>N</b> nodes: the first N servers clockwise from the key on the ring. Each copy is a <b>replica</b>.',
          body: [
            { p: 'A write is sent to all N, but they do not all finish at the same instant. If the store confirms the write as soon as one replica has it, and a read then asks a different replica, the read gets the value from before the write. That is an old, or <b>stale</b>, answer.' },
            { p: 'For a seat map this is how a seat is sold twice: the second buyer reads a copy the first booking has not reached.' },
          ],
          takeaway: 'Copies are not updated at the same instant, so a read can reach an old one.',
          quiz: [],
        },
        {
          title: 'How do W and R make a read see the latest write?',
          hook: 'Wait for more than one replica. <b>W</b> is how many must confirm a write. <b>R</b> is how many a read must hear from.',
          body: [
            {
              figure: 'figQuorum',
              alt: `Of ${qEx.n} replicas, a write has reached ${replicaList(1, qEx.w)}. A read asks ${replicaList(readFrom, qEx.n)}. The read gets the new value from replica ${qEx.w} and keeps it. Replica ${qEx.w} is in both groups.`,
              caption: 'The write group and the read group share at least one replica',
            },
            { p: 'If <b>W + R &gt; N</b>, the replicas that took the write and the replicas a read asks must share at least one. That one has the latest value, and the read keeps the newest it sees. A group big enough to force this overlap is a <b>quorum</b>.' },
            {
              calc: {
                formula: `Smallest R = N − W + 1. With N = ${qEx.n} replicas and W = ${qEx.w}:`,
                rows: [
                  { label: 'Read quorum', work: `${qEx.n} replicas − ${qEx.w} replicas + 1`, result: `R = ${qEx.r} replicas` },
                  { label: 'Check', work: `${qEx.w} replicas + ${qEx.r} replicas`, result: `${qEx.w + qEx.r} replicas, more than ${qEx.n}` },
                ],
                result: `Any ${qEx.r} replicas you read include at least one of the ${qEx.w} that took the write.`,
              },
            },
          ],
          takeaway: 'With W + R > N, every read overlaps the latest write.',
          quiz: [1],
        },
        {
          title: 'What happens when the network splits?',
          hook: 'Sometimes the nodes are all running but some cannot reach the others. This is a <b>network partition</b>.',
          body: [
            { p: 'A node on the cut-off side cannot gather its quorum. It has two choices, and no third.' },
            { table: { head: ['Choice', 'The cut-off side', 'Right for'], rows: [
              ['<b>Consistency first (CP)</b>', 'Returns an error', 'Seats, payments, balances'],
              ['<b>Availability first (AP)</b>', 'Answers from what it has, which may be old', 'Carts, likes, feeds'],
            ] } },
            { p: 'You cannot refuse to choose, because networks do fail. This trade is known as the <b>CAP theorem</b>: when a partition happens, a store is either consistent or available. A <b>strict quorum</b>, where only the key\'s own N replicas count, takes the first row.' },
          ],
          takeaway: 'In a partition a store must choose: return an error, or risk an old answer.',
          quiz: [0, 3],
        },
      ],
      checks: [
        {
          q: `A store keeps N = ${qCheck.n} copies and a write waits for W = ${qCheck.w}. What is the smallest R that makes every read current?`,
          options: [
            { t: 'R = 1', why: `${qCheck.w} + 1 = ${qCheck.w + 1}, which is not more than ${qCheck.n}. The one replica you read could be the one the write missed.` },
            { t: `R = ${qCheck.r}`, right: true, why: `${qCheck.w} + ${qCheck.r} = ${qCheck.w + qCheck.r}, more than ${qCheck.n}. Any ${qCheck.r} replicas include one that took the write.` },
            { t: `R = ${qCheck.n}`, why: 'That works but waits for every replica. A smaller R is enough.' },
          ],
        },
      ],
      youWill: [
        'estimate the read quorum (Play stays locked until you do)',
        `set W and R so no read returns an old seat map, with every key on at least ${MIN_COPIES} replicas`,
        'split the network with the Break it button: errors are allowed, old seat maps are not',
        `keep Response under ${ms(targets.latencyMs)} for at most $${fmt(BUDGET)} a month`,
      ],
      debrief: {
        saw: 'Every read overlapped the latest write. In the partition, the cut-off side returned errors, not old seat maps.',
        number: ['W + R > N', 'the rule that makes reads current'],
        next: 'Shopping carts use the same store. For a cart, an error at checkout loses the sale.',
      },
    },
    {
      title: 'Carts that always work',
      mission: 1,
      minutes: 9,
      lead: 'The right choice in a partition depends on what the data is for.',
      sections: [
        {
          title: 'When is an old answer better than an error?',
          hook: 'A cart that misses the last item added is annoying. A cart that says "try again later" sends the shopper away.',
          body: [
            { p: 'For data like this, pick availability: always accept the change, and let the copies disagree for a while. They are brought back in line afterwards. A store that works this way is <b>eventually consistent</b>: if writes stop, all copies end up the same.' },
            { p: 'You still want every change on more than one node before you confirm it, so that one crash cannot lose it.' },
          ],
          takeaway: 'Choose availability when a wrong answer can be repaired and an error cannot.',
          quiz: [],
        },
        {
          title: 'How does a sloppy quorum keep writes working?',
          hook: 'With a strict quorum, a write needs W of the key\'s own N replicas. Cut off from them, it fails.',
          body: [
            {
              figure: 'figSplit',
              alt: 'A partition cuts replica 3 off from replicas 1 and 2. With consistency first, a client on replica 3\'s side gets an error. With availability first, the client gets an answer that may be old, and its write is kept by a stand-in node to hand back later.',
              caption: 'An error on one side, or a stand-in that hands the data back',
            },
            { p: 'A <b>sloppy quorum</b> relaxes one thing: the W nodes can be any healthy nodes the client can reach. A node that is not one of the key\'s replicas stands in, keeps the data with a note saying whose it is, and passes it on when the real replica is reachable again. That last step is <b>hinted handoff</b>.' },
            { p: 'The write is safe on W nodes. But a read may not find it yet, because it is not where reads look.' },
          ],
          takeaway: 'A sloppy quorum lets stand-in nodes take writes and hand them back later.',
          quiz: [4],
        },
        {
          title: 'How do the copies agree again afterwards?',
          hook: 'After a partition, two sides may hold different versions of the same cart. Three tools clean up.',
          body: [
            { table: { head: ['Tool', 'What it answers', 'How'], rows: [
              ['<b>Vector clock</b>', 'Is one version newer, or do they conflict?', 'Each version carries a counter per node that changed it. If every counter of one is at least the other\'s, it is newer. If each is ahead somewhere, they conflict and must be merged. A node missing from a clock counts as 0.'],
              ['<b>Merkle tree</b>', 'Which keys differ between two replicas?', 'Compare one hash for all the data, then for each half, and so on. Only branches that differ are opened.'],
              ['<b>Gossip</b>', 'Which nodes are down?', 'Each node passes heartbeat counts to a few random nodes. A count that stops rising marks a dead node.'],
            ] } },
            { p: 'Example: versions [A:1, B:2] and [A:2, B:1]. The first is ahead on B and the second on A, so they conflict. For a cart, merging means keeping the items from both.' },
          ],
          takeaway: 'Versions are compared, conflicts are merged, and only the differences are copied.',
          quiz: [5, 6, 7],
        },
      ],
      checks: [
        {
          q: 'During a partition, a shopper adds an item. The store uses a sloppy quorum with W = 2. Two reachable nodes take the write; one is a stand-in. What is true?',
          options: [
            { t: 'The write failed', why: 'A sloppy quorum counts any two healthy nodes, so it succeeded.' },
            { t: 'The write is safe, but a read elsewhere may not see it yet', right: true, why: 'It is on two nodes. It reaches its real replica when the stand-in hands it back.' },
          ],
        },
      ],
      youWill: [
        'switch the store to a sloppy quorum',
        `keep every cart change confirmed by at least ${CART_COPIES} replicas`,
        `split the network and still serve at least ${targets.servedPct}% of requests`,
        `stay within $${fmt(BUDGET)} a month`,
      ],
      debrief: {
        saw: 'Both sides of the partition kept answering. Some reads missed the other side\'s changes until the network healed.',
        number: [`${CART_COPIES} replicas`, 'confirmed every cart change'],
        next: `Seat maps are about to appear on every page. The store must answer those reads in ${ms(FAST_READ_MS)}, and still never show an old one.`,
      },
    },
    {
      title: 'Seat maps on every page',
      mission: 2,
      minutes: 8,
      lead: 'W and R also decide how fast the store is, because an operation waits for the slowest replica it needs.',
      sections: [
        {
          title: 'How to tune W and R for what the store does most',
          hook: 'A read with R = 1 returns as soon as the nearest replica answers. A read with R = 3 waits for the slowest of three.',
          body: [
            { table: { head: ['Setting (N = 3)', 'Reads', 'Writes', 'Current?'], rows: [
              ['W = 3, R = 1', 'Fast', 'Slow, and fail if any replica is down', 'Yes'],
              ['W = 2, R = 2', 'Medium', 'Medium', 'Yes'],
              ['W = 1, R = 3', 'Slow', 'Fast', 'Yes'],
              ['W = 1, R = 1', 'Fast', 'Fast', 'No: no overlap'],
            ] } },
            { p: 'Keep W + R &gt; N when reads must be current, then put the waiting on the side that happens less often. A product catalogue, for example, is read all day and edited weekly, so its reads get the small number.' },
          ],
          takeaway: 'Keep W + R > N, and give the smaller number to the more frequent operation.',
          quiz: [2],
        },
        {
          title: 'How does one node keep a write safe?',
          hook: 'A node must not lose a write it has confirmed, even if it crashes a moment later.',
          body: [
            { ol: [
              'It appends the write to a <b>commit log</b> on disk. This is the first step, and it is what survives a crash.',
              'It puts the value in a table in memory, where reads find it fast.',
              'When that table is full, it is written to disk as a sorted file (an SSTable).',
            ] },
            { p: 'A read looks in the memory table first, then in the files. A <b>Bloom filter</b>, a small summary of each file, says which files cannot hold the key, so the read skips them.' },
            {
              calc: {
                formula: `Storage = items × size of one item × N. ${count(store.items)} seat maps of ${store.kb} KB, N = ${store.n}:`,
                rows: [
                  { label: 'One copy', work: `${count(store.items)} seat maps × ${store.kb} KB`, result: `${store.oneTb} TB` },
                  { label: 'All copies', work: `${store.oneTb} TB × ${store.n} replicas`, result: `${store.allTb} TB` },
                ],
                result: `Every extra copy costs the whole data set again: ${store.allTb} TB for ${store.oneTb} TB of data.`,
              },
            },
          ],
          takeaway: 'A node logs a write to disk first, and N copies cost N times the storage.',
          quiz: [8, 9],
        },
      ],
      checks: [
        {
          q: 'A store with N = 3 is written all day and read once a night, and reads must be current. Which setting?',
          options: [
            { t: 'W = 3, R = 1', why: 'That makes the frequent operation, the write, wait for all three replicas.' },
            { t: 'W = 1, R = 3', right: true, why: 'Writes return after one replica. The rare read waits for all three, and 1 + 3 is more than 3.' },
            { t: 'W = 1, R = 1', why: 'Fast both ways, but 1 + 1 is not more than 3, so a read can be old.' },
          ],
        },
      ],
      youWill: [
        `get seat-map reads answered by the store in ${ms(FAST_READ_MS)}`,
        'keep every read current: no old seat maps, even with the network split',
        `stay within $${fmt(BUDGET)} a month`,
      ],
    },
  ],
  wrap: {
    picture: 'figBuiltEnd',
    alt: 'The design you built: web servers read and write a key-value store whose nodes sit on a ring. Each key is copied to three neighbouring nodes, and two settings, W and R, decide how many must answer.',
    say: [
      '"Each key is copied to N nodes, and with W + R > N every read overlaps the latest write."',
      '"In a partition I choose: errors for data that must be right, old answers for data that must be available."',
      '"I give the smaller of W and R to whichever operation happens more often."',
    ],
    numbers: [
      ['W + R > N', 'reads overlap the latest write'],
      ['N = 3', 'a common number of copies'],
    ],
    loop: `The interview steps again: ${scope} (the read quorum), ${sketch} (replicas on a ring), ${deep} (W, R and strict or sloppy), ${stress} (you split the network three times).`,
    broken: 'Orders are now created on many servers at once, and each one needs an ID that no other server will ever hand out. Level 13 makes those IDs.',
  },
};

// ---------------- Lesson pictures ----------------
/**
 * The quorum example from the lesson's worked example: N replicas in a column, the write group bracketed on the
 * left and the read group on the right. The replicas in both hold the new value, and the read keeps it.
 * @param {Record<string, Function>} f the drawing helpers `drawFigures` is given
 * @param {SVGSVGElement} svg
 */
function drawQuorum(f, svg) {
  const { svgEl, figNode, figLabel, figSvg } = f;
  const top = 40, step = 72, half = 30;
  figSvg(svg, top + (qEx.n - 1) * step + half + 14);
  const yOf = (i) => top + (i - 1) * step; // replica i, 1-based
  for (let i = 1; i <= qEx.n; i++) {
    const sub = i < readFrom ? 'New value' : i <= qEx.w ? 'New, read keeps it' : 'Old value';
    figNode(svg, 'kv', 320, yOf(i), `Replica ${i}`, sub);
  }
  /** A bracket beside replicas `from` to `to`, opening towards them, with two lines of label outside it. */
  const bracket = (x, dir, from, to, lines) => {
    const y1 = yOf(from) - half + 4, y2 = yOf(to) + half - 4, mid = (y1 + y2) / 2;
    svgEl('path', { d: `M ${x + 10 * dir} ${y1} H ${x} V ${y2} H ${x + 10 * dir}`, class: 'd-line', fill: 'none' }, svg);
    lines.forEach((t, k) => figLabel(svg, x - 10 * dir, mid - 4 + 18 * k, t, dir > 0 ? 'end' : 'start'));
  };
  bracket(206, 1, 1, qEx.w, ['Write', `W = ${qEx.w} confirmed`]);
  bracket(434, -1, readFrom, qEx.n, ['Read', `R = ${qEx.r} asked`]);
}

/**
 * One partition, two choices: replicas 1 and 2 cut off from replica 3 and its client. Consistency first gives the
 * client an error; availability first answers, maybe with old data, and a stand-in keeps the client's write.
 * @param {Record<string, Function>} f the drawing helpers `drawFigures` is given
 * @param {SVGSVGElement} svg
 */
function drawSplit(f, svg) {
  const { svgEl, figNode, figArrow, figLabel, figSvg } = f;
  figSvg(svg, 410);
  const panels = [
    { x: 10, label: 'Consistency first', client: 'Gets an error', standIn: false },
    { x: 330, label: 'Availability first', client: 'Answer may be old', standIn: true },
  ];
  for (const { x, label, client, standIn } of panels) {
    const cx = x + 150;
    svgEl('rect', { x, y: 10, width: 300, height: 390, rx: 12, class: 'tier-box' }, svg);
    figLabel(svg, x + 14, 30, label, 'start', 'tier-label');
    figNode(svg, 'kv', cx, 76, 'Replicas 1 and 2', 'Out of reach');
    // The partition: a jagged line across the panel.
    const zig = Array.from({ length: 15 }, (_, i) => `${i ? 'L' : 'M'} ${x + 10 + i * 20} ${i % 2 ? 118 : 130}`).join(' ');
    svgEl('path', { d: zig, class: 'd-line', fill: 'none' }, svg);
    figNode(svg, 'kv', cx, 172, 'Replica 3', 'Cut off');
    figNode(svg, 'users', cx, 266, 'Client', client);
    figArrow(svg, cx, 236, cx, 204, 'read', null, cx + 10, 224);
    if (standIn) {
      figNode(svg, 'kv', cx, 360, 'Stand-in node', 'Hands it back later');
      figArrow(svg, cx, 296, cx, 328, 'write', null, cx + 10, 316);
    }
  }
}

/**
 * The finished design, drawn for the intro and again for the wrap-up: web servers read and write a key-value store
 * whose nodes sit on a ring, with each key copied to the next N nodes clockwise.
 * @param {Record<string, Function>} f the drawing helpers `drawFigures` is given
 * @param {SVGSVGElement} svg
 */
function drawBuilt(f, svg) {
  const { svgEl, figNode, figArrow, figLabel, figSvg } = f;
  figSvg(svg, 580);
  figNode(svg, 'users', 320, 46, 'Users', 'Seats and carts');
  figNode(svg, 'lb', 320, 156, 'Load balancer', 'Shares requests');
  figArrow(svg, 320, 76, 320, 126, '', null, 0, 0);
  figNode(svg, 'web', 320, 266, 'Web servers', 'Autoscaled');
  figArrow(svg, 320, 186, 320, 236, '', null, 0, 0);
  figNode(svg, 'kv', 320, 376, 'Key-value store', `N = ${MIN_COPIES} copies`);
  figArrow(svg, 320, 296, 320, 346, 'get / put', null, 332, 326);
  // Inside the store: eight nodes on a ring. The key's copies go to the next N nodes clockwise.
  const nodes = 8, key = 0.06, cx = 320, cy = 482, r = 52;
  const at = (share) => [cx + r * Math.sin(2 * Math.PI * share), cy - r * Math.cos(2 * Math.PI * share)];
  svgEl('circle', { cx, cy, r, class: 'd-line', fill: 'none' }, svg);
  for (let i = 0; i < nodes; i++) {
    const [nx, ny] = at(i / nodes);
    svgEl('rect', { x: nx - 9, y: ny - 9, width: 18, height: 18, rx: 4, class: i >= 1 && i <= MIN_COPIES ? 'ic-data' : 'node-box' }, svg);
  }
  const [kx, ky] = at(key);
  svgEl('circle', { cx: kx, cy: ky, r: 5, class: 'ch-pt' }, svg);
  figLabel(svg, cx + r + 22, cy - 6, 'one key, copied to', 'start');
  figLabel(svg, cx + r + 22, cy + 12, `the next ${MIN_COPIES} nodes`, 'start');
  figLabel(svg, cx, cy + r + 34, 'W and R decide how many must answer');
}

// The store's setting as the canvas shows it (saved settings are checked on load, so these are valid options).
const quorumOf = (n) => { const N = Number(n.n) || 3; return { N, W: Math.min(N, Number(n.w) || 1), R: Math.min(N, Number(n.r) || 1), sloppy: n.mode === 'sloppy' }; };
/** @type {Goal} */
const replicasGoal = { id: 'replicas', type: 'metric', text: `Every key kept on at least ${MIN_COPIES} replicas`, test: (m) => !!m.kvQuorum && m.kvQuorum.N >= MIN_COPIES, val: (m) => (m.kvQuorum ? `N = ${m.kvQuorum.N}` : '—') };
const fresh = (m) => m.kvStalePct != null && m.kvStalePct < 1e-9;
/** @type {Goal} */
const freshGoal = { id: 'fresh', type: 'metric', text: 'No read returns an old seat map', test: fresh, val: (m) => (m.kvStalePct == null ? '—' : fmtPct(m.kvStalePct)) };
/** @type {Goal} */
const writeGoal = { id: 'durable', type: 'metric', text: `Each cart change confirmed by at least ${CART_COPIES} replicas`, test: (m) => !!m.kvQuorum && m.kvQuorum.W >= CART_COPIES, val: (m) => (m.kvQuorum ? `W = ${m.kvQuorum.W}` : '—') };
/** @type {Goal} */
const fastGoal = { id: 'fastread', type: 'metric', text: `Seat reads answered by the store in ${ms(FAST_READ_MS)}`, test: (m) => m.kvReadMs != null && m.kvReadMs <= FAST_READ_MS, val: (m) => (m.kvReadMs == null ? '—' : m.kvReadMs + ' ms') };
const served99 = servedAtLeast(targets.servedPct);
const CART = 1; // the mission that keeps answering through the partition; the others must never be stale

/** @type {Level} */
export default {
  id: 12,
  saveKey: 'sdl-level12-v1',
  saveVersion: 2, // 2: which missions were opened from the lesson (`opened`)
  targets,
  // The day's traffic curve (for the autoscaled web servers). recentShare: reads whose key was written so recently that
  // the write is still spreading. partitionFar: the users cut off with floor(N / 3) of each key's replicas in a network partition.
  workload: { day: dayTraffic(), recentShare: 0.2, partitionFar: 0.3 },

  components: {
    users: {
      name: 'Users', sub: 'Pick seats, fill carts',
      desc: 'Fans buying concert tickets in the shop. They open seat maps, pick seats and fill shopping carts. Every page reads or writes one key in the key-value store, such as seats:show204 or cart:8812.',
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
      story: `Shopping carts are different: a cart that sometimes misses the last item added is annoying, but a cart that returns an error loses the sale. Every change must still be stored on ${CART_COPIES} replicas before it is confirmed. Keep carts working through a network partition.`,
      goals: [
        servedGoal(targets), latGoal(targets), replicasGoal, writeGoal, costGoal(BUDGET),
        { id: 'partition', type: 'exp', text: 'Break it: split the network; at least 99% still served' },
      ],
      hint: 'With a strict quorum of W = 2, the cut-off side has only one replica, so its writes fail. Switch to a sloppy quorum: other nodes stand in and hand the data back later.',
      takeaway: 'Both sides kept answering, and some reads missed the other side\'s changes: this store chose availability over consistency, an AP system. When the network heals, hinted handoff and repair bring the replicas back in line, and conflicting versions are merged.',
    },
    {
      title: 'Seat maps on every page', ref: 'Fast reads', qps: 2000, writes: 0.05, budget: BUDGET,
      story: `Seat maps now show on every page, and the store must answer reads in ${ms(FAST_READ_MS)}: only the nearest replica is that fast. Reads still may never return an old seat map. Bookings are rare, so writes can be slower.`,
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
      { q: 'Why can\'t a real distributed store be "CA" (consistent and available, but not partition tolerant)?', o: ['Disks are too slow to keep up', 'Consistency needs a single server', 'CA systems cost too much to run', 'Networks do fail'], a: 3, e: 'Networks fail, so a distributed system must keep working through partitions. When one happens, it has to give up either consistency (answer from old data) or availability (return errors).', r: 'What happens when the network splits?' },
      { q: 'N = 3, W = 2, R = 2. Why does every read see the latest write?', o: ['Every replica is written before the reply', 'Reads always go to the leader', 'Read and write sets overlap', 'The coordinator caches every value'], a: 2, e: 'Any 2 replicas read share at least one with the 2 that took the write, because 2 + 2 > 3. The read returns the newest version among them.', r: 'How do W and R make a read see the latest write?' },
      { q: 'You need fast reads and every read current. Which setting, with N = 3?', o: ['W = 1, R = 1', 'W = 3, R = 1', 'W = 2, R = 1', 'W = 1, R = 3'], a: 1, e: 'R = 1 answers from the fastest replica; W + R > N then needs W = 3. Writes wait for the slowest replica. W = 1, R = 3 is consistent too, but optimizes writes instead.', r: 'How to tune W and R for what the store does most' },
      { q: 'A seat map store is cut off by a partition. What does a CP store do on the cut-off side?', o: ['Returns errors', 'Answers from the replica it can reach', 'Waits until the network heals, then answers', 'Asks the client to merge versions'], a: 0, e: 'A CP system keeps consistency by refusing requests it can\'t confirm with a quorum, so the cut-off side is unavailable until the network heals.', r: 'What happens when the network splits?' },
      { q: 'What do a sloppy quorum and hinted handoff do?', o: ['Writes are dropped until the quorum returns', 'Reads go only to the coordinator', 'Each key keeps fewer replicas', 'Stand-ins keep data, then hand it back'], a: 3, e: 'With a sloppy quorum the first W (or R) healthy nodes on the ring take the request, even if they aren\'t the key\'s replicas. They keep the data with a hint and hand it back when the replica returns. Available, but reads can miss writes.', r: 'How does a sloppy quorum keep writes working?' },
      { q: 'Versions with vector clocks [A:2, B:1] and [A:2, C:1]. What is their relationship?', o: ['The first came after the second', 'They conflict', 'They are the same version', 'The second came after the first'], a: 1, e: 'Neither has all counters at least as big as the other: B:1 is only in the first, C:1 only in the second. Both changed the same [A:2] version independently, so they conflict and must be merged.', r: 'How do the copies agree again afterwards?' },
      { q: 'How do nodes learn that a node has failed, without every node pinging every other?', o: ['Gossip: heartbeats spread to random nodes', 'The coordinator checks each node every second', 'Clients report failed requests', 'A central server tracks every node'], a: 0, e: 'Each node bumps its heartbeat counter and sends its membership list to a few random nodes, which pass it on. A node whose heartbeat stops rising for a while is marked down.', r: 'How do the copies agree again afterwards?' },
      { q: 'Two replicas of keys 1–16 differ in one key. How does a Merkle tree help?', o: ['It stores every key twice', 'It encrypts the keys', 'It finds which bucket to sync', 'It sorts every key on disk by its hash'], a: 2, e: 'Each bucket of keys has a hash, and each parent hashes its children. Compare roots, then go down only where hashes differ: you sync one bucket, not all 16 keys.', r: 'How do the copies agree again afterwards?' },
      { q: 'On a write, where does the data go first?', o: ['An SSTable on disk', 'The bloom filter', 'A commit log', 'The read cache'], a: 2, e: 'The write is appended to the commit log, then stored in memory; when memory fills, it is flushed to an SSTable on disk. The log means a crash loses nothing that was confirmed.', r: 'How does one node keep a write safe?' },
      { q: '200 million carts, 10 KB each, N = 3. About how much storage?', o: ['2 TB', '6 TB', '600 GB', '60 TB'], a: 1, e: '200 million × 10 KB = 2 TB of carts, and each is stored 3 times: 6 TB.', r: 'How does one node keep a write safe?' },
    ],
  },

  lesson,

  // Lesson diagrams. `f` provides the engine's drawing helpers. Each figure sets its own viewBox.
  drawFigures(f) {
    const { $ } = f;
    drawQuorum(f, $('figQuorum'));
    drawSplit(f, $('figSplit'));
    drawBuilt(f, $('figBuilt'));
    drawBuilt(f, $('figBuiltEnd'));
  },
};
