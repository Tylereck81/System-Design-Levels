// @ts-check
/** @import { Level, Goal, Lesson } from '../js/types.js' */
// Level 11: Consistent hashing.
// Everything specific to this level lives here: components, rules, missions, quiz and text.
import { fmt, percent, ms, count } from '../js/format.js';
import { COMPONENTS } from '../js/engine/catalog.js';
import { servedGoal, latGoal, costGoal, servedAtLeast, fmtPct } from './shared/goals.js';
import { serverNames, ringPoints, keyShares } from '../js/engine/hashring.js';
import { dns, lb, NO_DB_NOTE, autoscaleSubOf, scalingChoices, db } from './shared/components.js';
import { dnsLookup, usersToLb, lbToWeb, webToDb, lbBad } from './shared/connections.js';
import { lbText, levelComplete } from './shared/text.js';
import { failText, passText } from './shared/quiz.js';
import { dayTraffic } from './shared/workload.js';
import { STEPS } from './mock-steps.js';

const targets = { latencyMs: 150, servedPct: 99 };
const PCT = { scale: 100 }; // percentages are given as 0–1 shares
/** Monthly budgets: Missions 1 and 2, and Mission 3, in dollars. */
const BUDGET = 1400;
const SALE_BUDGET = 1700;
/** Requests a second: Missions 1 and 2, and the sale in Mission 3. */
const QPS = 2000;
const SALE_QPS = 4000;
/** The most keys a Break-it change may move, and the most the busiest cache server may be above the average. */
const MOVE_MAX = 0.25;
const SPREAD_MAX = 0.1;

// ---------------- Lesson ----------------
const [scope, sketch, deep, stress] = STEPS.map((step) => `<b>${step.name}</b>`);
const ring = COMPONENTS.ring;
// Rehashing example (ours): 8 servers become 7 (Mission 1 asks about 5 to 4, the quiz about 6 to 5). A key keeps its
// server only if hash % 8 and hash % 7 agree: values 0 to 6 of every 8 × 7 = 56, so 7 stay and 49 ÷ 56 = 87.5% move.
const re = { from: 8, to: 7 };
re.cycle = re.from * re.to;
re.stay = re.to;
re.move = (re.cycle - re.stay) / re.cycle;
// Ring example (ours): 2 million profiles on the same 8 servers. A ring moves 2 million ÷ 8 = 250,000 (12.5%);
// hash % 8 → % 7 moves 2 million × 87.5% = 1.75 million, seven times as many.
const rg = { keys: 2e6, n: re.from };
rg.moved = rg.keys / rg.n;
// Storm example (our load): 6,000 reads/s at 90% hits. One of 4 servers fails: 6,000 × 0.9 ÷ 4 = 1,350 more reads/s
// on the database; one of 8: 675. Eight M servers cost what four L servers do.
const miss = { reads: 6000, hit: 0.9, few: 4, many: 8 };
const storm = (n) => miss.reads * miss.hit / n;
// Check yourself: 5,000 reads/s, 80% hits, 10 servers: 5,000 × 0.8 ÷ 10 = 400.
const stCheck = { reads: 5000, hit: 0.8, n: 10 };
stCheck.extra = stCheck.reads * stCheck.hit / stCheck.n;
// Check yourself: 6 servers with 200 virtual nodes each; one fails and its arcs go to the other five.
const vnCheck = { servers: 6, vnodes: 200 };

