// @ts-check
/** @import { Level, Goal, Lesson } from '../js/types.js' */
// Level 9: Scale the data tier with sharding.
// Everything specific to this level lives here: components, rules, missions, quiz and text.
import { fmt, percent, ms } from '../js/format.js';
import { SIZES, COMPONENTS } from '../js/engine/catalog.js';
import { servedGoal, latGoal, costGoal } from './shared/goals.js';
import { dns, lb, NO_DB_NOTE, autoscaleSubOf, scalingChoices, replicaDb, shards } from './shared/components.js';
import { dnsLookup, usersToLb, lbToWeb, webToReplicas, webToShards, lbBad } from './shared/connections.js';
import { lbText, replicaText, levelComplete } from './shared/text.js';
import { failText } from './shared/quiz.js';
import { dayTraffic } from './shared/workload.js';
import { STEPS } from './mock-steps.js';

const targets = { latencyMs: 150, servedPct: 99 };
/** Monthly budgets of Missions 1, 2 and 3, in dollars. */
const BUDGET = 2500;
const HOT_BUDGET = 3500;
const GROW_BUDGET = 3900;
/** The goal: no shard above this share busy. */
const SHARD_MAX = 0.7;
/** Database queries a second at the peak in Missions 1 and 2, and in Mission 3. */
const QPS = 3000;
const GROW_QPS = 4500;
/** Share of the queries that are writes. */
const WRITES = 0.6;
/** Share of all queries that go to the three very popular accounts (Missions 2 and 3). */
const HOT = 0.2;
/** Share of the queries (plays and likes) that need no joins (Mission 3). */
const NON_REL = 0.4;

// ---------------- Lesson ----------------
const [scope, sketch, deep, stress] = STEPS.map((step) => `<b>${step.name}</b>`);
const { L, XL } = SIZES;
const nosql = COMPONENTS.nosql;
// Shard-count example (ours): 2,500 queries/s on L shards: 800 × 0.7 = 560 usable, 2,500 ÷ 560 = 4.5, so 5 shards.
const ex = { load: 2500, size: L };
const exUsable = ex.size.cap * SHARD_MAX;
const exShards = Math.ceil(ex.load / exUsable);
// Check yourself: 9,000 queries/s on XL shards: 1,600 × 0.7 = 1,120 usable, 9,000 ÷ 1,120 = 8.04, so 9 shards.
const chk = { load: 9000, size: XL };
const chkUsable = chk.size.cap * SHARD_MAX;
const chkShards = Math.ceil(chk.load / chkUsable);
// "Which shard?" example: account 2,347 with 4 shards: 2,347 = 4 × 586 + 3, so shard 3.
const pick = { id: 2347, n: 4 };
const pickShard = pick.id % pick.n;
// Resharding example: 3 shards to 4 (the quiz uses 4 to 5). The pattern repeats every 3 × 4 = 12 keys;
// only keys 0, 1 and 2 have the same remainder both ways, so 9 of 12 = 75% move.
const move = { from: 3, to: 4 };
const moveCycle = move.from * move.to;
const moveStay = Array.from({ length: moveCycle }, (_, k) => k).filter((k) => k % move.from === k % move.to).length;
const moveShare = (moveCycle - moveStay) / moveCycle;

