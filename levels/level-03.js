// @ts-check
/** @import { Level, Goal, Lesson } from '../js/types.js' */
// Level 3: Database replication.
// Everything specific to this level lives here: components, rules, missions, quiz and text.
import { servedGoal, latGoal, costGoal, spofGoal, servedAtLeast } from './shared/goals.js';
import { shopUsers, dns, lb, NO_DB_NOTE, replicaDb } from './shared/components.js';
import { dnsLookup, usersToLb, lbToWeb, webToReplicas, lbBad, replicaBad } from './shared/connections.js';
import { lbText, replicaText, levelComplete } from './shared/text.js';
import { ONE_DNS, TWO_LBS } from './shared/limits.js';
import { failText, passText } from './shared/quiz.js';
import { fmt, count, percent, ms, rate } from '../js/format.js';
import { SIZES, T } from '../js/engine/catalog.js';
import { STEPS } from './mock-steps.js';

const targets = { latencyMs: 150, servedPct: 99 };
/** Every database must stay under this share busy, in all three missions. */
const DB_BUSY = 0.7;
/** Peak traffic in req/s and the share of requests that write: Mission 1, then Missions 2 and 3 once shoppers get carts and reviews. */
const LOAD = { reads: { qps: 1500, writes: 0.1 }, grown: { qps: 2000, writes: 0.2 } };
/** Monthly budget of each mission, in dollars. */
const BUDGET = { replicas: 2400, writes: 2800, failover: 2800 };
/** Size of the database the level starts with: the largest. */
const START_DB_SIZE = 'XL';

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


// ---------------- Lesson ----------------
const { L } = SIZES;
const [scope, sketch, deep, stress] = STEPS.map((step) => `<b>${step.name}</b>`);
/** "10" for a mission where 1 request in 10 writes. */
const writeShare = (load) => `${Math.round(1 / load.writes)}`;
const SECONDS_A_DAY = 24 * 60 * 60;

// Sizing example (our load, not a game number): 900 reads/s and 100 writes/s over 2 replicas.
const ex = { reads: 900, writes: 100, replicas: 2 };
ex.each = ex.reads / ex.replicas + ex.writes;
// Check yourself: other numbers again.
const chk = { reads: 1600, writes: 400, replicas: 4 };
chk.each = chk.reads / chk.replicas + chk.writes;

// "Replicas do not help writes": 1,200 reads/s and 600 writes/s over more and more replicas.
const floor = { reads: 1200, writes: 600 };
const floorRows = [2, 3, 6].map((n) => [`${n}`, fmt(floor.reads / n), fmt(floor.writes), `${fmt(floor.reads / n + floor.writes)} queries/s`]);

// Estimate example (ours): a forum where 1 request in 4 writes.
const est = { users: 6000000, each: 18, share: 4 };
est.day = est.users * est.each;
est.avg = est.day / SECONDS_A_DAY;
est.peak = est.avg * 2;
est.writes = est.peak / est.share;

