// @ts-check
/** @import { Level, Goal } from '../js/types.js' */
// Level 4: Cache tier.
// Everything specific to this level lives here: components, rules, missions, quiz and text.
import { servedGoal, latGoal, costGoal, spofGoal, servedAtLeast } from './shared/goals.js';
import { shopUsers, dns, lb, NO_DB_NOTE, replicaDb, cache } from './shared/components.js';
import { dnsLookup, usersToLb, lbToWeb, webToReplicas, webToCache, lbBad, replicaBad, cacheBad } from './shared/connections.js';
import { lbText, replicaText, levelComplete } from './shared/text.js';
import { ONE_DNS, TWO_LBS, THREE_CACHES } from './shared/limits.js';
import { failText, passText } from './shared/quiz.js';
import { catalogWorkload } from './shared/workload.js';

const targets = { latencyMs: 150, servedPct: 99 };
const DB_BUSY = 0.7;

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

/** @type {Level} */
export default {
  id: 4,
  saveKey: 'sdl-level4-v1',
  saveVersion: 1,
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
      title: 'Cache the hot products', ref: 'Cache-aside', qps: 2000, writes: 0.2, budget: 2100,
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
      story: 'Most of the 1,600 reads a second are product pages, and the same popular products are read again and again. Finance wants the bill under $2,100 a month. Today it is $2,295, and each XL replica costs $450. Put a cache in front of the database: web servers check it first, and only misses reach a replica. Then one replica is enough.',
      goals: [
        { id: 'est', type: 'gate', text: 'Estimate the memory for the most-viewed products' },
        hitGoal(80), dbBusyGoal,
        servedGoal(targets), latGoal(targets), costGoal(2100),
      ],
      hint: 'Remove one replica, add a cache and connect both web servers to it. 4 GB holds the top 20% of products, but entries also expire, so give it room to spare: more memory, a longer TTL, or both. Select the cache to see its hit rate.',
      takeaway: 'Most reads now end in memory, so one replica is enough and the bill went down. A cache works because a few items get most of the reads. Size it with room to spare: entries expire, and the hot set grows.',
    },
    {
      title: 'The cache goes down', ref: 'Cache failure', qps: 2000, writes: 0.2, budget: 2100,
      story: 'The cache is now a single point of failure. A cache server that restarts comes back empty, so every read it used to answer goes to the database until it refills. With one cache, that is all 1,600 reads a second, on one replica. Make sure the site survives losing a cache.',
      goals: [
        hitGoal(80), spofGoal(), dbBusyGoal,
        servedGoal(targets), latGoal(targets), costGoal(2100),
        { id: 'crash-cache', type: 'exp', text: 'Break it: crash a cache and still serve at least 99%' },
      ],
      hint: 'Run two cache servers: the web servers split the keys between them, so losing one costs only its half of the hits. Two 4 GB caches hold as much as one 8 GB cache. Connect both web servers to both caches.',
      takeaway: 'With two caches, losing one sent only its half of the keys to the database, and the replica coped. A real cache comes back empty after a restart and refills as reads miss. Until then the database carries the extra load, so plan for it.',
    },
    {
      title: 'Prices must be fresh', ref: 'Cache consistency', qps: 2000, writes: 0.2, budget: 2100,
      story: 'A flash sale starts at noon: 300 products drop their price at once, and shoppers must see the new price within a minute. For the sale, the database team also wants a hit rate of at least 86%. Change the prices, then check how long shoppers can still see the old ones.',
      goals: [
        hitGoal(86), spofGoal(), dbBusyGoal,
        servedGoal(targets), latGoal(targets), costGoal(2100),
        { id: 'price-change', type: 'exp', text: 'Break it: change prices; shoppers see them within a minute' },
      ],
      hint: 'A 1-minute TTL keeps prices fresh, but 1 read in 7 then finds its item expired, so the hit rate can\'t reach 86%. Keep a long TTL instead, and set "When a product changes" to delete the cached copy on each cache server.',
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
      on: 'Flash sale: 300 product prices just dropped in the database.', onTone: '',
      off: 'Sale over.',
      expect: (m) => m.staleSecs <= 60,
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
      { q: 'A web server uses cache-aside, and the cache does not have product 42. What happens next?', o: ['The cache loads it from the database', 'The request fails, and the shopper retries later', 'The web server reads the DB and caches it', 'It waits for the cache to refresh'], a: 2, e: 'In cache-aside the web server does the work: on a miss it reads the database, stores the answer in the cache, and returns it. The next read of product 42 is a hit.', r: 'Cache-aside' },
      { q: 'Which data is the best fit for a cache?', o: ['Read often, changed rarely', 'Written often, read rarely', 'Read once, then thrown away', 'Changed on every request'], a: 0, e: 'A cache pays off when the same item is read many times before it changes. Data that changes all the time is stale as soon as it is cached, and data read once never gets a hit.', r: 'When to cache' },
      { q: 'You raise the cache TTL from 1 minute to 1 hour. What changes?', o: ['Fewer hits, but every read is always fresh', 'More hits, but changes show up later', 'Nothing, since memory stays the same', 'The cache needs twice the memory'], a: 1, e: 'Items stay cached longer, so fewer reads find them expired and the hit rate goes up. But a changed item can now be served from the cache for up to an hour, unless you delete it when it changes.', r: 'Expiration (TTL)' },
      { q: 'The cache is full and a new item arrives. Which item does LRU evict?', o: ['The one used the fewest times', 'The one added first', 'The biggest one in memory', 'The one used longest ago'], a: 3, e: 'LRU (least recently used) removes the item that has gone longest without a read. LFU removes the one used the fewest times, and FIFO the one added first.', r: 'Eviction' },
      { q: 'Your one cache server fails. The data is safe in the database, so why is that a problem?', o: ['Its data is lost for good when it fails', 'Its reads all fall on the database', 'It slows down every write', 'Users have to log in again'], a: 1, e: 'Every read the cache used to answer now goes to the database, which may not be sized for it. Run several cache servers, so losing one costs only its share, and give the database room for that.', r: 'Cache failure' },
      { q: 'A price changes. In which order should the web server update the database and the cache?', o: ['Delete the cache key, then write the database', 'Update the cache only; the database follows', 'Write the database, then delete the cache key', 'Write both in one shared transaction'], a: 2, e: 'Write the database first, then delete the key: the next read loads the new price. Deleting first leaves a gap where a read can load the old price and cache it again. The database and the cache share no transaction.', r: 'Cache consistency' },
      { q: '3,000,000 users each have a 2 KB profile. Roughly how much memory caches the most active 20%?', o: ['~120 MB', '~1.2 GB', '~6 GB', '~12 GB'], a: 1, e: '20% of 3,000,000 is 600,000 profiles. 600,000 × 2 KB = 1,200,000 KB ≈ 1.2 GB. ~6 GB is every profile.', r: 'Estimating cache memory' },
      { q: 'Reads arrive at 1,000/s and the cache hit rate is 90%. How many reads/s reach the database?', o: ['900', '10', '100', '1,000'], a: 2, e: 'Only misses reach the database: 1,000 × (1 − 0.9) = 100 reads/s. The other 900 are answered from memory.', r: 'Hit rate' },
      { q: 'Why can a cache much smaller than the database answer most reads?', o: ['A few items get most of the reads', 'Memory is faster than any disk', 'Every item is read about equally often', 'The cache compresses every item'], a: 0, e: 'Popularity is skewed: a small share of items gets most of the reads. Keep those in memory and most reads become hits. If every item were read equally, a cache holding 10% of the data would hit only about 10%.', r: 'Hot data' },
      { q: 'Why not keep the shop\'s data in the cache only?', o: ['Caches can only store short text', 'A lookup in memory is slower', 'Each key can hold just one item', 'A restart empties the memory'], a: 3, e: 'Cache servers keep data in volatile memory: a restart or crash loses it. Keep the authoritative copy in a database, and treat the cache as a fast, disposable copy.', r: 'When to cache' },
    ],
  },

  // Lesson tab content (HTML). The diagram below draws into its figAside.
  lessonHtml: `
    <p class="label">Level 4 · The cache tier</p>
    <h1>Cache tier</h1>
    <p class="lede">Replicas share the reads, but every read still waits for a database, and replicas are expensive. Most reads ask for the same popular items again and again. In this level you keep those items in memory, size the cache, choose how long entries live, and see what happens when the cache fails or the data changes.</p>
    <div class="goals-box">
      <div><b>You will learn</b>How cache-aside works, and how memory and TTL set the hit rate.</div>
      <div><b>You will decide</b>Cache size, TTL, how many cache servers, and what to do when data changes.</div>
      <div><b>You will estimate</b>The memory that holds the most-read items.</div>
    </div>

    <section>
      <h2>Why a cache</h2>
      <p class="src">Cache tier · latency numbers</p>
      <p>A cache is a temporary store in memory for data that is expensive to fetch and asked for often. Reading memory takes about 100 nanoseconds; a disk seek takes about 10 milliseconds, some 100,000 times longer. A cache tier sits next to the database: it answers repeat reads quickly, takes load off the database, and can be scaled on its own.</p>
    </section>

    <section>
      <h2>Cache-aside</h2>
      <p class="src">Cache-aside (lazy loading)</p>
      <figure class="fig"><svg id="figAside" viewBox="0 0 640 260" role="img" aria-label="The web server first asks the cache for product 42. On a miss it reads the database, then stores the answer in the cache, so the next read is a hit."></svg><figcaption>On a miss, the web server reads the database and fills the cache</figcaption></figure>
      <ol>
        <li>The web server asks the cache for the item. If it is there (a <b>hit</b>), done.</li>
        <li>If not (a <b>miss</b>), the web server reads the database.</li>
        <li>It stores the answer in the cache with a time to live, then returns it.</li>
      </ol>
<pre class="code">product = cache.get('product:42')
if product is None:                      # miss
    product = db.query_product(42)
    cache.set('product:42', product, ttl=600)
return product</pre>
      <p>Only items someone asked for get cached, so memory holds what is actually read. Some guides call this read-through. Strictly, in read-through the cache itself loads from the database; in cache-aside the application does.</p>
    </section>

    <section>
      <h2>What to cache, and how much memory</h2>
      <p class="src">Hot data</p>
      <p>Cache data that is <b>read often and changed rarely</b>, such as product pages, profiles and settings. Keep the real copy in the database: a cache keeps data in volatile memory, and a restart empties it.</p>
      <p>A cache much smaller than the database still answers most reads, because popularity is skewed: a few items get most of the reads. In this level, 80% of views go to the most-viewed 20% of products, and the same holds within that 20%. Memory for that hot share answers most reads:</p>
      <div class="tbl-wrap"><table class="t">
        <thead><tr><th>Cache memory (game)</th><th>Share of the catalog</th><th>Share of reads it holds</th><th>Cost / month</th></tr></thead>
        <tbody>
          <tr><td>2 GB</td><td class="n">10%</td><td class="n">73%</td><td class="n">$20</td></tr>
          <tr><td>4 GB</td><td class="n">20%</td><td class="n">80%</td><td class="n">$40</td></tr>
          <tr><td>8 GB</td><td class="n">40%</td><td class="n">88%</td><td class="n">$80</td></tr>
          <tr><td>16 GB</td><td class="n">80%</td><td class="n">97%</td><td class="n">$160</td></tr>
        </tbody>
      </table></div>
      <p>Give the cache room to spare: the hot set grows, and you want headroom before memory runs out.</p>
    </section>

    <section>
      <h2>Expiration: how long an entry lives</h2>
      <p class="src">Expiration (TTL)</p>
      <p>Each entry gets a <b>time to live</b>. When it expires it is removed, and the next read misses and reloads it from the database. Without one, entries stay in memory forever.</p>
      <ul>
        <li><b>Too short:</b> entries keep expiring, so many reads miss and the database does the work again.</li>
        <li><b>Too long:</b> when the data changes, the cache keeps serving the old copy until it expires.</li>
      </ul>
    </section>

    <section>
      <h2>Keeping the cache and the database in step</h2>
      <p class="src">Cache consistency</p>
      <p>The database and the cache are separate systems, and no transaction covers both, so they can disagree for a while. The common fix in cache-aside: <b>write the database, then delete the key</b> from the cache. The next read misses and loads the new value.</p>
      <p>Order matters. Delete first, and a read can arrive in between, load the old value from the database and put it back in the cache. Even the right order leaves rare races, and keeping caches consistent across regions is harder still. Large systems add extra safeguards on top.</p>
    </section>

    <section>
      <h2>When the cache fails</h2>
      <p class="src">Cache failure</p>
      <p>One cache server is a single point of failure: not for the data, which is safe in the database, but for the load. When it goes, every read it answered falls on the database at once. A restarted cache is empty (a <b>cold cache</b>), so the database carries that load until reads refill it.</p>
      <ul>
        <li>Run <b>several cache servers</b>, ideally in different places. The web servers split the keys over them, so losing one costs only its share.</li>
        <li><b>Overprovision memory</b> by a margin, so growth does not push out the hot data.</li>
        <li>Size the database for what it would face with part of the cache gone.</li>
      </ul>
    </section>

    <section>
      <h2>Eviction: when the cache is full</h2>
      <p class="src">Eviction policies</p>
      <p>A full cache must remove an entry to add a new one. That is <b>eviction</b>.</p>
      <ul>
        <li><b>LRU</b>, least recently used: remove the entry that has gone longest without a read. The most common choice.</li>
        <li><b>LFU</b>, least frequently used: remove the entry read the fewest times.</li>
        <li><b>FIFO</b>, first in, first out: remove the oldest entry, however popular.</li>
      </ul>
    </section>

    <section>
      <h2>How this level is simulated</h2>
      <p class="src">Game assumptions</p>
      <p>Each web server sends its reads to its cache servers first, with the keys split evenly over them. A cache's hit rate = the share of reads its memory holds × TTL ÷ (TTL + 10 s). Misses, and every write, go to the databases as in Level 3. A crashed cache's keys go straight to the database.</p>
      <p class="assume">Game assumptions: the catalog is 20 GB (2,000,000 products at 10 KB each). Popularity follows the 80/20 rule at every scale, so memory holding a share x of the catalog holds x<sup>0.139</sup> of reads. A cached product is read about every 10 seconds, so a share TTL ÷ (TTL + 10 s) of its reads find it fresh. A cache server handles 10,000 lookups/s, takes 0.1 ms per lookup and costs $10 per GB a month. A restarted cache is warm again at once. Products change rarely, so deleting changed ones adds no misses worth counting. Orders and carts are written to the database and do not touch cached product pages.</p>
    </section>

    <section>
      <h2>Numbers to carry into the interview</h2>
      <p class="src">Cache sizing</p>
      <p><b>Database reads</b> = reads × (1 − hit rate). At 90% hits, the database sees one read in ten.</p>
      <p><b>Cache memory</b> = items × size of each × the hot share you want to hold, plus headroom. For example, 1,000,000 profiles at 5 KB with the top 20% cached: 200,000 × 5 KB = 1 GB, so plan for about 1.5 GB.</p>
    </section>

    <section>
      <h2>How each mission maps to the interview</h2>
      <p class="src">Interview loop · times for a 45-minute interview (formats vary by company)</p>
      <div class="steps4">
        <div><span>Step 1 · 5–8 min</span><b>Scope it</b>Which data is read often? Estimate its size.</div>
        <div><span>Step 2 · 10–12 min</span><b>Sketch it</b>Cache-aside next to the database.</div>
        <div><span>Step 3 · 15–20 min</span><b>Go deep</b>Memory, TTL, invalidation, eviction.</div>
        <div><span>Step 4 · 5 min</span><b>Stress it</b>Crash the cache. Change the data.</div>
      </div>
      <p>When you add a cache in an interview, say what you cache, the TTL, how you invalidate on writes, and what happens to the database when the cache is cold.</p>
    </section>
`,

  // Lesson diagram. `f` provides the engine's drawing helpers.
  drawFigures(f) {
    const { $, figNode, figArrow, figDefs } = f;
    const f1 = $('figAside'); f1.textContent = ''; figDefs(f1);
    figNode(f1, 'web', 104, 130, 'Web server', 'GET product 42');
    figNode(f1, 'cache', 536, 50, 'Cache', 'In memory');
    figNode(f1, 'db', 536, 210, 'Read replica', 'On disk');
    figArrow(f1, 198, 104, 442, 40, '1 · get: miss', null, 310, 56, 'middle');
    figArrow(f1, 198, 124, 442, 66, '3 · set, TTL 10 min', null, 346, 112, 'middle');
    figArrow(f1, 198, 150, 442, 202, '2 · read the database', null, 330, 200, 'middle');
  },
};