/** @type {Lesson} */
const lesson = {
  intro: {
    kicker: 'Level 9 · Part 1: Grow one app',
    title: 'Scale the data tier with sharding',
    story: `Listeners play, follow and like all day, so ${percent(WRITES)} of your database queries are now writes. Every write goes to one primary, and it is already the largest server you can rent. In this level you split the data itself.`,
    picture: 'figBuilt',
    alt: 'The finished design: web servers work out a shard from the account ID and send each query to one of several database shards. The most popular accounts have shards of their own. Plays and likes go to a separate NoSQL store.',
    outcomes: [
      'say when a database must be split',
      'work out which shard holds a row',
      'pick a shard key that spreads the load',
      'deal with a few very popular accounts',
      'name what sharding makes harder',
    ],
  },
  last: 'Level 8 moved slow work to a queue. One limit from Level 3 is still there: replicas scale reads, not writes, and every write still goes to one primary.',
  parts: [
    {
      title: 'Too many writes',
      mission: 0,
      minutes: 11,
      lead: 'You have scaled everything out except the place where data is written.',
      newParts: [
        { type: 'shards', before: 1, what: 'Several database servers, each holding part of the data.', does: 'Every shard has the same tables and its own share of the rows. Each query goes to the one shard that holds its rows.', game: 'You choose the number of shards, their size and the shard key.' },
      ],
      sections: [
        {
          title: 'Why can the database not just keep growing?',
          hook: 'You have two tools for a full database so far, and both have run out.',
          body: [
            { ul: [
              '<b>A bigger server.</b> There is a largest size, the price climbs steeply, and it is still one machine that can fail.',
              '<b>More replicas.</b> They take reads. Every write still goes to the one primary, and every replica has to repeat it.',
            ] },
            { p: 'When writes alone are more than the largest server can take, the only move left is to stop keeping all the data in one place.' },
          ],
          takeaway: 'Bigger servers have a ceiling, and replicas do not take writes.',
          quiz: [0],
        },
        {
          title: 'How does sharding split a database?',
          hook: '<b>Sharding</b> cuts one big database into several smaller ones, called <b>shards</b>. Each shard holds part of the rows and takes the reads and writes for those rows only.',
          body: [
            {
              figure: 'figShards',
              alt: 'A rule, account ID modulo 4, sends each account to one of four shards. Every shard has the same table, with different rows: shard 0 holds accounts 4, 8 and 12, shard 1 holds 5, 9 and 13, and so on.',
              caption: 'The same tables on every shard, different rows on each',
            },
            { p: 'A <b>shard key</b> decides where a row lives. A simple rule: divide the key by the number of shards and take the remainder, written <code>key % N</code>.' },
            {
              calc: {
                formula: `Shard = account ID % number of shards. Account ${fmt(pick.id)}, with ${pick.n} shards:`,
                rows: [
                  { label: 'Divide', work: `ID ${fmt(pick.id)} ÷ ${pick.n} shards`, result: `${Math.floor(pick.id / pick.n)}, remainder ${pickShard}` },
                ],
                result: `Account ${fmt(pick.id)} lives on shard ${pickShard}. Every query for it goes there and nowhere else.`,
              },
            },
          ],
          takeaway: 'A shard key and a simple rule send each row to exactly one shard.',
          quiz: [1, 2],
        },
        {
          title: 'Which shard key should you pick?',
          hook: 'The key decides how evenly the load is spread. A bad key puts most of the work on one shard, and that shard fails first.',
          body: [
            { table: { head: ['Shard by', 'What happens'], rows: [
              ['<b>Account ID</b>', 'Millions of accounts, spread evenly. Each shard gets an equal share.'],
              ['<b>Country</b>', 'One big country means one overloaded shard.'],
              ['<b>Sign-up date</b>', 'If each shard holds a range of dates, new accounts, the busiest, all land on the newest shard.'],
            ] } },
            { p: 'A good key has many different values, spreads queries evenly, and is part of almost every query, so the web server always knows which shard to ask.' },
          ],
          takeaway: 'Pick a key with many values that spreads queries evenly.',
          quiz: [3, 4],
        },
        {
          title: 'How many shards do you need?',
          hook: `A database gets ${fmt(ex.load)} queries a second. Keep every shard under ${percent(SHARD_MAX)} busy.`,
          body: [
            {
              calc: {
                formula: 'Shards = queries a second ÷ (capacity of one shard × busy limit), rounded up.',
                rows: [
                  { label: 'Usable per shard', work: `${fmt(ex.size.cap)} queries/s × ${SHARD_MAX}`, result: `${fmt(exUsable)} queries/s` },
                  { label: 'Shards', work: `${fmt(ex.load)} queries/s ÷ ${fmt(exUsable)} queries/s`, result: `${(ex.load / exUsable).toFixed(1)}, so ${exShards} shards` },
                ],
                result: `${exShards} shards of the L size. The sum only holds if the key spreads the queries evenly.`,
              },
            },
          ],
          takeaway: 'Divide the load by the usable share of one shard, and round up.',
          quiz: [9],
        },
      ],
      checks: [
        {
          q: `A database gets ${fmt(chk.load)} queries a second. One XL shard takes ${fmt(chk.size.cap)} and should stay under ${percent(SHARD_MAX)} busy. How many shards?`,
          options: [
            { t: `${Math.ceil(chk.load / chk.size.cap)}`, why: `That fills every shard to 100%. Count ${percent(SHARD_MAX)} of each: ${fmt(chkUsable)} queries/s.` },
            { t: `${chkShards - 1}`, why: `${fmt(chk.load)} ÷ ${fmt(chkUsable)} is just over ${chkShards - 1}. Round up.` },
            { t: `${chkShards}`, right: true, why: `${fmt(chk.load)} ÷ ${fmt(chkUsable)} = ${(chk.load / chkUsable).toFixed(2)}, rounded up to ${chkShards}.` },
          ],
        },
      ],
      youWill: [
        'estimate the shards you need (Play stays locked until you do)',
        'replace the primary and its replica with a sharded database',
        `choose a shard key that keeps every shard under ${percent(SHARD_MAX)} busy`,
        `keep Response under ${ms(targets.latencyMs)} for at most $${fmt(BUDGET)} a month`,
      ],
      debrief: {
        saw: 'Each shard took an equal share of the writes. With the wrong key, one shard got far more than its share.',
        number: [percent(SHARD_MAX), 'the most any shard should be busy'],
        next: 'Three creators with more than 50 million followers each are about to join, and their accounts will land on the same shard.',
      },
    },
    {
      title: 'Three famous creators',
      mission: 1,
      minutes: 5,
      lead: 'An even key spreads accounts evenly. It does not make accounts equal.',
      sections: [
        {
          title: 'Why is one shard overloaded when the key is good?',
          hook: 'Because a few accounts get far more traffic than all the others. A row that takes a large share of all queries is a <b>hot key</b>.',
          body: [
            {
              figure: 'figHot',
              alt: 'Before: three very popular accounts sit on shard 1, which is far over its limit while the other shards have room. After: each popular account has a small shard of its own, and every shard is under the limit.',
              caption: 'Three hot accounts on one shard, then one shard each',
            },
            { p: 'More shards do not help. One account always lives on one shard, so its whole load lands there, and several hot accounts can share a shard by bad luck.' },
            { p: 'The usual fix is to give each very hot account a <b>shard of its own</b>, sized for that account. The web servers keep a short list of these accounts and check it before applying the normal rule.' },
          ],
          takeaway: 'A hot key overloads its shard however many shards you have, so give it its own.',
          quiz: [5],
        },
      ],
      checks: [
        {
          q: 'One account takes 15% of all queries. You go from 4 shards to 8. How much of that account\'s load is on its shard now?',
          options: [
            { t: 'Half as much', why: 'Only the other accounts are divided. One account cannot be split by adding shards.' },
            { t: 'All of it, as before', right: true, why: 'An account lives on exactly one shard, so its 15% stays together.' },
          ],
        },
      ],
      youWill: [
        'see one shard overloaded by three accounts',
        'give each very popular account a shard of its own',
        `keep every shard under ${percent(SHARD_MAX)} busy for at most $${fmt(HOT_BUDGET)} a month`,
      ],
      debrief: {
        saw: 'The hot accounts each got a shard, and no shard was near its limit.',
        number: [percent(HOT), 'of all queries went to three accounts'],
        next: `Traffic is growing to ${fmt(GROW_QPS)} queries a second. The shards are filling up again.`,
      },
    },
    {
      title: 'Running out of room',
      mission: 2,
      minutes: 9,
      lead: 'The obvious answer is one more shard. Look at what that costs first.',
      newParts: [
        { type: 'nosql', before: 2, what: 'A store that keeps each item under a key, with no joins.', does: 'Reads and writes single items by key, very fast. It scales out by adding machines.', game: `$${nosql.cost} a month. Takes ${fmt(nosql.cap)} lookups/s, ${ms(nosql.base)} each.` },
      ],
      sections: [
        {
          title: 'What does adding a shard cost?',
          hook: `The rule is <code>key % N</code>. Change N from ${move.from} to ${move.to} and the remainder changes for most keys.`,
          body: [
            { table: { head: ['Key', `% ${move.from}`, `% ${move.to}`, 'Moves?'], num: true, rows: [0, 1, 2, 3, 4, 5].map((k) => [`${k}`, `${k % move.from}`, `${k % move.to}`, k % move.from === k % move.to ? 'no' : 'yes']) } },
            {
              calc: {
                formula: `Count the keys that keep their shard, over every ${moveCycle} keys in a row:`,
                rows: [
                  { label: 'Stay', work: `keys 0, 1 and 2 of every ${moveCycle} keys`, result: `${moveStay} keys` },
                  { label: 'Move', work: `${moveCycle} keys − ${moveStay} keys`, result: `${moveCycle - moveStay} keys = ${percent(moveShare)}` },
                ],
                result: `One extra shard moves ${percent(moveShare)} of all rows to a different server, while the database is in use.`,
              },
            },
            { p: 'Moving most of the data is slow and risky. Level 11 shows a rule that moves far less.' },
          ],
          takeaway: 'With key % N, one extra shard moves most of the data.',
          quiz: [6],
        },
        {
          title: 'What else gets harder after sharding?',
          hook: 'A join combines rows from two tables in one query. After sharding, those rows may be on two different servers.',
          body: [
            { p: 'A query that names the shard key goes to one shard and is as fast as before. A query that does not must ask every shard and merge the answers.' },
            { p: 'The common workaround is to <b>denormalise</b>: store a copy of the data a query needs next to the row it is read with, so one shard can answer alone. You trade extra storage and extra writes for single-shard reads.' },
            { p: 'So shard late. It is the right tool when writes outgrow one server, and not before.' },
          ],
          takeaway: 'Sharding makes joins and resharding expensive, so use it only when you must.',
          quiz: [7],
        },
        {
          title: 'Which data can leave the relational database?',
          hook: 'Not everything needs joins. Play counts and likes are single numbers, read and written by their key.',
          body: [
            { table: { head: ['Kind of NoSQL store', 'Keeps', 'Good for'], rows: [
              ['<b>Key-value</b>', 'One value under one key', 'Counters, likes, sessions'],
              ['<b>Document</b>', 'A whole record, such as a profile, fetched in one piece', 'Records that stand alone'],
              ['<b>Column</b>', 'Rows with very many columns, across many machines', 'Huge histories: messages, events'],
              ['<b>Graph</b>', 'Things and the links between them', 'Who follows whom'],
            ] } },
            { p: 'Data like this can move to a NoSQL store. The shards get their room back, and not one row moves between them.' },
          ],
          takeaway: 'Move data that needs no joins out, and keep the linked data relational.',
          quiz: [8],
        },
      ],
      checks: [
        {
          q: 'You go from key % 2 to key % 3. About what share of the rows moves?',
          options: [
            { t: 'A third', why: 'That is the new shard\'s fair share, but the rule also reshuffles rows between the old shards.' },
            { t: 'Two thirds', right: true, why: 'Of every 6 keys, only keys 0 and 1 keep their shard. The other 4 move.' },
            { t: 'None', why: 'The remainder changes for most keys when N changes.' },
          ],
        },
      ],
      youWill: [
        'add a NoSQL store and send plays and likes to it',
        `keep every shard under ${percent(SHARD_MAX)} busy for at most $${fmt(GROW_BUDGET)} a month`,
        'press Add a shard and see how much data that would have moved',
      ],
    },
  ],
  wrap: {
    picture: 'figBuiltEnd',
    alt: 'The design you built: web servers work out a shard from the account ID and send each query to one of several database shards. The most popular accounts have shards of their own. Plays and likes go to a separate NoSQL store.',
    say: [
      '"Replicas do not scale writes, so I shard the database by a key that spreads load evenly."',
      '"A very hot account gets a shard of its own."',
      '"Sharding makes joins and resharding expensive, so data that needs no joins goes to a key-value store."',
    ],
    numbers: [
      [percent(SHARD_MAX), 'the most any shard should be busy'],
      [percent(moveShare), `of rows move when ${move.from} shards become ${move.to} with key % N`],
    ],
    loop: `The interview steps again: ${scope} (the shards you need), ${sketch} (sharded database and a NoSQL store), ${deep} (the shard key and the hot accounts), ${stress} (you added a shard and counted what moved). This ends Grow one app. Before the quiz, draw the whole design from memory: DNS, CDN, load balancers, stateless web servers, cache, queue and workers, shards.`,
    broken: 'Anyone can still send your API as many requests as they like, and one bot can use up what you built. Level 10 puts a limit on each client.',
  },
};

