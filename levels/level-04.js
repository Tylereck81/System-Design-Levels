// @ts-check
/** @import { Level, Goal, Lesson } from '../js/types.js' */
// Level 4: Cache tier.
// Everything specific to this level lives here: components, rules, missions, quiz and text.
import { servedGoal, latGoal, costGoal, spofGoal, servedAtLeast } from './shared/goals.js';
import { shopUsers, dns, lb, NO_DB_NOTE, replicaDb, cache } from './shared/components.js';
import { dnsLookup, usersToLb, lbToWeb, webToReplicas, webToCache, lbBad, replicaBad, cacheBad } from './shared/connections.js';
import { lbText, replicaText, levelComplete } from './shared/text.js';
import { ONE_DNS, TWO_LBS, THREE_CACHES } from './shared/limits.js';
import { failText, passText } from './shared/quiz.js';
import { catalogWorkload } from './shared/workload.js';
import { fmt, percent, ms } from '../js/format.js';
import { COMPONENTS, SIZES } from '../js/engine/catalog.js';
import { STEPS } from './mock-steps.js';

const targets = { latencyMs: 150, servedPct: 99 };
const DB_BUSY = 0.7;
/** Peak traffic in req/s and the share of requests that write, the same in all three missions. */
const LOAD = { qps: 2000, writes: 0.2 };
/** Monthly budget of every mission, in dollars. */
const BUDGET = 2100;
/** The cache hit rate each mission asks for, in percent. */
const HIT_PCT = [80, 80, 86];
/** Mission 3's flash sale: how many prices change, and how soon shoppers must see them, in seconds. */
const SALE = { products: 300, freshSecs: 60 };
/** Reads a second at peak: the requests that do not write. */
const READS = LOAD.qps * (1 - LOAD.writes);

const served99 = servedAtLeast(targets.servedPct);
/** @type {(min: number) => Goal} */
const hitGoal = (min) => ({
  id: 'hit', type: 'metric', text: `Cache hit rate at least ${min}%`,
  test: (m) => m.hitRate != null && m.hitRate * 100 >= min,
  val: (m) => (m.hitRate == null ? '—' : (m.hitRate * 100).toFixed(1) + '%'),
});
const dbLoads = (m) => m.g.onPath('db').map((n) => m.node[n.id]).filter((st) => st && !st.down);
/** @type {Goal} */
const dbBusyGoal = {
  id: 'dbbusy', type: 'metric', text: `Every database under ${DB_BUSY * 100}% busy`,
  test: (m) => dbLoads(m).length > 0 && dbLoads(m).every((st) => st.util < DB_BUSY),
  val: (m) => (dbLoads(m).length ? Math.round(100 * Math.max(...dbLoads(m).map((st) => st.util))) + '% max' : '—'),
};
const duration = (s) => ({ 10: '10 seconds', 60: '1 minute', 600: '10 minutes', 3600: '1 hour' }[s] || `${s} seconds`);

// ---------------- Lesson ----------------
const smallestCache = Object.values(COMPONENTS.cache.sizes)[0];
const cacheSizeCount = Object.keys(COMPONENTS.cache.sizes).length;
const [scope, sketch, deep, stress] = STEPS.map((step) => `<b>${step.name}</b>`);
/** "1 read in 5" reaches the database at an 80% hit rate. */
const missOneIn = (pct) => Math.round(100 / (100 - pct));

// Timing figures: rounded teaching values from the widely published latency list, not game numbers.
const memoryNs = 100, seekMs = 10;
const timesFaster = (seekMs * 1e6) / memoryNs;
/** The rule of thumb for uneven reads, which the game's catalog also follows: this share of reads goes to this share of items. */
const HOT = { reads: 0.8, items: 0.2 };

// Hit-rate example (our load, not a game number): 2,400 reads/s at 75% hits.
const hr = { reads: 2400, hit: 0.75 };
hr.db = hr.reads * (1 - hr.hit);
// Check yourself: other numbers again.
const hrCheck = { reads: 5000, hit: 0.8 };
hrCheck.db = hrCheck.reads * (1 - hrCheck.hit);

// Memory example (ours): a news site that caches its hot articles.
const mem = { items: 500000, kb: 30 };
mem.hot = mem.items * HOT.items;
mem.gb = (mem.hot * mem.kb) / 1e6; // 1 GB = 1,000,000 KB, as the mission's estimate uses

// Losing one of two caches (our load): 2,000 reads/s at 90% hits, keys split evenly.
const lose = { reads: 2000, hit: 0.9 };
lose.normal = lose.reads * (1 - lose.hit);
lose.half = lose.reads * (1 - lose.hit / 2);