/** @type {Lesson} */
const lesson = {
  intro: {
    kicker: 'Level 3 · Part 1: Grow one app',
    title: 'Database replication',
    story: 'Your web tier now grows by adding servers, but every one of them leans on a single database. It is the largest size you can rent and it is nearly full. In this level you give it copies.',
    picture: 'figBuilt',
    alt: 'The finished design: the web servers send writes to one primary database and reads to three replicas. The primary copies every write to each replica.',
    outcomes: [
      'tell a read from a write, and say why the ratio matters',
      'explain what a primary and a replica each do',
      'work out the load on each replica',
      'say why replicas do not help with writes',
      'explain what can be lost when a primary fails',
    ],
  },
  last: 'Level 2 left one single point of failure: the database. Every web server depends on it, it cannot be scaled out the way web servers can, and it is nearly full.',
  parts: [
    {
      title: 'Reads swamp the database',
      mission: 0,
      minutes: 10,
      lead: 'The web servers cope. The one database behind them does not.',
      sections: [
        {
          title: 'Why is the database full when the web servers are not?',
          hook: 'Every request needs the database. You can add web servers freely, but every database must hold the same data. So look at what the requests ask it to do.',
          body: [
            { p: 'A <b>read</b> fetches data and changes nothing: a product page, a search. A <b>write</b> changes data: an order, a review.' },
            { p: `Most apps read far more than they write. In this shop, ${Math.round((1 - LOAD.reads.writes) * 10)} requests in 10 are reads. This <b>read-to-write ratio</b> is the first thing to ask about any data store, because reads and writes are scaled in different ways.` },
          ],
          takeaway: 'Ask how many requests read and how many write before you scale a database.',
          quiz: [1],
        },
        {
          title: 'How do copies of a database share the work?',
          hook: 'Reads change nothing, so any up-to-date copy can answer them.',
          body: [
            {
              figure: 'figReplicas',
              alt: 'The web server sends writes to the primary database and reads to two replicas. The primary sends every write on to each replica, in order.',
              caption: 'Writes go to the primary, reads go to the replicas',
            },
            { ul: [
              'The <b>primary</b> takes every write.',
              'A <b>replica</b> is a copy on its own server. The primary sends it every write, in the same order, so it holds the same data. This copying is <b>replication</b>.',
              'Replicas answer the reads.',
            ] },
            { p: `The servers sit in the same data center, where a round trip takes about ${ms(T.dc)}, so the extra hop costs almost nothing.` },
          ],
          takeaway: 'One primary takes the writes, and replicas copy it and answer the reads.',
          quiz: [0],
        },
        {
          title: 'How big must each replica be?',
          hook: 'A replica does two jobs: it answers its share of the reads, and it repeats every write the primary makes.',
          body: [
            {
              calc: {
                formula: 'Load on one replica = reads ÷ number of replicas + all the writes.',
                rows: [
                  { label: 'Its reads', work: `${fmt(ex.reads)} reads/s ÷ ${ex.replicas} replicas`, result: `${fmt(ex.reads / ex.replicas)} reads/s` },
                  { label: 'Plus the writes', work: `${fmt(ex.reads / ex.replicas)} reads/s + ${fmt(ex.writes)} writes/s`, result: `${fmt(ex.each)} queries/s` },
                  { label: 'How busy (L size)', work: `${fmt(ex.each)} queries/s ÷ ${fmt(L.cap)} queries/s`, result: `${percent(Math.round(ex.each / L.cap * 100) / 100)} busy`, approx: true },
                ],
                // "just fits": tests/unit/level-03-lesson.test.mjs checks it is under DB_BUSY on L and over it on M.
                result: `Each replica handles ${fmt(ex.each)} queries a second, which just fits an L server.`,
              },
            },
            { p: `A busy database is slow, like any server. In this level, keep every database under ${percent(DB_BUSY)} busy.` },
          ],
          takeaway: 'Each replica carries its share of the reads plus every write.',
          quiz: [6],
        },
        {
          title: 'What happens when a replica fails?',
          hook: 'Replicas cover for each other, the way web servers do.',
          body: [
            { table: { head: ['What fails', 'Where its reads go', 'What you do next'], rows: [
              ['One replica of several', 'To the replicas that are left', 'Start a new replica'],
              ['Your only replica', 'To the primary, for now', 'Start a new replica quickly'],
            ] } },
            { p: 'So plan a spare here too: the replicas left after a crash must carry all the reads. A new replica starts from a snapshot of the primary, then catches up on the writes it missed.' },
          ],
          takeaway: 'Losing a replica loses read capacity, not data.',
          quiz: [2, 3],
        },
      ],
      checks: [
        {
          q: `A shop has ${fmt(chk.reads)} reads/s and ${fmt(chk.writes)} writes/s, with ${chk.replicas} replicas. What does each replica handle?`,
          options: [
            { t: `${fmt(chk.reads / chk.replicas)} queries/s`, why: 'That is only its share of the reads. It also repeats every write.' },
            { t: `${fmt(chk.each)} queries/s`, right: true, why: `${fmt(chk.reads)} ÷ ${chk.replicas} = ${fmt(chk.reads / chk.replicas)} reads, plus all ${fmt(chk.writes)} writes.` },
            { t: `${fmt((chk.reads + chk.writes) / chk.replicas)} queries/s`, why: 'Writes are not shared out. Every replica applies every one of them.' },
          ],
        },
      ],
      youWill: [
        'add replicas and connect every web server to them',
        `size them so every database stays under ${percent(DB_BUSY)} busy, for at most $${fmt(BUDGET.replicas)} a month`,
        `keep Served at least ${targets.servedPct}% and Response under ${ms(targets.latencyMs)}`,
        `crash a replica and still serve at least ${targets.servedPct}%`,
      ],
      debrief: {
        saw: 'Reads spread over the replicas and the primary kept only the writes. A replica crashed and the others took its reads.',
        number: [`1 in ${writeShare(LOAD.reads)}`, 'requests that were writes'],
        next: `Shoppers are about to get carts, wishlists and reviews. Then 1 request in ${writeShare(LOAD.grown)} will be a write.`,
      },
    },
    {
      title: 'Writes catch up',
      mission: 1,
      minutes: 7,
      lead: 'New features mean more writes. Replicas were built for reads.',
      sections: [
        {
          title: 'How many writes a second is that?',
          hook: `Estimate the peak as before, then take the share that writes. A forum has ${count(est.users)} daily users who each make ${est.each} requests, and 1 request in ${est.share} is a write.`,
          body: [
            {
              calc: {
                formula: `Peak writes = daily users × requests each ÷ ${fmt(SECONDS_A_DAY)} × 2 × the share that writes.`,
                rows: [
                  { label: 'Requests a day', work: `${count(est.users)} users × ${est.each} requests`, result: `${count(est.day)} requests` },
                  { label: 'Average', work: `${count(est.day)} requests ÷ ${fmt(SECONDS_A_DAY)} s`, result: rate(est.avg) },
                  { label: 'Peak', work: `${rate(est.avg)} × 2`, result: rate(est.peak) },
                  { label: 'Writes', work: `${rate(est.peak)} ÷ ${est.share}`, result: `${fmt(est.writes)} writes/s` },
                ],
                result: `Plan for about ${fmt(est.writes)} writes and ${fmt(est.peak - est.writes)} reads a second.`,
              },
            },
          ],
          takeaway: 'Split the peak into reads and writes, because each is scaled differently.',
          quiz: [5],
        },
        {
          title: 'Why do more replicas not help with writes?',
          hook: `Take ${fmt(floor.reads)} reads and ${fmt(floor.writes)} writes a second, and keep adding replicas.`,
          body: [
            { table: { head: ['Replicas', 'Reads each', 'Writes each', 'Load on each'], num: true, rows: floorRows } },
            { p: `The reads are shared out. The writes are not: every replica repeats all ${fmt(floor.writes)}, or its copy would be wrong. So no replica ever drops below ${fmt(floor.writes)} queries a second, and the primary takes every write alone.` },
            { p: 'When writes outgrow the largest server, more copies cannot help. You have to split the data itself over several databases. That is Level 9.' },
          ],
          takeaway: 'Replicas scale reads, not writes.',
          quiz: [7],
        },
      ],
      checks: [
        {
          q: 'The primary is nearly full of writes. What helps?',
          options: [
            { t: 'Adding two more replicas', why: 'Replicas take reads. Every write still goes to the one primary, and each new replica must repeat them all.' },
            { t: 'A larger primary, for now', right: true, why: 'Only the primary takes writes, so only its size matters for them. Past the largest size, the data must be split.' },
          ],
        },
      ],
      youWill: [
        'estimate the peak writes per second (Play stays locked until you do)',
        `grow the database tier for at most $${fmt(BUDGET.writes)} a month`,
        `keep every database under ${percent(DB_BUSY)} busy`,
        `crash a replica and still serve at least ${targets.servedPct}%`,
      ],
      debrief: {
        saw: 'Each replica spent part of its capacity repeating writes, so it had less room for reads. The primary carried every write alone.',
        number: [`${fmt(LOAD.grown.qps * LOAD.grown.writes)} writes/s`, 'on the primary and on every replica'],
        next: 'Replicas cover for each other. Nothing covers for the primary. If it fails, nobody can place an order.',
      },
    },
    {
      title: 'The primary fails',
      mission: 2,
      minutes: 8,
      lead: 'There is one primary, so it is a single point of failure for every write.',
      sections: [
        {
          title: 'How to replace a failed primary',
          hook: 'A replica already holds the data. So make one of them the new primary. This is <b>promotion</b>.',
          body: [
            { ol: [
              '<b>Notice.</b> The primary stops answering.',
              '<b>Promote.</b> Pick the replica that is most up to date. It becomes the primary and starts taking writes.',
              '<b>Repoint.</b> The web servers send writes to it, and the other replicas copy from it.',
              '<b>Rejoin.</b> If the old primary comes back, it joins as a replica.',
            ] },
            { p: 'The whole switch is called <b>failover</b>. Real systems can do it automatically. In this level you do it by hand, to see each step.' },
          ],
          takeaway: 'When the primary fails, promote the most up-to-date replica.',
          quiz: [],
        },
        {
          title: 'Why can a new primary be missing orders?',
          hook: 'The primary tells the shopper "saved" first and copies the write to the replicas a moment later. That moment is the <b>replication lag</b>.',
          body: [
            {
              figure: 'figLag',
              alt: 'A shopper places order 501. The primary saves it and answers at once. The primary crashes before the copy reaches the replica, so the replica never receives order 501.',
              caption: 'A write confirmed on the primary but not yet copied',
            },
            { p: `Writes made in that gap exist only on the primary. If it dies, they are gone, even though the shopper was told "saved". (In the game the lag is ${T.lag} second${T.lag === 1 ? '' : 's'}.)` },
            { p: 'You can make the primary <b>wait</b> for one replica to confirm each write before it answers. Then nothing confirmed is lost, but every write is slower, and it stalls if that replica is slow. Not waiting is faster and risks the newest writes.' },
          ],
          takeaway: 'A replica can be slightly behind, so a failover can lose the newest writes.',
          quiz: [4, 9],
        },
        {
          title: 'Is a replica a backup?',
          hook: 'No. A replica copies everything the primary does, mistakes included.',
          body: [
            // "within about a second": tests/unit/level-03-lesson.test.mjs checks it against the game's replication lag.
            { p: 'If someone deletes the products table by mistake, every replica deletes it too, within about a second. Replicas protect you when a <b>machine</b> is lost. A <b>backup</b>, a snapshot kept from an earlier time, protects you when the <b>data</b> is damaged. You need both.' },
          ],
          takeaway: 'Replicas survive a lost machine, and only a backup survives a bad write.',
          quiz: [8],
        },
      ],
      checks: [
        {
          q: 'The primary waits for one replica to confirm each write before answering. What do you gain and what do you pay?',
          options: [
            { t: 'Faster writes, but more lost data', why: 'The other way round. Waiting makes each write slower.' },
            { t: 'No confirmed write is lost, but writes are slower', right: true, why: 'Two machines hold every confirmed write. The price is the wait, and a stall if that replica is slow.' },
          ],
        },
      ],
      youWill: [
        'crash the primary and see every write fail',
        'promote a replica to primary and restart the old one as a replica',
        'read what the log says about the newest writes',
        `finish with no single point of failure, for at most $${fmt(BUDGET.failover)} a month`,
      ],
    },
  ],
  wrap: {
    picture: 'figBuiltEnd',
    alt: 'The design you built: the web servers send writes to one primary database and reads to three replicas. The primary copies every write to each replica.',
    say: [
      '"Writes go to one primary, and reads are spread over replicas, because most requests are reads."',
      '"Each replica carries its share of the reads plus every write, so replicas scale reads only."',
      '"If the primary fails I promote the most up-to-date replica, and the newest writes may be lost."',
    ],
    numbers: [
      [percent(DB_BUSY), 'keep a database under this busy'],
      [ms(T.dc), 'round trip inside one data center'],
    ],
    loop: `The interview steps again: ${scope} (the read-to-write ratio and the peak writes), ${sketch} (primary and replicas), ${deep} (replica sizes), ${stress} (you crashed a replica, then the primary).`,
    broken: 'Most reads fetch the same popular products from disk again and again. Level 4 keeps them in memory with a cache.',
  },
};