/** @type {Lesson} */
const lesson = {
  intro: {
    kicker: 'Level 11 · Part 2: Building blocks',
    title: 'Consistent hashing',
    story: 'Creator profiles are cached on five servers. One of them is about to fail. With the rule your web servers use to pick a cache server, losing one makes almost every profile miss at once. In this level you change the rule.',
    picture: 'figBuilt',
    alt: 'The finished design: web servers find each profile on a cluster of cache servers arranged as a ring, where every server owns many small sections. On a miss they read the database.',
    outcomes: [
      'show why the remainder rule moves almost every key',
      'place servers and keys on a hash ring',
      'say how many keys move when a server joins or leaves',
      'explain what virtual nodes are for',
      'estimate the load a failed cache server sends to the database',
    ],
  },
  last: 'Level 4 ran two cache servers and split the keys between them. Level 9 showed that adding a shard with key % N moves most of the data. Both problems come from the same rule.',
  parts: [
    {
      title: 'Server C fails',
      mission: 0,
      minutes: 10,
      lead: 'A cluster of cache servers needs a rule that says which server holds which key.',
      newParts: [
        { type: 'ring', before: 1, what: 'A group of cache servers that share one set of keys.', does: 'A rule decides which server holds each key. You choose the rule, the number of servers and their memory.', game: `Up to ${Math.max(...Object.keys(ring.choices.count.options).map(Number))} servers. Each handles ${fmt(ring.sizes.L.cap)} lookups/s.` },
      ],
      sections: [
        {
          title: 'Why does losing one cache server make almost every key miss?',
          hook: 'The usual rule is <code>hash(key) % N</code>: turn the key into a number, divide by the number of servers, take the remainder. When N changes, so does the remainder for most keys.',
          body: [
            {
              calc: {
                formula: `${re.from} servers, then one fails and the rule becomes % ${re.to}. A key keeps its server only if both remainders agree.`,
                rows: [
                  { label: 'Stay', work: `hash values 0 to ${re.to - 1} of every ${re.cycle} values`, result: `${re.stay} values` },
                  { label: 'Move', work: `${re.cycle} values − ${re.stay} values`, result: `${re.cycle - re.stay} values = ${percent(re.move)}` },
                ],
                result: `One server in ${re.from} failed, and ${percent(re.move)} of all keys are now looked up on a server that does not have them.`,
              },
            },
            { p: 'Every moved key is a cache miss, all at the same moment, and every miss goes to the database. The servers that survived still hold their data. The rule just no longer points to it.' },
          ],
          takeaway: 'With hash % N, changing N sends almost every key to a different server.',
          quiz: [0],
        },
        {
          title: 'How does a hash ring place keys?',
          hook: 'Stop dividing by the number of servers. Put the servers and the keys on the same circle.',
          body: [
            {
              figure: 'figRing',
              alt: 'Four servers, A to D, sit at points around a circle, and keys sit at other points. Each key belongs to the first server clockwise from it. When server C is removed, only the keys that belonged to C move on to D. Every other key keeps its server.',
              caption: 'A key belongs to the next server clockwise',
            },
            { ol: [
              'Hash each server\'s name to a point on the circle, the <b>hash ring</b>.',
              'Hash each key to a point on the same ring.',
              'A key belongs to the <b>first server clockwise</b> from its point.',
            ] },
            { p: 'Remove a server and only its keys move, to the next server along. Add a server and it takes only the keys between it and the server before it. This is <b>consistent hashing</b>.' },
          ],
          takeaway: 'On a ring, a server joining or leaving moves only the keys next to it.',
          quiz: [1, 3],
        },
        {
          title: 'How many keys move on a ring?',
          hook: `A cluster holds ${count(rg.keys)} profiles on ${rg.n} servers, evenly spread. One server fails.`,
          body: [
            {
              calc: {
                formula: 'Keys that move on a ring = keys ÷ servers.',
                rows: [
                  { label: 'On a ring', work: `${count(rg.keys)} profiles ÷ ${rg.n} servers`, result: `${fmt(rg.moved)} profiles = ${percent(1 / rg.n)}` },
                  { label: `With hash % ${rg.n}`, work: `${count(rg.keys)} profiles × ${percent(re.move)}`, result: `${count(rg.keys * re.move)} profiles` },
                ],
                result: 'The ring moves one share. The remainder rule moves seven.',
              },
            },
            { p: 'Written as a rule: with k keys on n servers, about <b>k ÷ n</b> keys move when one server joins or leaves.' },
          ],
          takeaway: 'On a ring about k ÷ n keys move, which is one server\'s share.',
          quiz: [2],
        },
      ],
      checks: [
        {
          q: 'On a hash ring, server F is added between servers B and C. Which keys move?',
          options: [
            { t: 'Almost every key', why: 'That is the remainder rule. On a ring, a new server only takes over part of one arc.' },
            { t: 'The keys between B and F, which used to go on to C', right: true, why: 'F is now the first server clockwise for those keys. Nothing else changes.' },
            { t: 'All of C\'s keys', why: 'Only the ones that come before F on the ring. Keys between F and C stay on C.' },
          ],
        },
      ],
      youWill: [
        'estimate the share of keys that move when C fails under the remainder rule (Play stays locked until you do)',
        'switch the cluster to a hash ring',
        `let server C fail: at most ${percent(MOVE_MAX)} of keys may move`,
        `keep Response under ${ms(targets.latencyMs)} for at most $${fmt(BUDGET)} a month`,
      ],
      debrief: {
        saw: 'Only C\'s keys moved, and the database carried their misses.',
        number: ['k ÷ n', 'keys that move on a ring when one server changes'],
        next: 'C\'s section of the ring happened to be small. Another server owns more than half the ring.',
      },
    },
    {
      title: 'One more server for the sale',
      mission: 1,
      minutes: 7,
      lead: 'A ring moves few keys. It does not promise that the servers get equal shares.',
      sections: [
        {
          title: 'Why are the shares on a ring uneven?',
          hook: 'Each server sits at one point, and the points are where the hash puts them. Nothing spaces them evenly.',
          body: [
            { p: 'A server owns the arc from the server before it up to itself. With a handful of random points, some arcs are several times longer than others. A server with a long arc holds more keys than its memory fits, while another sits half empty.' },
            { p: 'Failures make it worse. When a server leaves, its whole arc passes to the next server, which now owns two arcs.' },
          ],
          takeaway: 'One point per server gives arcs, and so shares, of very different sizes.',
          quiz: [],
        },
        {
          title: 'How do virtual nodes even out the shares?',
          hook: 'Give every server many points on the ring, not one. Each point is a <b>virtual node</b>.',
          body: [
            {
              figure: 'figArcs',
              alt: 'With one point per server, three servers own three arcs of very different lengths, and one covers more than half the ring. With many points per server, the ring is cut into many small arcs in alternating colours, and each server\'s arcs add up to about a third.',
              caption: 'Many small arcs add up to a fair share',
            },
            { p: 'A server now owns many small arcs spread around the ring. Long and short arcs average out, so the totals come out close to equal. Four times as many points roughly halves the spread.' },
            { p: 'When a server fails, its small arcs pass to many different servers, so no single neighbour takes the whole load. The price is memory: every web server keeps a table of all the points.' },
          ],
          takeaway: 'Many points per server even out the shares, at the cost of a bigger table.',
          quiz: [4, 5, 6],
        },
      ],
      checks: [
        {
          q: `A ring has ${vnCheck.servers} servers with ${vnCheck.vnodes} virtual nodes each. One server fails. Where does its load go?`,
          options: [
            { t: 'To the next server clockwise', why: `That is the case with one point per server. This server had ${vnCheck.vnodes} points, each with a different neighbour.` },
            { t: 'To all five other servers, in small pieces', right: true, why: `Each of its ${vnCheck.vnodes} small arcs passes to whichever server comes next on the ring.` },
          ],
        },
      ],
      youWill: [
        'see how unevenly one point per server shares the keys',
        `raise the virtual nodes until the busiest server is at most ${percent(SPREAD_MAX)} above the average`,
        `add a server: at most ${percent(MOVE_MAX)} of keys may move`,
        `stay within $${fmt(BUDGET)} a month`,
      ],
      debrief: {
        saw: 'With hundreds of points per server the shares evened out, and the new server took a little from every other one.',
        number: [percent(SPREAD_MAX), 'the most the busiest server was above the average'],
        next: `The sale doubles the traffic to ${fmt(SALE_QPS)} requests a second. One server's share of misses is now more than the database can take.`,
      },
    },
    {
      title: 'The sale doubles the reads',
      mission: 2,
      minutes: 7,
      lead: 'The ring keeps a failure small. How small depends on how many servers you have.',
      sections: [
        {
          title: 'How big is the storm when a server fails?',
          hook: `A cluster answers ${fmt(miss.reads)} reads a second with a ${percent(miss.hit)} hit rate. One server fails, and its share of the hits become misses.`,
          body: [
            {
              calc: {
                formula: 'Extra reads on the database = reads × hit rate ÷ servers.',
                rows: [
                  { label: `With ${miss.few} servers`, work: `${fmt(miss.reads)} reads/s × ${miss.hit} ÷ ${miss.few}`, result: `${fmt(storm(miss.few))} reads/s` },
                  { label: `With ${miss.many} servers`, work: `${fmt(miss.reads)} reads/s × ${miss.hit} ÷ ${miss.many}`, result: `${fmt(storm(miss.many))} reads/s` },
                ],
                result: `Twice the servers, half the storm: ${fmt(storm(miss.many))} extra reads a second where there were ${fmt(storm(miss.few))}.`,
              },
            },
            { p: 'So the same memory bought as more, smaller servers is safer. Eight servers of half the size cost about the same as four, and each failure is half as bad.' },
          ],
          takeaway: 'A failure moves one share of the keys, so more servers mean a smaller storm.',
          quiz: [9, 8],
        },
        {
          title: 'What does a ring not fix?',
          hook: 'A ring spreads <b>keys</b> evenly. It cannot spread the reads of one key.',
          body: [
            { p: 'One key lives on one server, wherever you put it. If a single profile is read thousands of times a second, all of those reads go to the server that holds it. This is the hot key from Level 9 again, and it needs its own fix: more copies of that one item, or a server set aside for it.' },
          ],
          takeaway: 'Consistent hashing balances keys, not the popularity of one key.',
          quiz: [7],
        },
      ],
      checks: [
        {
          q: `A cluster answers ${fmt(stCheck.reads)} reads a second with ${percent(stCheck.hit)} hits, on ${stCheck.n} servers. One fails. How many more reads reach the database?`,
          options: [
            { t: `${fmt(stCheck.reads / stCheck.n)} reads/s`, why: 'Only the hits on the failed server become new misses. Multiply by the hit rate.' },
            { t: `${fmt(stCheck.extra)} reads/s`, right: true, why: `${fmt(stCheck.reads)} × ${stCheck.hit} ÷ ${stCheck.n} = ${fmt(stCheck.extra)}.` },
            { t: `${fmt(stCheck.reads * stCheck.hit)} reads/s`, why: 'That would be every server failing at once.' },
          ],
        },
      ],
      youWill: [
        'keep the same total memory and price, with more and smaller servers',
        `keep the busiest server at most ${percent(SPREAD_MAX)} above the average`,
        'let server C fail during the sale and stay above the Served target',
        `stay within $${fmt(SALE_BUDGET)} a month`,
      ],
    },
  ],
  wrap: {
    picture: 'figBuiltEnd',
    alt: 'The design you built: web servers find each profile on a cluster of cache servers arranged as a ring, where every server owns many small sections. On a miss they read the database.',
    say: [
      '"With hash mod N, changing the number of servers remaps almost every key."',
      '"Consistent hashing puts servers and keys on a ring, so a change moves only about k over n keys."',
      '"Virtual nodes give each server many small arcs, so shares are even and a failure is spread out."',
    ],
    numbers: [
      ['k ÷ n', 'keys that move on a ring'],
      [percent(re.move), `of keys move when ${re.from} servers become ${re.to} with hash % N`],
    ],
    loop: `The interview steps again: ${scope} (the keys that move), ${sketch} (cache cluster on a ring), ${deep} (virtual nodes, and how many servers), ${stress} (you lost a server, added one, then lost one during a sale).`,
    broken: 'A cache may lose its data. A database may not. The next level builds a store on the same ring that keeps several copies of every item and stays up when servers fail.',
  },
};