/** @type {Lesson} */
const lesson = {
  intro: {
    kicker: 'Level 4 · Part 1: Grow one app',
    title: 'Cache tier',
    story: 'Your replicas answer the same questions all day: the same popular products, read from disk again and again. Each replica costs as much as your largest server. In this level you keep the popular answers in memory.',
    picture: 'figBuilt',
    alt: 'The finished design: web servers check two cache servers first. On a miss they read a database replica. Writes go to the primary database.',
    outcomes: [
      'explain how a web server uses a cache',
      'say which data is worth caching',
      'estimate a hit rate and the memory a cache needs',
      'say what happens when a cache restarts',
      'keep cached data fresh when the real data changes',
    ],
  },
  last: 'Level 3 spread the reads over replicas. But most reads fetch the same popular products from disk again and again, and every extra replica is another large server to pay for.',
  parts: [
    {
      title: 'Cache the hot products',
      mission: 0,
      minutes: 10,
      lead: 'Reading from disk is slow. Reading the same thing from disk a thousand times is waste.',
      newParts: [
        { type: 'cache', what: 'A server that keeps data in memory, each item stored under a key.', does: 'Answers a lookup in a fraction of a millisecond. Web servers ask it before they ask the database.', game: `${cacheSizeCount} memory sizes, from ${smallestCache.mem} GB for $${smallestCache.cost} a month. Each handles ${fmt(smallestCache.cap)} lookups/s.` },
      ],
      sections: [
        {
          title: 'How does a web server use a cache?',
          hook: 'For every read, the web server asks the cache first.',
          body: [
            {
              figure: 'figAside',
              alt: 'On a hit, the web server asks the cache for product 42 and gets it back; the database is not used. On a miss, the cache does not have it, so the web server reads the database and then stores the answer in the cache.',
              caption: 'A hit ends in memory. A miss reads the database, then fills the cache',
            },
            { ul: [
              '<b>Hit:</b> the cache has the item. The database is not touched.',
              '<b>Miss:</b> the cache does not have it. The web server reads the database, then stores the answer in the cache for next time.',
            ] },
            { p: `This pattern is called <b>cache-aside</b>. It pays off because memory is fast: reading from memory takes about ${memoryNs} nanoseconds, and finding data on a disk about ${seekMs} milliseconds, which is ${fmt(timesFaster)} times longer.` },
          ],
          takeaway: 'Check the cache first, and on a miss read the database and fill the cache.',
          quiz: [0],
        },
        {
          title: 'What belongs in a cache?',
          hook: 'A cache can be far smaller than the database and still answer most reads. Why?',
          body: [
            { p: `Reads are uneven. A few popular items, the <b>hot</b> data, get most of the reads. A common rule of thumb: ${percent(HOT.reads)} of reads go to ${percent(HOT.items)} of the items.` },
            { table: { head: ['Good to cache', 'Bad to cache'], rows: [
              ['Read often, changed rarely: product pages', 'Changed on almost every read: a live stock count'],
              ['Fine if slightly old', 'Must never be old: a payment'],
              ['Can be rebuilt from the database', 'The only copy of anything'],
            ] } },
            { p: 'The last row matters most. Cache memory is emptied by a restart. The database stays the real copy, and the cache only holds a second copy of what is popular.' },
          ],
          takeaway: 'Cache what is read often and changed rarely, and never keep the only copy there.',
          quiz: [1, 8, 9],
        },
        {
          title: 'How to size a cache',
          hook: 'The <b>hit rate</b> is the share of reads the cache answers. Only the misses reach the database.',
          body: [
            {
              calc: {
                formula: 'Reads reaching the database = reads × (1 − hit rate). Memory = items to hold × size of one item.',
                rows: [
                  { label: 'Database load', work: `${fmt(hr.reads)} reads/s × (1 − ${hr.hit})`, result: `${fmt(hr.db)} reads/s` },
                  { label: 'Hot items', work: `${fmt(mem.items)} articles × ${percent(HOT.items)}`, result: `${fmt(mem.hot)} articles` },
                  { label: 'Memory', work: `${fmt(mem.hot)} articles × ${mem.kb} KB`, result: `${mem.gb} GB` },
                ],
                // "a quarter": tests/unit/level-04-lesson.test.mjs checks it against the example's hit rate.
                result: `At a ${percent(hr.hit)} hit rate the database sees a quarter of the reads. A news site with ${fmt(mem.items)} articles of ${mem.kb} KB needs about ${mem.gb} GB for its hot ${percent(HOT.items)}.`,
              },
            },
            { p: 'Buy more than the sum says. Entries expire, and the hot set grows.' },
          ],
          takeaway: 'A cache is sized by the hot items, and the database by the misses.',
          quiz: [6, 7],
        },
      ],
      checks: [
        {
          q: `Reads arrive at ${fmt(hrCheck.reads)} a second and the hit rate is ${percent(hrCheck.hit)}. How many reach the database?`,
          options: [
            { t: `${fmt(hrCheck.reads * hrCheck.hit)} reads/s`, why: 'Those are the hits. They end in the cache.' },
            { t: `${fmt(hrCheck.db)} reads/s`, right: true, why: `${fmt(hrCheck.reads)} × (1 − ${hrCheck.hit}) = ${fmt(hrCheck.db)}. Only the misses reach the database.` },
            { t: `${fmt(hrCheck.reads)} reads/s`, why: 'That would be a hit rate of zero.' },
          ],
        },
      ],
      youWill: [
        'estimate the memory for the most-viewed products (Play stays locked until you do)',
        'add a cache, connect the web servers to it, and remove a replica you no longer need',
        `reach a hit rate of at least ${HIT_PCT[0]}% for at most $${fmt(BUDGET)} a month`,
      ],
      debrief: {
        saw: 'Most reads ended in memory, so one replica was enough and the bill went down.',
        number: [`${HIT_PCT[0]}% hit rate`, `only 1 read in ${missOneIn(HIT_PCT[0])} reached the database`],
        next: 'The database is now sized for the misses only. What happens when the cache restarts and every read is a miss?',
      },
    },
    {
      title: 'The cache goes down',
      mission: 1,
      minutes: 6,
      lead: 'You saved money by shrinking the database tier. That made the cache something the shop cannot lose.',
      sections: [
        {
          title: 'What happens when a cache restarts?',
          hook: 'No data is lost: the database has it all. The problem is load.',
          body: [
            {
              figure: 'figCold',
              alt: 'With a warm cache, nine reads in ten stop at the cache and one reaches the database. Just after a restart the cache is empty, so all ten reads reach the database, which is overloaded.',
              caption: 'A cache that has just restarted answers nothing',
            },
            { p: 'A cache comes back empty, a <b>cold cache</b>. Every read is a miss until it refills. The database was sized for the misses alone, and now it gets every read at once.' },
            { p: 'So a single cache server is a single point of failure, even though it holds no data you cannot rebuild.' },
          ],
          takeaway: 'Losing a cache loses no data, but it sends every read to the database.',
          quiz: [4],
        },
        {
          title: 'How to survive losing a cache',
          hook: 'Run more than one cache server and divide the keys between them. Losing one then empties only its share.',
          body: [
            {
              calc: {
                formula: `${fmt(lose.reads)} reads/s at a ${percent(lose.hit)} hit rate, with the keys split over two cache servers:`,
                rows: [
                  { label: 'Both caches up', work: `${fmt(lose.reads)} reads/s × (1 − ${lose.hit})`, result: `${fmt(lose.normal)} reads/s to the database` },
                  { label: 'One cache lost', work: `${fmt(lose.reads)} reads/s × (1 − ${lose.hit / 2})`, result: `${fmt(lose.half)} reads/s to the database` },
                  { label: 'A single cache, lost', work: `${fmt(lose.reads)} reads/s × (1 − 0)`, result: `${fmt(lose.reads)} reads/s to the database` },
                ],
                result: `With two caches the database must survive ${fmt(lose.half)} reads a second, not ${fmt(lose.reads)}.`,
              },
            },
            { p: 'Size the database for the day one cache is cold, not for a normal day.' },
          ],
          takeaway: 'Split the keys over several caches, and size the database for losing one.',
          quiz: [],
        },
      ],
      checks: [
        {
          q: 'Your only cache server restarts. The database holds every product. What do shoppers notice?',
          options: [
            { t: 'Nothing: the data is safe', why: 'The data is safe, but the database now gets every read and may not carry them.' },
            { t: 'Slow or failed pages until the cache refills', right: true, why: 'Every read misses, so the full read load lands on a database sized for a fraction of it.' },
            { t: 'Missing products', why: 'Nothing is missing. The cache only held copies.' },
          ],
        },
      ],
      youWill: [
        'run two cache servers, each connected to every web server',
        `keep the hit rate at least ${HIT_PCT[1]}% with no single point of failure, for at most $${fmt(BUDGET)} a month`,
        'crash a cache and stay above the Served target',
      ],
      debrief: {
        saw: 'One cache crashed and only its half of the keys missed. The replica carried the extra reads.',
        number: ['half', 'of the hits lost when one of two caches fails'],
        next: `A flash sale will change ${SALE.products} prices at noon. The cache still holds the old ones.`,
      },
    },
    {
      title: 'Prices must be fresh',
      mission: 2,
      minutes: 8,
      lead: 'A cached copy is a second copy. When the real data changes, the copy is wrong until something fixes it.',
      sections: [
        {
          title: 'How long can a cached price be wrong?',
          hook: 'Every cached item gets a lifetime, its <b>TTL</b> (time to live). When it runs out, the item is dropped and the next read fetches a fresh copy.',
          body: [
            { table: { head: ['TTL', 'Hit rate', 'A change shows up'], rows: [
              ['Short (seconds)', 'Lower: items keep expiring', 'Quickly'],
              ['Long (an hour)', 'Higher', 'Up to an hour late'],
              ['None', 'Highest', 'Never, until a restart'],
            ] } },
            { p: 'Data that is out of date is called <b>stale</b>. With only a TTL, the worst case is stale for the whole TTL. So the TTL is a trade: fresher data against more hits.' },
          ],
          takeaway: 'A longer TTL means more hits and staler data.',
          quiz: [2],
        },
        {
          title: 'How to update the cache when a price changes',
          hook: 'Do not wait for the TTL. When the price changes, delete the cached copy. The next read misses and loads the new price.',
          body: [
            {
              figure: 'figOrder',
              alt: 'Right order: write the new price to the database, then delete the cached price; the next read caches the new price. Wrong order: delete the cached price first; a read arrives, misses, and caches the old price from the database; then the database is written. The cache now holds the old price.',
              caption: 'Write the database first, then delete the cached copy',
            },
            { p: 'The order matters. Write the database first, then delete the key. If you delete first, a read can slip in between, miss, and put the old price back.' },
            { p: 'Now you can keep a long TTL for the hit rate and still show changes at once. The TTL stays as a safety net.' },
          ],
          takeaway: 'On a change, write the database, then delete the cached copy.',
          quiz: [5],
        },
        {
          title: 'What happens when the cache is full?',
          hook: 'Memory is limited. To store a new item, a full cache must throw one out. This is <b>eviction</b>.',
          body: [
            { table: { head: ['Policy', 'Throws out'], rows: [
              ['<b>LRU</b>, least recently used', 'The item nobody has read for the longest time. The usual choice.'],
              ['<b>LFU</b>, least frequently used', 'The item read the fewest times'],
              ['<b>FIFO</b>, first in first out', 'The oldest item, however popular'],
            ] } },
            { p: 'LRU fits a shop: products that were popular a moment ago will probably be read again soon.' },
          ],
          takeaway: 'A full cache evicts, and LRU drops what was used longest ago.',
          quiz: [3],
        },
      ],
      checks: [
        {
          q: 'A cache has a 10-minute TTL and nothing deletes keys on a change. A price changes. For how long can a shopper see the old one?',
          options: [
            { t: 'Not at all', why: 'Nothing tells the cache about the change. It keeps its copy until the TTL runs out.' },
            { t: 'Up to 10 minutes', right: true, why: 'The copy may have been cached just before the change, so it can live for the whole TTL.' },
            { t: 'Until the cache restarts', why: 'That is the case with no TTL at all.' },
          ],
        },
      ],
      youWill: [
        `reach a hit rate of at least ${HIT_PCT[2]}%, which a short TTL cannot give`,
        `press Change prices and make sure shoppers see the new prices within ${duration(SALE.freshSecs)}`,
        `keep Response under ${ms(targets.latencyMs)} for at most $${fmt(BUDGET)} a month`,
      ],
    },
  ],
  wrap: {
    picture: 'figBuiltEnd',
    alt: 'The design you built: web servers check two cache servers first. On a miss they read a database replica. Writes go to the primary database.',
    say: [
      '"I cache data that is read often and changed rarely. The web server checks the cache first."',
      '"A restart empties a cache, so I run several and size the database for a cold one."',
      '"On a change I write the database, then delete the cached copy, and keep a TTL as a safety net."',
    ],
    numbers: [
      [`${memoryNs} nanoseconds`, 'to read from memory'],
      [`${seekMs} milliseconds`, 'to find data on a disk'],
      [`${percent(HOT.reads)} of reads`, `go to ${percent(HOT.items)} of the items (rule of thumb)`],
    ],
    loop: `The interview steps again: ${scope} (the memory for the hot products), ${sketch} (cache beside the database), ${deep} (memory size, TTL, delete on change), ${stress} (you crashed a cache and changed ${SALE.products} prices).`,
    broken: 'Every photo, stylesheet and script still comes from your own servers, however far away the shopper is. Level 5 moves those files close to them.',
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
  // Every web server checks both caches; reads that miss run down the left side, writes down the right.
  figNode(svg, 'cache', 215, 400, 'Cache 1', 'Hot products');
  figNode(svg, 'cache', 425, 400, 'Cache 2', 'Hot products');
  figArrow(svg, 190, 310, 200, 370, '', null, 0, 0);
  figArrow(svg, 230, 310, 400, 370, 'check first', '1', 282, 300);
  figArrow(svg, 410, 310, 240, 370, '', null, 0, 0);
  figArrow(svg, 450, 310, 440, 370, '', null, 0, 0);
  figArrow(svg, 80, 310, 80, 500, 'on a miss', '2', 110, 470);
  figArrow(svg, 560, 310, 560, 500, 'writes', null, 550, 470, 'end');
  figNode(svg, 'db', 150, 530, 'Read replica', 'Reads on a miss');
  figNode(svg, 'db', 490, 530, 'Primary DB', 'Every write');
  figDash(svg, 'M396 530 H244');
  figLabel(svg, 320, 518, 'copies every write');
}

/**
 * Two timelines of a price change: the right order (database, then delete) and the wrong one (delete, then database).
 * @param {Record<string, Function>} f the drawing helpers `drawFigures` is given
 * @param {SVGSVGElement} svg
 */
function drawOrder(f, svg) {
  const { svgEl, figArrow, figDefs, figLabel } = f;
  svg.textContent = ''; svg.setAttribute('viewBox', '0 0 640 396'); figDefs(svg);
  /** A numbered event on a lane, written just above it. */
  const step = (x, y, n, text) => {
    svgEl('circle', { cx: x, cy: y - 4, r: 9, class: 'd-step' }, svg);
    figLabel(svg, x, y, n, 'middle', 'd-step-t');
    figLabel(svg, x + 16, y, text, 'start');
  };
  /** A dashed panel with a database lane and a cache lane; returns the two lanes' heights. */
  const panel = (y, label) => {
    svgEl('rect', { x: 10, y, width: 620, height: 180, rx: 12, class: 'tier-box' }, svg);
    figLabel(svg, 24, y + 20, label, 'start', 'tier-label');
    const lanes = { db: y + 74, cache: y + 154 };
    for (const [name, ly] of [['Database', lanes.db], ['Cache', lanes.cache]]) {
      figLabel(svg, 24, ly + 4, name, 'start', 'tier-label');
      svgEl('line', { x1: 120, y1: ly, x2: 610, y2: ly, class: 'tier-box' }, svg);
    }
    return lanes;
  };
  const right = panel(10, 'Right order');
  figLabel(svg, 610, 30, 'time →', 'end', 'tier-label');
  step(150, right.db - 14, '1', 'write the new price');
  step(300, right.cache - 14, '2', 'delete the key');
  figArrow(svg, 460, right.db + 4, 460, right.cache - 4, 'caches new price', '3', 486, right.db + 44);
  const wrong = panel(206, 'Wrong order');
  step(150, wrong.cache - 14, '1', 'delete the key');
  figArrow(svg, 300, wrong.db + 4, 300, wrong.cache - 4, 'caches old price', '2', 326, wrong.db + 44);
  step(450, wrong.db - 14, '3', 'write the new price');
  figLabel(svg, 610, wrong.cache - 14, 'old price stays', 'end');
}

/** @type {Level} */
export default {
  id: 4,
  saveKey: 'sdl-level4-v1',
  saveVersion: 2, // 2: which missions were opened from the lesson (`opened`)
  targets,
  // The product catalog the cache holds: its size, and how often a cached product is read (see the lesson's assumptions).
  workload: catalogWorkload(),

  components: {
    users: shopUsers(),
    dns: dns(),
    lb: lb(),
    web: {
      name: 'Web server', short: 'Your back-end code',
      desc: 'Runs your back-end code. For each read it asks the cache first; on a miss it reads a replica and stores the answer in the cache. Writes go to the primary database.',
      noDbNote: NO_DB_NOTE,
    },
    db: replicaDb(),
    cache: cache(),
  },
  palette: ['dns', 'lb', 'web', 'db', 'cache'],
  limits: { dns: 1, lb: 2, web: 2, db: 3, cache: 3 },
  limitMsg: {
    dns: ONE_DNS,
    lb: TWO_LBS,
    web: 'The web tier is big enough in this level: two XL web servers handle 3,200 req/s.',
    db: 'Three databases is the limit here: a primary and two replicas. Let the cache take the rest of the reads.',
    cache: THREE_CACHES,
  },
  // Level 3's design with a primary and two XL replicas.
  startNodes: [
    { id: 'u', type: 'users', x: 250, y: 60 },
    { id: 'd', type: 'dns', x: 510, y: 60 },
    { id: 'l1', type: 'lb', x: 250, y: 168, algo: 'rr' },
    { id: 'l2', type: 'lb', x: 510, y: 168, algo: 'rr' },
    { id: 'w1', type: 'web', x: 250, y: 276, size: 'XL' },
    { id: 'w2', type: 'web', x: 510, y: 276, size: 'XL' },
    { id: 'b', type: 'db', x: 120, y: 468, size: 'XL', kind: 'sql', role: 'primary' },
    { id: 'r1', type: 'db', x: 380, y: 468, size: 'XL', kind: 'sql', role: 'replica' },
    { id: 'r2', type: 'db', x: 640, y: 468, size: 'XL', kind: 'sql', role: 'replica' },
  ],
  startEdges: [
    { id: 's1', from: 'u', to: 'd' }, { id: 's2', from: 'u', to: 'l1' }, { id: 's3', from: 'u', to: 'l2' },
    { id: 's4', from: 'l1', to: 'w1' }, { id: 's5', from: 'l1', to: 'w2' }, { id: 's6', from: 'l2', to: 'w1' }, { id: 's7', from: 'l2', to: 'w2' },
    { id: 's8', from: 'w1', to: 'b' }, { id: 's9', from: 'w2', to: 'b' }, { id: 's10', from: 'w1', to: 'r1' }, { id: 's11', from: 'w2', to: 'r1' },
    { id: 's12', from: 'w1', to: 'r2' }, { id: 's13', from: 'w2', to: 'r2' },
  ],
  slots: {
    dns: { x: 510, y: 60 }, lb: { x: 510, y: 168 }, web: { x: 510, y: 276 },
    cache: [{ x: 120, y: 372 }, { x: 640, y: 372 }, { x: 380, y: 372 }],
    db: [{ x: 380, y: 468 }, { x: 640, y: 468 }, { x: 120, y: 468 }],
  },

  connections: {
    ok: {
      'dns|users': dnsLookup(),
      'lb|users': usersToLb(),
      'lb|web': lbToWeb(),
      'db|web': webToReplicas(),
      'cache|web': webToCache(),
    },
    bad: { ...lbBad(), ...replicaBad(), ...cacheBad() },
  },

  missions: [
    {
      title: 'Cache the hot products', ref: 'Cache-aside', ...LOAD, budget: BUDGET,
      gate: {
        hidesTraffic: false,
        lo: 3.5, hi: 4.5,
        prompt: '<b>Estimate before you build.</b> The shop sells 2,000,000 products, and a cached product page takes about 10 KB. 80% of views go to the most-viewed 20% of products. How much memory holds that 20%?',
        label: 'Memory (GB)',
        placeholder: 'e.g. 2',
        acceptedHtml: '<p><b>Estimate accepted.</b></p><div class="calc">20% of 2,000,000 = 400,000 products<br>400,000 × 10 KB = 4,000,000 KB ≈ 4 GB<br>That covers about 80% of reads, before any expire.</div>',
        acceptedLog: 'Estimate accepted: about 4 GB holds the most-viewed 20% of products. Play is unlocked.',
        notNumber: 'Type the estimate as a number of GB, for example 2.',
        hints: [
          { test: (v) => v >= 18 && v <= 22, text: 'That is the whole catalog. You only need the most-viewed 20% of products.' },
          { test: (v) => v >= 3500 && v <= 4500, text: 'That looks like megabytes. Answer in GB: 1 GB is 1,000 MB.' },
          { test: (v) => v >= 0.35 && v <= 0.45, text: 'Check the units: 400,000 × 10 KB = 4,000,000 KB, and 1 GB is 1,000,000 KB.' },
        ],
        fallback: 'Not quite. Take 20% of 2,000,000 products, times 10 KB each, then convert KB to GB (÷ 1,000,000).',
      },
      story: `Most of the ${fmt(READS)} reads a second are product pages, and the same popular products are read again and again. Finance wants the bill under $${fmt(BUDGET)} a month. Today it is $2,295, and each XL replica costs $${fmt(SIZES.XL.cost)}. Put a cache in front of the database: web servers check it first, and only misses reach a replica. Then one replica is enough.`,
      goals: [
        { id: 'est', type: 'gate', text: 'Estimate the memory for the most-viewed products' },
        hitGoal(HIT_PCT[0]), dbBusyGoal,
        servedGoal(targets), latGoal(targets), costGoal(BUDGET),
      ],
      hint: 'Remove one replica, add a cache and connect both web servers to it. 4 GB holds the top 20% of products, but entries also expire, so give it room to spare: more memory, a longer TTL, or both. Select the cache to see its hit rate.',
      takeaway: 'Most reads now end in memory, so one replica is enough and the bill went down. A cache works because a few items get most of the reads. Size it with room to spare: entries expire, and the hot set grows.',
    },
    {
      title: 'The cache goes down', ref: 'Cache failure', ...LOAD, budget: BUDGET,
      story: `The cache is now a single point of failure. A cache server that restarts comes back empty, so every read it used to answer goes to the database until it refills. With one cache, that is all ${fmt(READS)} reads a second, on one replica. Make sure the site survives losing a cache.`,
      goals: [
        hitGoal(HIT_PCT[1]), spofGoal(), dbBusyGoal,
        servedGoal(targets), latGoal(targets), costGoal(BUDGET),
        { id: 'crash-cache', type: 'exp', text: `Break it: crash a cache and still serve at least ${targets.servedPct}%` },
      ],
      hint: 'Run two cache servers: the web servers split the keys between them, so losing one costs only its half of the hits. Two 4 GB caches hold as much as one 8 GB cache. Connect both web servers to both caches.',
      takeaway: 'With two caches, losing one sent only its half of the keys to the database, and the replica coped. A real cache comes back empty after a restart and refills as reads miss. Until then the database carries the extra load, so plan for it.',
    },
    {
      title: 'Prices must be fresh', ref: 'Cache consistency', ...LOAD, budget: BUDGET,
      story: `A flash sale starts at noon: ${SALE.products} products drop their price at once, and shoppers must see the new price within ${duration(SALE.freshSecs)}. For the sale, the database team also wants a hit rate of at least ${HIT_PCT[2]}%. Change the prices, then check how long shoppers can still see the old ones.`,
      goals: [
        hitGoal(HIT_PCT[2]), spofGoal(), dbBusyGoal,
        servedGoal(targets), latGoal(targets), costGoal(BUDGET),
        { id: 'price-change', type: 'exp', text: `Break it: change prices; shoppers see them within ${duration(SALE.freshSecs)}` },
      ],
      hint: `A 1-minute TTL keeps prices fresh, but 1 read in 7 then finds its item expired, so the hit rate can't reach ${HIT_PCT[2]}%. Keep a long TTL instead, and set "When a product changes" to delete the cached copy on each cache server.`,
      takeaway: 'Deleting the cached copy on every change keeps prices fresh without giving up a long TTL. The order matters: write the database first, then delete the key. Delete it first and a read in between can put the old price back into the cache.',
    },
  ],

  // Break-it experiments. A crash takes down the component `target` picks when it starts, or the one of its `targets`
  // whose loss hurts most. `expect` is the outcome that must hold, at peak traffic, for the whole run before it counts.
  experiments: [
    {
      // Any cache could fail; the test takes down the one whose loss hurts most.
      id: 'crash-cache', kind: 'crash', targets: (g) => g.onPath('cache'),
      label: 'Crash cache', labelOn: 'Restart cache',
      needsDesign: 'Build the design first: add a cache and connect the web servers to it, then crash it.',
      on: 'You pulled the plug on a cache server. Everything in its memory is gone.', onTone: 'bad',
      off: 'Cache restarted. A real one starts empty and refills as reads miss; in this game it is warm again at once.',
      expect: served99,
      notMet: (m) => `Only ${m.servedPct.toFixed(1)}% served: the crashed cache's reads all went to the database, which cannot carry them. Add a second cache server, so losing one costs only its share.`,
      observed: (m) => `Observed: one cache down, ${m.servedPct.toFixed(1)}% still served. The hit rate fell to ${Math.round((m.hitRate || 0) * 100)}%, and the database took the rest.`,
    },
    {
      id: 'price-change', kind: 'event',
      label: 'Change prices', labelOn: 'End the sale',
      needsDesign: 'Build the design first, then change prices.',
      on: `Flash sale: ${SALE.products} product prices just dropped in the database.`, onTone: '',
      off: 'Sale over.',
      expect: (m) => m.staleSecs <= SALE.freshSecs,
      notMet: (m) => `Shoppers can see the old price for up to ${duration(m.staleSecs)}: cached pages keep it until their TTL ends. Shorten the TTL, or delete the cached copy when a product changes.`,
      observed: (m) => (m.staleSecs === 0
        ? 'Observed: the web servers deleted the changed products from the cache, so the next reads loaded the new prices.'
        : `Observed: cached pages expire within ${duration(m.staleSecs)}, so the new prices show in time.`),
    },
  ],

  // Messages the engine shows for this level's design.
  text: { ...lbText(), ...replicaText(), levelComplete: levelComplete(4) },

  quiz: {
    passScore: 8,
    passText: passText(4, 'CDN for static content'),
    failText,
    questions: [
      { q: 'A web server uses cache-aside, and the cache does not have product 42. What happens next?', o: ['The cache loads it from the database', 'The request fails, and the shopper retries later', 'The web server reads the DB and caches it', 'It waits for the cache to refresh'], a: 2, e: 'In cache-aside the web server does the work: on a miss it reads the database, stores the answer in the cache, and returns it. The next read of product 42 is a hit.', r: 'How does a web server use a cache?' },
      { q: 'Which data is the best fit for a cache?', o: ['Read often, changed rarely', 'Written often, read rarely', 'Read once, then thrown away', 'Changed on every request'], a: 0, e: 'A cache pays off when the same item is read many times before it changes. Data that changes all the time is stale as soon as it is cached, and data read once never gets a hit.', r: 'What belongs in a cache?' },
      { q: 'You raise the cache TTL from 1 minute to 1 hour. What changes?', o: ['Fewer hits, but every read is always fresh', 'More hits, but changes show up later', 'Nothing, since memory stays the same', 'The cache needs twice the memory'], a: 1, e: 'Items stay cached longer, so fewer reads find them expired and the hit rate goes up. But a changed item can now be served from the cache for up to an hour, unless you delete it when it changes.', r: 'How long can a cached price be wrong?' },
      { q: 'The cache is full and a new item arrives. Which item does LRU evict?', o: ['The one used the fewest times', 'The one added first', 'The biggest one in memory', 'The one used longest ago'], a: 3, e: 'LRU (least recently used) removes the item that has gone longest without a read. LFU removes the one used the fewest times, and FIFO the one added first.', r: 'What happens when the cache is full?' },
      { q: 'Your one cache server fails. The data is safe in the database, so why is that a problem?', o: ['Its data is lost for good when it fails', 'Its reads all fall on the database', 'It slows down every write', 'Users have to log in again'], a: 1, e: 'Every read the cache used to answer now goes to the database, which may not be sized for it. Run several cache servers, so losing one costs only its share, and give the database room for that.', r: 'What happens when a cache restarts?' },
      { q: 'A price changes. In which order should the web server update the database and the cache?', o: ['Delete the cache key, then write the database', 'Update the cache only; the database follows', 'Write the database, then delete the cache key', 'Write both in one shared transaction'], a: 2, e: 'Write the database first, then delete the key: the next read loads the new price. Deleting first leaves a gap where a read can load the old price and cache it again. The database and the cache share no transaction.', r: 'How to update the cache when a price changes' },
      { q: '3,000,000 users each have a 2 KB profile. Roughly how much memory caches the most active 20%?', o: ['~120 MB', '~1.2 GB', '~6 GB', '~12 GB'], a: 1, e: '20% of 3,000,000 is 600,000 profiles. 600,000 × 2 KB = 1,200,000 KB ≈ 1.2 GB. ~6 GB is every profile.', r: 'How to size a cache' },
      { q: 'Reads arrive at 1,000/s and the cache hit rate is 90%. How many reads/s reach the database?', o: ['900', '10', '100', '1,000'], a: 2, e: 'Only misses reach the database: 1,000 × (1 − 0.9) = 100 reads/s. The other 900 are answered from memory.', r: 'How to size a cache' },
      { q: 'Why can a cache much smaller than the database answer most reads?', o: ['A few items get most of the reads', 'Memory is faster than any disk', 'Every item is read about equally often', 'The cache compresses every item'], a: 0, e: 'Popularity is skewed: a small share of items gets most of the reads. Keep those in memory and most reads become hits. If every item were read equally, a cache holding 10% of the data would hit only about 10%.', r: 'What belongs in a cache?' },
      { q: 'Why not keep the shop\'s data in the cache only?', o: ['Caches can only store short text', 'A lookup in memory is slower', 'Each key can hold just one item', 'A restart empties the memory'], a: 3, e: 'Cache servers keep data in volatile memory: a restart or crash loses it. Keep the authoritative copy in a database, and treat the cache as a fast, disposable copy.', r: 'What belongs in a cache?' },
    ],
  },

  lesson,

  // Lesson diagrams. `f` provides the engine's drawing helpers. Each figure sets its own viewBox.
  drawFigures(f) {
    const { $, svgEl, figNode, figArrow, figDefs, figLabel } = f;
    /** A dashed frame with its label, for one panel of a before-and-after picture. */
    const panel = (svg, y, height, label) => {
      svgEl('rect', { x: 10, y, width: 620, height, rx: 12, class: 'tier-box' }, svg);
      figLabel(svg, 24, y + 20, label, 'start', 'tier-label');
    };

    // Hit: the cache answers. Miss: the web server asks the cache, reads the database, then stores the answer.
    const f1 = $('figAside'); f1.textContent = ''; f1.setAttribute('viewBox', '0 0 640 396'); figDefs(f1);
    panel(f1, 10, 150, 'Hit: the cache has it');
    figNode(f1, 'web', 104, 96, 'Web server', 'Wants product 42');
    figNode(f1, 'cache', 536, 96, 'Cache', 'Has product 42');
    figArrow(f1, 198, 86, 442, 86, 'get product 42', null, 320, 78, 'middle');
    figArrow(f1, 442, 106, 198, 106, 'product 42', null, 320, 126, 'middle');
    panel(f1, 176, 210, 'Miss: the cache does not have it');
    figNode(f1, 'web', 104, 286, 'Web server', 'Wants product 42');
    figNode(f1, 'cache', 536, 236, 'Cache', 'No product 42');
    figNode(f1, 'db', 536, 346, 'Read replica', 'On disk');
    figArrow(f1, 198, 262, 442, 230, 'get: miss', '1', 262, 236);
    figArrow(f1, 198, 300, 442, 346, 'read product 42', '2', 214, 350);
    figArrow(f1, 198, 280, 442, 250, 'store it', '3', 330, 286);

    // Warm: nine reads in ten end at the cache. Just restarted: the cache is empty and the database takes all ten.
    const f2 = $('figCold'); f2.textContent = ''; f2.setAttribute('viewBox', '0 0 640 436'); figDefs(f2);
    for (const { y, label, cacheSub, dbSub, toCache, toDb } of [
      { y: 10, label: 'Warm cache', cacheSub: 'Answers 9 in 10', dbSub: 'Sized for misses', toCache: '9 reads in 10', toDb: '1 read in 10' },
      { y: 226, label: 'Cache just restarted', cacheSub: 'Empty after restart', dbSub: 'Overloaded', toCache: '10 misses', toDb: '10 reads in 10' },
    ]) {
      panel(f2, y, 200, label);
      figNode(f2, 'web', 320, y + 66, 'Web server', 'Reads');
      figNode(f2, 'cache', 150, y + 160, 'Cache', cacheSub);
      figNode(f2, 'db', 490, y + 160, 'Read replica', dbSub);
      figArrow(f2, 270, y + 96, 190, y + 130, toCache, null, 216, y + 114, 'end');
      figArrow(f2, 370, y + 96, 450, y + 130, toDb, null, 426, y + 114);
    }

    drawOrder(f, $('figOrder'));
    drawBuilt(f, $('figBuilt'));
    drawBuilt(f, $('figBuiltEnd'));
  },
};