/**
 * The finished design, shown on the intro and again on the wrap-up: one drawing, two svgs.
 * @param {Record<string, Function>} f the drawing helpers `drawFigures` is given
 * @param {SVGSVGElement} svg
 */
function drawBuilt(f, svg) {
  const { figNode, figArrow, figDefs, figLabel, figDash } = f;
  svg.textContent = ''; svg.setAttribute('viewBox', '0 0 640 580'); figDefs(svg);
  figNode(svg, 'users', 320, 50, 'Users', 'Browser + app');
  figNode(svg, 'lb', 150, 160, 'Load balancer', 'Active');
  figNode(svg, 'lb', 490, 160, 'Load balancer', 'Standby');
  figArrow(svg, 280, 80, 190, 130, 'requests', null, 252, 102, 'end');
  figArrow(svg, 244, 150, 396, 150, 'heartbeat', null, 320, 142, 'middle');
  figArrow(svg, 396, 170, 244, 170, '', null, 0, 0);
  figNode(svg, 'web', 150, 280, 'Web server', 'Private IP');
  figNode(svg, 'web', 490, 280, 'Web server', 'Private IP');
  figArrow(svg, 150, 190, 150, 250, '', null, 0, 0);
  figArrow(svg, 190, 190, 450, 250, '', null, 0, 0);
  // Writes converge on the primary; reads run down the sides to the replicas, outside the copy lines.
  figNode(svg, 'db', 320, 400, 'Primary DB', 'Every write');
  figArrow(svg, 200, 310, 270, 370, '', null, 0, 0);
  figArrow(svg, 440, 310, 370, 370, '', null, 0, 0);
  figLabel(svg, 320, 350, 'writes');
  figArrow(svg, 90, 310, 90, 500, 'reads', null, 98, 420);
  figArrow(svg, 550, 310, 550, 500, 'reads', null, 542, 420, 'end');
  figDash(svg, 'M320 430 V500');
  figDash(svg, 'M320 465 H110 V500');
  figDash(svg, 'M320 465 H530 V500');
  figLabel(svg, 332, 456, 'copies every write', 'start');
  for (const [i, x] of [110, 320, 530].entries()) figNode(svg, 'db', x, 530, `Replica ${i + 1}`, 'Reads');
}