// ---------------- Lesson pictures ----------------
// Three servers' colours in the ring pictures, always shown with their letters as well.
const SERVER_FILL = { A: 'ic-web', B: 'ic-data', C: 'ic-data-top' };
/** A point on a circle at `share` of the way round, clockwise from the top. */
const onCircle = (cx, cy, r, share) => {
  const a = 2 * Math.PI * share - Math.PI / 2;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
};
/** 1 when the clockwise arc from share `a` to share `b` is more than half the circle (SVG's large-arc flag). */
const large = (a, b) => ((b - a + 1) % 1 > 0.5 ? 1 : 0);
/** An arc path from share `a` to share `b`, clockwise, on a circle of radius `r`. */
const arcPath = (cx, cy, r, a, b) => {
  const [x1, y1] = onCircle(cx, cy, r, a), [x2, y2] = onCircle(cx, cy, r, b);
  return `M ${x1} ${y1} A ${r} ${r} 0 ${large(a, b)} 1 ${x2} ${y2}`;
};
/** A band between radius `r1` (inside) and `r2` (outside), clockwise from share `a` to share `b`. */
const bandPath = (cx, cy, r1, r2, a, b) => {
  const [x1, y1] = onCircle(cx, cy, r2, b), [x2, y2] = onCircle(cx, cy, r2, a);
  return `${arcPath(cx, cy, r1, a, b)} L ${x1} ${y1} A ${r2} ${r2} 0 ${large(a, b)} 0 ${x2} ${y2} Z`;
};