/**
 * The finished design, drawn for the intro and again for the wrap-up: web servers find each account's shard, the
 * very popular accounts have shards of their own, and plays and likes go to a NoSQL store. No shard count is shown,
 * because Mission 1 asks the player to work it out.
 * @param {Record<string, Function>} f the drawing helpers `drawFigures` is given
 * @param {SVGSVGElement} svg
 */
function drawBuilt(f, svg) {
  const { svgEl, figNode, figArrow, figSvg, figLabel } = f;
  figSvg(svg, 460);
  figNode(svg, 'users', 160, 46, 'Users', 'Listen and upload');
  figNode(svg, 'lb', 160, 156, 'Load balancer', 'Shares requests');
  figNode(svg, 'web', 160, 266, 'Web servers', 'Find the shard');
  figNode(svg, 'nosql', 480, 266, 'NoSQL store', 'Plays and likes');
  svgEl('rect', { x: 10, y: 330, width: 620, height: 120, rx: 12, class: 'tier-box' }, svg);
  figLabel(svg, 24, 350, 'Sharded database', 'start', 'tier-label');
  figNode(svg, 'shards', 160, 406, 'Shards', 'account_id % N');
  figNode(svg, 'shards', 480, 406, 'Hot accounts', 'A shard each');
  figArrow(svg, 160, 76, 160, 126, 'requests', null, 172, 106);
  figArrow(svg, 160, 186, 160, 236, '', null, 0, 0);
  figArrow(svg, 254, 266, 386, 266, 'plays, likes', null, 320, 258, 'middle');
  figArrow(svg, 160, 296, 160, 376, 'queries', null, 172, 318);
  figArrow(svg, 230, 296, 420, 376, 'hot accounts', null, 318, 316);
}