/** @type {Level} */
export default {
  id: 3,
  saveKey: 'sdl-level3-v1',
  saveVersion: 3, // 2: break-it results are kept per mission; 3: which missions were opened from the lesson (`opened`)
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
    { id: 'b', type: 'db', x: 120, y: 384, size: START_DB_SIZE, kind: 'sql', role: 'primary' },
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
      title: 'Reads swamp the database', ref: 'Read replicas', qps: LOAD.reads.qps, writes: LOAD.reads.writes, budget: BUDGET.replicas,
      story: `example.com keeps growing: ${rate(LOAD.reads.qps)} at peak. Nine in ten requests only read data, such as product pages and search; one in ten writes, such as an order. The web servers cope. The one database does not: it is ${START_DB_SIZE}, the largest size, and ${percent(Math.round(LOAD.reads.qps / SIZES[START_DB_SIZE].cap * 100) / 100)} busy, so every query waits in line. Add read replicas: copies that take the reads, while the primary keeps every write.`,
      goals: [
        splitGoal, dbBusyGoal,
        servedGoal(targets), latGoal(targets), costGoal(BUDGET.replicas),
        { id: 'crash-replica', type: 'exp', text: 'Break it: crash a replica and still serve at least 99%' },
      ],
      hint: `Add a database: it becomes a read replica. Connect both web servers to it. The replicas share the ${fmt(LOAD.reads.qps * (1 - LOAD.reads.writes))} reads a second evenly, and each one also applies all ${fmt(LOAD.reads.qps * LOAD.reads.writes)} writes a second the primary makes. Select a replica to see both numbers. Each replica carries its share of the reads plus every write. Work out how big each must be to stay under ${percent(DB_BUSY)} busy.`,
      takeaway: 'Reads now spread over the replicas, and the primary only handles writes. When a replica crashed, the others took its reads: slower, but nothing failed. Each replica also applied every write. That was cheap while writes were few.',
    },
    {
      title: 'Writes catch up', ref: 'Replicas and writes', qps: LOAD.grown.qps, writes: LOAD.grown.writes, budget: BUDGET.writes,
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
        servedGoal(targets), latGoal(targets), costGoal(BUDGET.writes),
        { id: 'crash-replica', type: 'exp', text: 'Break it: crash a replica and still serve at least 99%' },
      ],
      hint: `Each replica carries its share of the reads plus every write. At ${fmt(LOAD.grown.qps * LOAD.grown.writes)} writes a second, an L replica (${fmt(L.cap)} queries/s) is half busy before it serves a single read, so use XL replicas. Then make sure the replicas left after a crash can still carry the reads.`,
      takeaway: 'More replicas spread the reads, but every replica still applies every write, and the primary takes them all alone. As writes grow, each replica has less room for reads. Replicas scale reads, not writes. Spreading writes takes sharding, in Level 9.',
    },
    {
      title: 'The primary fails', ref: 'Promoting a replica', qps: LOAD.grown.qps, writes: LOAD.grown.writes, budget: BUDGET.failover,
      story: 'Replicas cover for each other, but every write still goes to one primary. If it fails, nobody can place an order. Crash it, then promote a replica: it becomes the new primary and takes the writes. Read what the log says about the newest writes.',
      goals: [
        splitGoal, spofGoal(), dbBusyGoal,
        servedGoal(targets), latGoal(targets), costGoal(BUDGET.failover),
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
      { q: 'A shopper changes their delivery address. Where does the web server send that update?', o: ['To any replica, picked at random', 'To the primary database', 'To every replica at the same time', 'To the replica with the most capacity'], a: 1, e: 'Every change to the data (insert, update, delete) goes to the primary. The primary then sends it on to each replica. Replicas only serve reads.', r: 'How do copies of a database share the work?' },
      { q: 'Why do most designs run more replicas than primaries?', o: ['Replicas are cheaper machines to run', 'Each replica can accept writes as well', 'Most apps read far more than they write', 'A primary can only feed one replica'], a: 2, e: 'Reads usually outnumber writes by a wide margin: people browse far more than they buy or post. One primary handles the writes, and you add replicas to share the reads.', r: 'Why is the database full when the web servers are not?' },
      { q: 'You run three replicas and one of them crashes. What happens to its reads?', o: ['The two healthy replicas take them', 'They fail until the replica is back', 'The primary takes all reads from now on', 'They wait in a queue on the web server'], a: 0, e: 'Reads move to the healthy replicas, which each get a bigger share. You replace the broken replica; the new one copies the data, catches up and starts taking reads.', r: 'What happens when a replica fails?' },
      { q: 'Your only replica crashes. Where do reads go until it is replaced?', o: ['Nowhere: reads fail until it is back', 'To a replica of another app', 'To the web server\'s own copy', 'To the primary, for the time being'], a: 3, e: 'With no healthy replica left, the primary serves the reads as well as the writes for a while. Make sure it has room for that, and replace the replica soon.', r: 'What happens when a replica fails?' },
      { q: 'The primary fails and you promote a replica. Why might the newest orders be missing?', o: ['Promotion deletes the newest rows', 'The replica was behind the primary', 'Replicas only store reads, not orders', 'The load balancer dropped them'], a: 1, e: 'Replication is usually asynchronous: the primary confirms a write first, then sends it on. Writes it had confirmed but not yet sent never reached the replica, so they have to be recovered from the old primary.', r: 'Why can a new primary be missing orders?' },
      { q: '5,000,000 daily users make 30 requests each, and 1 in 10 is a write. Roughly how many writes per second at peak?', o: ['~35', '~174', '~347', '~3,470'], a: 2, e: '5M × 30 ÷ 86,400 ≈ 1,736 req/s on average, so peak ≈ 3,472 req/s. One in ten is a write: ≈ 347 writes/s. ~174 is the average write rate; ~3,470 is every request at peak.', r: 'How many writes a second is that?' },
      { q: 'At peak, 1,200 reads/s and 300 writes/s go to a primary with three replicas. How many queries/s does each replica handle?', o: ['400', '500', '1,500', '700'], a: 3, e: 'Each replica serves its share of the reads, 1,200 ÷ 3 = 400, and also applies every write the primary makes, 300. That is 700 queries/s each.', r: 'How big must each replica be?' },
      { q: 'The primary is 90% busy with writes. Will adding replicas help?', o: ['No: every write still goes to the primary', 'Yes: the replicas share the writes evenly', 'Yes: each replica takes some of the writes', 'Yes, once the replicas catch up with it'], a: 0, e: 'Replicas take reads, not writes. Every write still goes to the one primary, and each replica has to apply it too. To spread writes you split the data over several primaries: sharding.', r: 'Why do more replicas not help with writes?' },
      { q: 'Someone runs a DELETE that wipes the products table by mistake. What do the replicas do?', o: ['Keep the old rows, so you can restore them', 'Delete them too, within about a second', 'Refuse the change and alert the team', 'Wait for an admin to approve the change'], a: 1, e: 'A replica copies every change the primary makes, mistakes included. Replication protects you when a machine fails, not from bad writes. You still need backups.', r: 'Is a replica a backup?' },
      { q: 'A fire takes out the server room with the primary. The replicas run in another building. What did replication save?', o: ['Nothing, since the primary was lost', 'Only the reads from the last second', 'The data, apart from the newest writes', 'Every write, even those from the last second'], a: 2, e: 'The replicas hold a copy of the data in another place, so it survives. The exception is the writes the primary had not sent yet. Promote a replica and recover what you can.', r: 'Why can a new primary be missing orders?' },
    ],
  },

  lesson,

  // Lesson diagrams. `f` provides the engine's drawing helpers. Each figure sets its own viewBox.
  drawFigures(f) {
    const { $, svgEl, figNode, figArrow, figDefs, figLabel, figDash } = f;

    // One web server sends writes to the primary and reads to two replicas; the primary copies every write to both.
    const f1 = $('figReplicas'); f1.textContent = ''; f1.setAttribute('viewBox', '0 0 640 300'); figDefs(f1);
    figNode(f1, 'web', 320, 46, 'Web server', 'Private IP');
    figNode(f1, 'db', 104, 196, 'Primary', 'Every write');
    figNode(f1, 'db', 320, 196, 'Replica 1', 'Reads');
    figNode(f1, 'db', 536, 196, 'Replica 2', 'Reads');
    figArrow(f1, 260, 76, 150, 166, 'writes', null, 192, 116, 'end');
    figArrow(f1, 320, 76, 320, 166, 'reads', null, 330, 126);
    figArrow(f1, 380, 76, 490, 166, 'reads', null, 448, 116);
    figDash(f1, 'M104 226 V262 H536 V230');
    figDash(f1, 'M320 262 V230');
    figLabel(f1, 212, 284, 'every write, in order');

    // A timeline: the primary confirms order 501, then crashes before the copy leaves, so the replica never gets it.
    const f2 = $('figLag'); f2.textContent = ''; f2.setAttribute('viewBox', '0 0 640 270'); figDefs(f2);
    figLabel(f2, 620, 24, 'time →', 'end', 'tier-label');
    for (const { name, y, end } of [{ name: 'Shopper', y: 60, end: 620 }, { name: 'Primary', y: 150, end: 346 }, { name: 'Replica', y: 240, end: 620 }]) {
      figLabel(f2, 24, y + 4, name, 'start', 'tier-label');
      svgEl('line', { x1: 100, y1: y, x2: end, y2: y, class: 'tier-box' }, f2);
    }
    figArrow(f2, 150, 62, 205, 146, 'order 501', null, 160, 108, 'end');
    figArrow(f2, 220, 146, 275, 62, 'saved', null, 262, 110);
    figLabel(f2, 275, 180, 'copy not sent yet');
    figNode(svgEl('g', { class: 'fig-down' }, f2), 'db', 440, 150, 'Primary', 'Crashed');
    figLabel(f2, 440, 228, 'never gets order 501', 'start');

    drawBuilt(f, $('figBuilt'));
    drawBuilt(f, $('figBuiltEnd'));
  },
};