/**
 * A ring cut into each server's arcs, from the game's own hash: `vnodes` points per server, each arc in its
 * server's colour, as a band `band` wide inside radius `r`.
 * @param {Record<string, Function>} f the drawing helpers `drawFigures` is given
 * @param {SVGSVGElement} svg
 */
function drawArcs(f, svg, cx, cy, r, band, vnodes) {
  const pts = ringPoints(Object.keys(SERVER_FILL), vnodes).map(([p, s]) => [p / 2 ** 32, s]);
  pts.forEach(([to, s], i) => {
    const from = pts[(i + pts.length - 1) % pts.length][0];
    f.svgEl('path', { d: bandPath(cx, cy, r - band, r, from, to), class: SERVER_FILL[s] }, svg);
  });
}

/**
 * Four servers on a ring, each key going clockwise to the next one; drawn again with C down, where only C's keys
 * move on, to D. Positions are spaced for reading, not hashed.
 * @param {Record<string, Function>} f the drawing helpers `drawFigures` is given
 * @param {SVGSVGElement} svg
 */
function drawRing(f, svg) {
  const { svgEl, figLabel, figDash, figSvg } = f;
  figSvg(svg, 320);
  const servers = { A: 0.05, B: 0.3, C: 0.55, D: 0.8 }, keys = [0.15, 0.22, 0.4, 0.47, 0.68, 0.92];
  const next = (k, names) => names.map((s) => [s, (servers[s] - k + 1) % 1]).sort((a, b) => a[1] - b[1])[0][0];
  const panels = [{ x: 20, label: 'Servers A to D', down: null }, { x: 330, label: 'Server C fails', down: 'C' }];
  for (const { x, label, down } of panels) {
    const cx = x + 145, cy = 165, R = 95, names = Object.keys(servers).filter((s) => s !== down);
    svgEl('rect', { x, y: 10, width: 290, height: 300, rx: 12, class: 'tier-box' }, svg);
    figLabel(svg, x + 14, 30, label, 'start', 'tier-label');
    svgEl('circle', { cx, cy, r: R, class: 'd-line' }, svg);
    let moved = 0;
    for (const k of keys) {
      const to = next(k, names), was = next(k, Object.keys(servers));
      if (to !== was) { moved++; svgEl('path', { d: arcPath(cx, cy, R - 18, k, servers[to] - 0.02), class: 'd-arc' }, svg); }
      figDash(svg, arcPath(cx, cy, R - 18, k + 0.015, servers[to] - 0.02));
      const [kx, ky] = onCircle(cx, cy, R, k);
      svgEl('circle', { cx: kx, cy: ky, r: 5, class: 'ch-pt' }, svg);
    }
    for (const [s, at] of Object.entries(servers)) {
      const [sx, sy] = onCircle(cx, cy, R, at);
      const g = svgEl('g', s === down ? { class: 'fig-down' } : {}, svg);
      svgEl('rect', { x: sx - 12, y: sy - 12, width: 24, height: 24, rx: 5, class: 'node-box' }, g);
      figLabel(g, sx, sy + 4, s);
    }
    figLabel(svg, cx, 294, down ? `Only ${down}'s ${moved} keys move, to D` : `${keys.length} keys, each to the next server`);
  }
}