/** @type {Goal} */
const shardGoal = {
  id: 'shards', type: 'metric', text: `No database shard above ${Math.round(SHARD_MAX * 100)}% busy`,
  test: (m) => m.maxShardUtil != null && m.maxShardUtil < SHARD_MAX,
  val: (m) => (m.maxShardUtil == null ? '—' : Math.round(m.maxShardUtil * 100) + '%'),
};
/** @type {Goal} */
const noSqlGoal = { id: 'nosql', type: 'struct', text: 'Plays and likes go to a NoSQL store', test: (g) => g.onPath('nosql').length > 0, val: () => '' };

/** @type {Level} */
export default {
  id: 9,
  saveKey: 'sdl-level9-v1',
  saveVersion: 2, // 2: which missions were opened from the lesson (`opened`)
  targets,
  // The day's traffic curve, for the cost of the autoscaled web servers.
  workload: { day: dayTraffic() },

  components: {
    users: {
      name: 'Users', sub: 'Listen and upload',
      desc: 'Listeners and creators. Every page reads or writes account data: profiles, follows, plays and likes. 60% of the queries are writes.',
    },
    dns: dns(),
    lb: lb(),
    web: {
      name: 'Web server', short: 'Your back-end code',
      desc: 'Runs your back-end code: each page makes one database query. These are autoscaled groups of M servers, as in Level 6.',
      noDbNote: NO_DB_NOTE,
      subOf: autoscaleSubOf,
      choices: scalingChoices(),
    },
    db: replicaDb(),
    shards: shards(),
    nosql: {
      name: 'NoSQL store', short: 'Plays and likes', sub: 'Managed · $200',
      desc: 'A key-value store for data that needs no joins: play counts and likes, read and written by key. It is easy to scale by adding machines. A managed service in this game: 20,000 lookups/s, 3 ms each, $200/month.',
    },
  },
  palette: ['dns', 'lb', 'web', 'db', 'shards', 'nosql'],
  limits: { dns: 1, lb: 1, web: 2, db: 2, shards: 1, nosql: 1 },
  limitMsg: {
    dns: 'You only need one DNS service.',
    lb: 'One load balancer is enough in this level.',
    web: 'Two autoscaled web server groups are enough: they grow on their own.',
    db: 'Two databases is the limit: a primary and a replica.',
    shards: 'One sharded database is enough: choose how many shards it has in the inspector.',
    nosql: 'One NoSQL store is enough.',
  },
  // Inside one data center: autoscaled web servers and Level 3's primary and replica.
  startNodes: [
    { id: 'u', type: 'users', x: 380, y: 60 },
    { id: 'd', type: 'dns', x: 120, y: 60 },
    { id: 'l', type: 'lb', x: 380, y: 168, algo: 'rr' },
    { id: 'w1', type: 'web', x: 250, y: 276, size: 'M', scaling: 'auto' },
    { id: 'w2', type: 'web', x: 510, y: 276, size: 'M', scaling: 'auto' },
    { id: 'b', type: 'db', x: 120, y: 440, size: 'XL', kind: 'sql', role: 'primary' },
    { id: 'r', type: 'db', x: 380, y: 440, size: 'XL', kind: 'sql', role: 'replica' },
  ],
  startEdges: [
    { id: 's1', from: 'u', to: 'd' }, { id: 's2', from: 'u', to: 'l' },
    { id: 's3', from: 'l', to: 'w1' }, { id: 's4', from: 'l', to: 'w2' },
    { id: 's5', from: 'w1', to: 'b' }, { id: 's6', from: 'w2', to: 'b' }, { id: 's7', from: 'w1', to: 'r' }, { id: 's8', from: 'w2', to: 'r' },
  ],
  slots: {
    dns: { x: 120, y: 60 }, lb: { x: 380, y: 168 }, web: { x: 510, y: 276 },
    db: [{ x: 120, y: 440 }, { x: 380, y: 440 }],
    shards: [{ x: 640, y: 440 }, { x: 380, y: 440 }, { x: 120, y: 440 }],
    nosql: { x: 640, y: 168 },
  },

  connections: {
    ok: {
      'dns|users': dnsLookup(),
      'lb|users': usersToLb(),
      'lb|web': lbToWeb(),
      'db|web': webToReplicas(),
      'shards|web': webToShards(),
      'nosql|web': { from: 'web', to: 'nosql', label: 'plays, likes', desc: 'Play counts and likes (40% of the queries) go to the NoSQL store, by key. The other queries still go to the database.' },
    },
    bad: {
      ...lbBad(),
      'shards|users': 'Users reach the web servers through the load balancer. Connect the web servers to the sharded database.',
      'lb|shards': 'The load balancer sends requests to web servers. Connect the web servers to the sharded database.',
      'db|shards': 'The sharded database replaces the single primary; it doesn\'t sit behind it. Connect the web servers to it, and remove the old databases.',
      'nosql|users': 'Users reach the web servers through the load balancer. Connect the web servers to the NoSQL store.',
      'lb|nosql': 'The load balancer sends requests to web servers. Connect the web servers to the NoSQL store.',
      'db|nosql': 'The NoSQL store is a separate store the web servers query directly. Connect the web servers to it.',
      'nosql|shards': 'The NoSQL store is a separate store the web servers query directly. Connect the web servers to it.',
      'dns|shards': 'DNS answers name lookups for users. Connect the web servers to the sharded database.',
      'dns|nosql': 'DNS answers name lookups for users. Connect the web servers to the NoSQL store.',
    },
  },

  missions: [
    {
      title: 'Too many writes', ref: 'Sharding', qps: QPS, writes: WRITES, budget: BUDGET,
      gate: {
        hidesTraffic: false,
        lo: 2.6, hi: 3,
        prompt: '<b>Estimate before you build.</b> At peak the database gets 3,000 queries a second. An XL database server takes 1,600 a second, and each shard should stay under 70% busy. How many XL shards do you need at least?',
        label: 'Shards',
        placeholder: 'e.g. 2',
        acceptedHtml: '<p><b>Estimate accepted.</b></p><div class="calc">70% of 1,600 = 1,120 queries/s per shard<br>3,000 ÷ 1,120 ≈ 2.7, so 3 shards<br>That holds only if the key spreads queries evenly</div>',
        acceptedLog: 'Estimate accepted: 3 XL shards, if the key spreads queries evenly. Play is unlocked.',
        notNumber: 'Type the estimate as a number of shards, for example 2.',
        hints: [
          { test: (v) => v >= 1.8 && v <= 2, text: 'That runs every shard at 100% busy. Divide by 70% of 1,600: 1,120.' },
          { test: (v) => v === 4, text: 'Four works, but fewer do too. Divide 3,000 by 1,120 and round up.' },
        ],
        fallback: 'Not quite. Divide 3,000 queries a second by 1,120, the most one shard should take, and round up.',
      },
      story: `${percent(WRITES)} of the database's ${fmt(QPS)} queries a second are writes: plays, follows and likes. Every write goes to the one primary, which can take ${fmt(XL.cap)} a second, and a read replica can't take writes. Split the data over several database servers, and choose a shard key that keeps every shard under ${percent(SHARD_MAX)} busy.`,
      goals: [{ id: 'est', type: 'gate', text: 'Estimate the shards you need' }, shardGoal, servedGoal(targets), latGoal(targets), costGoal(BUDGET)],
      hint: 'Add a sharded database, connect both web servers to it, and remove the primary and the replica. Pick account_id as the shard key: the other keys pile queries onto one shard. Three XL shards are enough.',
      takeaway: 'Each shard now takes a third of the writes. The shard key mattered as much as the number of shards: by country or by sign-up date, one shard got far more than its share.',
    },
    {
      title: 'Three famous creators', ref: 'Hotspots', qps: QPS, writes: WRITES, hot: HOT, budget: HOT_BUDGET,
      story: `Three creators with more than 50 million followers each joined, and their accounts all landed on the same shard. Their profiles and episode lists now take ${percent(HOT)} of all queries, all on that one shard. Keep every shard under ${percent(SHARD_MAX)} busy.`,
      goals: [shardGoal, servedGoal(targets), latGoal(targets), costGoal(HOT_BUDGET)],
      hint: 'More shards don\'t help: the three accounts still share one. Select the sharded database and give each very popular account a shard of its own.',
      takeaway: 'The hot accounts now have a shard each, and no shard is near its limit. Real systems sometimes split a single huge account further still.',
    },
    {
      title: 'Running out of room', ref: 'Resharding', qps: GROW_QPS, writes: WRITES, hot: HOT, nonRel: NON_REL, budget: GROW_BUDGET,
      story: `Traffic grew to ${fmt(GROW_QPS)} queries a second. Plays and likes are ${percent(NON_REL)} of them, and they need no joins: they are just counters read and written by key. Move them to a NoSQL store so the shards have room again, then see what adding a shard would have cost.`,
      goals: [
        noSqlGoal, shardGoal, servedGoal(targets), latGoal(targets), costGoal(GROW_BUDGET),
        { id: 'reshard', type: 'exp', text: 'Break it: add one more shard and see how much data moves' },
      ],
      hint: 'Add a NoSQL store and connect both web servers to it. Then press "Add a shard" to see what resharding with % N would move.',
      takeaway: 'Moving the counters out took 40% of the load off the shards without moving a single row between them. Adding a shard with % N would have moved most of the data. A later level shows a way to add servers and move far less.',
    },
  ],

  // Break-it experiments. An event only checks its outcome.
  experiments: [
    {
      id: 'reshard', kind: 'event',
      label: 'Add a shard', labelOn: 'Done',
      needsDesign: 'Build the design first: shard the database, then add a shard.',
      on: 'Adding a shard: every account_id is placed again with the new N.', onTone: '',
      off: 'Back to the current shards.',
      expect: (m) => m.shardCount > 0,
      notMet: 'There is no sharded database yet. Add one, and connect the web servers to it.',
      observed: (m) => {
        const n = m.shardCount;
        return `Observed: going from ${n} to ${n + 1} shards, account_id % ${n + 1} puts ${Math.round(100 * n / (n + 1))}% of accounts on a different shard than % ${n}. All of that data must be copied while the site keeps running.`;
      },
    },
  ],

  // Messages the engine shows for this level's design.
  text: {
    ...lbText(),
    ...replicaText(),
    levelComplete: levelComplete(9),
  },

  quiz: {
    passScore: 8,
    passText: 'Level 9 is done, and with it the first part: scaling from one server to millions of users. Level 10, Rate limiter, is next: open it from the level menu at the top.',
    failText,
    questions: [
      { q: 'Why not just keep buying a bigger database server?', o: ['Bigger servers cannot run SQL', 'They hit a size limit and cost far more', 'A bigger server adds network lag to every query', 'Replicas stop working on big servers'], a: 1, e: 'Vertical scaling hits a hardware limit, the biggest server you can buy, and powerful servers cost much more for each unit of capacity. One server is also a single point of failure.', r: 'Why can the database not just keep growing?' },
      { q: 'What does a shard hold?', o: ['A full copy of all the data, kept for reads only', 'The indexes of every table', 'Part of the rows, in the same tables', 'Only the writes of the last hour'], a: 2, e: 'Each shard has the same schema but holds different rows: the ones its shard key maps to it. A full copy for reads is a replica.', r: 'How does sharding split a database?' },
      { q: 'With account_id % 4, which shard holds account 1006?', o: ['Shard 0', 'Shard 1', 'Shard 2', 'Shard 6'], a: 2, e: '1006 ÷ 4 = 251, remainder 2, so shard 2.', r: 'How does sharding split a database?' },
      { q: 'What makes a good shard key?', o: ['It spreads data and queries evenly', 'It is short to store', 'It changes often', 'It sorts rows by date, for fast range queries'], a: 0, e: 'The most important criterion is an even spread, so no shard gets more than its share. A key with few values, or one where new rows all land in one range, makes hotspots.', r: 'Which shard key should you pick?' },
      { q: 'You shard by country, and 42% of queries come from one country. What happens?', o: ['Queries spread evenly anyway', 'The database refuses the key', 'Each country is split evenly across all the shards', 'One shard is far busier than the rest'], a: 3, e: 'A country can\'t be split, so its shard takes 42% of the queries however many shards you add.', r: 'Which shard key should you pick?' },
      { q: 'Three huge accounts land on one shard and overload it. What is a common fix?', o: ['Give each of them a shard of its own', 'Add more shards and hope they move apart', 'Move every account to a NoSQL store', 'Put that shard behind the load balancer'], a: 0, e: 'Hot accounts can get dedicated shards, and a single very hot one may be split further. More shards with the same key don\'t guarantee the hot accounts move apart.', r: 'Why is one shard overloaded when the key is good?' },
      { q: 'You go from key % 4 to key % 5. About what share of the data moves?', o: ['20%', '50%', '80%', '100%'], a: 2, e: 'A key stays only where key % 4 equals key % 5: 4 of every 20 keys. The other 80% move. Consistent hashing reduces this.', r: 'What does adding a shard cost?' },
      { q: 'Why are joins hard after sharding?', o: ['SQL databases switch joins off once tables are sharded', 'The rows to join may be on different servers', 'Shards are read-only', 'Joins need a load balancer'], a: 1, e: 'Rows that belong together may live on different shards, and a join across servers is slow and complex. A common workaround is to denormalize, so a query reads one table.', r: 'What else gets harder after sharding?' },
      { q: 'Which data is the best fit to move from the relational database to a NoSQL store?', o: ['Orders that must join to payments', 'Monthly reports that join every table in the database', 'Account settings joined to plans', 'Like counts read and written by key'], a: 3, e: 'Data that needs no joins and is accessed by key, such as counters, moves easily to a key-value store and takes load off the database.', r: 'Which data can leave the relational database?' },
      { q: 'A database gets 6,000 queries/s. Each shard takes 2,000/s and should stay under 75% busy. How many shards, evenly loaded?', o: ['3', '5', '6', '4'], a: 3, e: '75% of 2,000 = 1,500 per shard. 6,000 ÷ 1,500 = 4 shards. Three would run every shard at 100%.', r: 'How many shards do you need?' },
    ],
  },

  lesson,

  // Lesson diagrams. `f` provides the engine's drawing helpers. Each figure sets its own viewBox.
  drawFigures(f) {
    const { $, svgEl, figNode, figArrow, figSvg, figLabel } = f;

    // account_id % 4 sends each account to one of four shards; every shard has the same table, different rows.
    const f1 = figSvg($('figShards'), 362);
    figNode(f1, 'web', 110, 181, 'Web servers', 'account_id % 4');
    [0, 1, 2, 3].forEach((s) => {
      const y = 46 + s * 90;
      figNode(f1, 'shards', 480, y, `Shard ${s}`, `Rows ${[1, 2, 3].map((k) => s + 4 * k).join(', ')}, …`);
      figArrow(f1, 204, 181, 386, y, `% 4 = ${s}`, null, 376, s < 2 ? y - 10 : y + 20, 'end');
    });

    // How busy each shard is, from the Mission 2 traffic on three XL shards: the hot accounts' share lands on
    // shard 1 (before), then on three shards of their own (after). The dashed line is the busy limit.
    const f2 = figSvg($('figHot'), 428);
    const busy = (share) => (share * QPS) / XL.cap;
    const even = busy((1 - HOT) / 3);
    const bar = (name, u) => ({ name, u });
    const panels = [
      { y: 10, label: 'Before: three hot accounts on shard 1', bars: [bar('Shard 0', even), bar('Shard 1', even + busy(HOT)), bar('Shard 2', even)] },
      { y: 222, label: 'After: a shard for each hot account', bars: [bar('Shard 0', even), bar('Shard 1', even), bar('Shard 2', even), bar('Hot 1', busy(HOT / 3)), bar('Hot 2', busy(HOT / 3)), bar('Hot 3', busy(HOT / 3))] },
    ];
    for (const { y, label, bars } of panels) {
      svgEl('rect', { x: 10, y, width: 620, height: 196, rx: 12, class: 'tier-box' }, f2);
      figLabel(f2, 24, y + 20, label, 'start', 'tier-label');
      const base = y + 170, Y = (u) => base - u * 120;
      bars.forEach(({ name, u }, i) => {
        const x = 70 + i * 80;
        svgEl('rect', { x, y: Y(u), width: 56, height: base - Y(u), class: u > SHARD_MAX ? 'ch-cap' : 'ch-area' }, f2);
        figLabel(f2, x + 28, base + 18, name, 'middle', 'ch-t');
        if (u > SHARD_MAX) figLabel(f2, x + 66, Y(u) + 4, 'over the limit', 'start', 'ch-cap-t');
      });
      svgEl('line', { x1: 56, y1: base, x2: 610, y2: base, class: 'ch-axis' }, f2);
      svgEl('line', { x1: 56, y1: Y(SHARD_MAX), x2: 610, y2: Y(SHARD_MAX), class: 'ch-axis d-dash' }, f2);
      figLabel(f2, 610, Y(SHARD_MAX) - 6, `${percent(SHARD_MAX)} busy limit`, 'end', 'ch-t');
    }

    drawBuilt(f, $('figBuilt'));
    drawBuilt(f, $('figBuiltEnd'));
  },
};