/**
 * The finished design, drawn for the intro and again for the wrap-up: web servers look up each profile on a cache
 * cluster whose servers own many small arcs of a ring, and read the database on a miss.
 * @param {Record<string, Function>} f the drawing helpers `drawFigures` is given
 * @param {SVGSVGElement} svg
 */
function drawBuilt(f, svg) {
  const { figNode, figArrow, figSvg, figLabel } = f;
  figSvg(svg, 540);
  figNode(svg, 'users', 320, 46, 'Users', 'Open profiles');
  figNode(svg, 'lb', 320, 156, 'Load balancer', 'Shares requests');
  figArrow(svg, 320, 76, 320, 126, '', null, 0, 0);
  figNode(svg, 'web', 320, 266, 'Web servers', 'Autoscaled');
  figArrow(svg, 320, 186, 320, 236, '', null, 0, 0);
  figNode(svg, 'ring', 150, 386, 'Cache cluster', 'Servers on a ring');
  figNode(svg, 'db', 490, 386, 'Database', 'Every profile');
  figArrow(svg, 270, 296, 190, 356, 'lookups', null, 222, 326, 'end');
  figArrow(svg, 370, 296, 450, 356, 'on a miss', null, 418, 326);
  drawArcs(f, svg, 150, 476, 44, 16, ring.choices.hashing.options.v10.vnodes);
  figLabel(svg, 214, 480, 'many small arcs per server', 'start');
}

const even = (m) => m.ringSpread != null && m.ringSpread <= SPREAD_MAX + 1e-9;
/** @type {Goal} */
const spreadGoal = {
  id: 'spread', type: 'metric', text: `Busiest cache server at most ${Math.round(SPREAD_MAX * 100)}% above the average`, test: even,
  val: (m) => (m.ringSpread == null ? '—' : '+' + fmtPct(m.ringSpread, PCT)),
};
const served99 = servedAtLeast(targets.servedPct);
const fewMoved = (m) => m.ringMoved != null && m.ringMoved <= MOVE_MAX + 1e-9;
const hashShort = { mod: 'hash % N', ring: 'ring', v10: 'ring · 10 vnodes', v100: 'ring · 100 vnodes', v500: 'ring · 500 vnodes' };
const dbOver = (m) => { const st = Object.values(m.node).find((s) => s.unit === 'queries/s'); return st ? st.load : 0; };

/** @type {Level} */
export default {
  id: 11,
  saveKey: 'sdl-level11-v1',
  saveVersion: 2, // 2: which missions were opened from the lesson (`opened`)
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
      title: 'Server C fails', ref: 'The rehashing problem', qps: QPS, writes: 0.05, budget: BUDGET,
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
      title: 'One more server for the sale', ref: 'Virtual nodes', qps: QPS, writes: 0.05, budget: BUDGET,
      story: 'A sale is coming, and you add a cache server. On a ring with one point per server, the servers own arcs of very different sizes: one holds far more profiles than its memory fits, while another sits half empty. Keep every server within 10% of the average, before and after the new one joins.',
      goals: [
        servedGoal(targets), latGoal(targets), spreadGoal, costGoal(BUDGET),
        { id: 'add-server', type: 'exp', text: `Break it: add a server; at most ${Math.round(MOVE_MAX * 100)}% of keys move, and the spread stays within ${Math.round(SPREAD_MAX * 100)}%` },
      ],
      hint: 'Give each server many points on the ring: virtual nodes. Ten even out the shares a little; with 100, five servers still differ by about 16% here. Try 500.',
      takeaway: 'Each server now owns hundreds of small arcs, so the shares even out, and a new server takes a little from every other one. More virtual nodes cost only a bigger ring table in each web server\'s memory.',
    },
    {
      title: 'The sale doubles the reads', ref: 'k/n keys move', qps: SALE_QPS, writes: 0.05, budget: SALE_BUDGET,
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
      { q: 'Six cache servers use hash(key) % 6. One fails and the cluster switches to % 5. Roughly what share of keys get a new server?', o: ['About 1/6', 'About 5/6', 'About 1/5', 'All of them'], a: 1, e: 'A key keeps its server only when % 6 and % 5 still pick the same one: 5 of every 30 hash values in a row, 1 in 6. So 5/6 of the keys move, not just the failed server\'s sixth. Their new servers don\'t hold them yet, so they all miss at once: a cache-miss storm.', r: 'Why does losing one cache server make almost every key miss?' },
      { q: 'On a hash ring, which server stores a key?', o: ['The next server clockwise', 'The server with the closest number', 'The server named by hash % N', 'A random server, chosen on every read'], a: 0, e: 'Servers and keys are hashed onto the same ring. From the key\'s position, go clockwise until you reach a server: that one stores it.', r: 'How does a hash ring place keys?' },
      { q: 'A ring holds k keys on n servers. About how many keys move when one server is added?', o: ['k', 'k / 2', 'k / n', 'n'], a: 2, e: 'The new server takes over one range of the ring, about 1/n of the keys. Every other key keeps its server.', r: 'How many keys move on a ring?' },
      { q: 'Server S is added to a ring. Which keys move to it?', o: ['Keys between S and the next server clockwise', 'Every key with an even hash', 'Keys spread evenly over all servers', 'From S back to the previous server'], a: 3, e: 'S now comes first clockwise for the keys between the previous server and S. Going anticlockwise from S to the previous server gives that range; those keys used to belong to the server after S.', r: 'How does a hash ring place keys?' },
      { q: 'Why do virtual nodes help?', o: ['A server\'s share sums many small arcs', 'They copy every key to two servers', 'They make each lookup faster than hash % N', 'They stop servers from failing'], a: 0, e: 'With one point each, arcs vary a lot in size. With many points per server, each server\'s share is the sum of many small arcs, which averages out.', r: 'How do virtual nodes even out the shares?' },
      { q: 'With 100 virtual nodes per server, the shares vary by about 10%. About how much with 400?', o: ['About 2.5%', 'About 5%', 'About 10%', 'About 1%'], a: 1, e: 'The spread falls with the square root of the number of virtual nodes: 1 ÷ √100 = 10%, 1 ÷ √400 = 5%. Four times the nodes halves it.', r: 'How do virtual nodes even out the shares?' },
      { q: 'What does a cluster pay for more virtual nodes?', o: ['More memory for every cached key', 'A higher miss rate on every read', 'Slower network between servers', 'A bigger ring table'], a: 3, e: 'Every client keeps the ring\'s points. More virtual nodes means more entries to store and search, and more ranges to track when servers change. The data itself is the same.', r: 'How do virtual nodes even out the shares?' },
      { q: 'Three creator accounts, each with 50 million followers, are read all the time. What does consistent hashing do for them?', o: ['It puts each one on its own server', 'It splits each account over all servers', 'Little: one key, one server', 'It moves them to the database'], a: 2, e: 'Consistent hashing spreads many keys evenly, so hot keys are less likely to pile up on one server. But a single hot key still lives on one server. To spread its reads, keep copies on several servers or in each web server\'s memory.', r: 'What does a ring not fix?' },
      { q: 'You keep the cost and memory of 4 large cache servers but use 8 of half the size. Why can that be better?', o: ['A failure moves 1/8 of keys', 'Each lookup gets answered faster', 'They hold more keys in memory', 'They need no virtual nodes'], a: 0, e: 'On a ring, a failed server\'s keys move: k/n of them. With 8 servers that is an eighth, so the miss storm on the database is half as big.', r: 'How big is the storm when a server fails?' },
      { q: 'A cluster answers 9,000 reads/s with 95% hits. One of 6 servers fails. About how many more reads/s reach the database right after?', o: ['About 9,000', 'About 1,425', 'About 450', 'About 7,125'], a: 1, e: 'Its sixth of the keys now misses: 9,000 × 95% × 1/6 ≈ 1,425 more reads a second, until those keys are cached again.', r: 'How big is the storm when a server fails?' },
    ],
  },

  lesson,

  // Lesson diagrams. `f` provides the engine's drawing helpers. Each figure sets its own viewBox.
  drawFigures(f) {
    const { $, svgEl, figSvg, figLabel } = f;
    drawRing(f, $('figRing'));

    // One point per server, then many: the same three servers' arcs and shares, from the game's hash.
    const f2 = figSvg($('figArcs'), 300);
    const { ring: one, v10 } = ring.choices.hashing.options;
    for (const { x, vnodes, label } of [{ x: 20, vnodes: one.vnodes, label: 'One point per server' }, { x: 330, vnodes: v10.vnodes, label: `${v10.vnodes} points per server` }]) {
      const cx = x + 145, shares = keyShares(Object.keys(SERVER_FILL), { vnodes });
      svgEl('rect', { x, y: 10, width: 290, height: 280, rx: 12, class: 'tier-box' }, f2);
      figLabel(f2, x + 14, 30, label, 'start', 'tier-label');
      drawArcs(f, f2, cx, 140, 90, 26, vnodes);
      Object.entries(SERVER_FILL).forEach(([s, cls], i) => {
        const lx = x + 30 + i * 90;
        svgEl('rect', { x: lx, y: 252, width: 14, height: 14, rx: 3, class: cls }, f2);
        figLabel(f2, lx + 20, 264, `${s} ${percent(Math.round(shares[s] * 100) / 100)}`, 'start');
      });
    }

    drawBuilt(f, $('figBuilt'));
    drawBuilt(f, $('figBuiltEnd'));
  },
};
