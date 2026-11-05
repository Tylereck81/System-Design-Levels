// Level 5: CDN for static content.
// Everything specific to this level lives here: components, rules, missions, quiz and text.
import { fmt } from '../js/format.js';
import { servedGoal, latGoal, costGoal, spofGoal, servedAtLeast } from './shared/goals.js';
import { regionUsers, dns, lb, NO_DB_NOTE, replicaDb, cache, cdn } from './shared/components.js';
import { dnsLookup, usersToLb, lbToWeb, webToReplicas, webToCache, usersToCdn, cdnToLb, lbBad, replicaBad, cacheBad, cdnBad } from './shared/connections.js';
import { lbText, replicaText, NO_ORIGIN, levelComplete } from './shared/text.js';
import { ONE_DNS, TWO_LBS, THREE_DBS, THREE_CACHES, ONE_CDN } from './shared/limits.js';
import { failText, passText } from './shared/quiz.js';
import { filesWorkload } from './shared/workload.js';

const targets = { latencyMs: 150, servedPct: 99 };
const FAR_MS = 60;
const BUDGET = 3100;

const farGoal = {
  id: 'far', type: 'metric', text: `Shoppers in America get files in under ${FAR_MS} ms`,
  test: (m) => m.farFileMs != null && m.farFileMs < FAR_MS,
  val: (m) => (m.farFileMs == null ? '—' : fmt(m.farFileMs) + ' ms'),
};
const served99 = servedAtLeast(targets.servedPct);
const duration = (s) => ({ 60: '1 minute', 600: '10 minutes', 3600: '1 hour', 86400: '1 day' }[s] || `${s} seconds`);
const cdnOf = (m) => m.g.onPath('cdn')[0] || null;

export default {
  id: 5,
  saveKey: 'sdl-level5-v1',
  saveVersion: 1,
  targets,
  // Level 4's catalog for the cache, plus the shop's static files (see the lesson's assumptions).
  workload: filesWorkload(),

  components: {
    users: regionUsers(),
    dns: dns(),
    lb: lb(),
    web: {
      name: 'Web server', short: 'Your back-end code',
      desc: 'Runs your back-end code for pages: it checks the cache, then reads or writes the databases. It also sends the shop\'s static files from its own disk. A file takes 2 ms, a tenth of a page\'s work.',
      noDbNote: NO_DB_NOTE,
    },
    db: replicaDb(),
    cache: cache(),
    cdn: cdn(),
  },
  palette: ['dns', 'lb', 'web', 'db', 'cache', 'cdn'],
  limits: { dns: 1, lb: 2, web: 2, db: 3, cache: 3, cdn: 1 },
  limitMsg: {
    dns: ONE_DNS,
    lb: TWO_LBS,
    web: 'Two XL web servers are enough here. More servers in Frankfurt would not bring it any closer to America.',
    db: THREE_DBS,
    cache: THREE_CACHES,
    cdn: ONE_CDN,
  },
  // Level 4's design: two 8 GB caches with a 10-minute TTL that delete changed products, a primary and one replica.
  startNodes: [
    { id: 'u', type: 'users', x: 380, y: 60 },
    { id: 'd', type: 'dns', x: 120, y: 60 },
    { id: 'l1', type: 'lb', x: 250, y: 168, algo: 'rr' },
    { id: 'l2', type: 'lb', x: 510, y: 168, algo: 'rr' },
    { id: 'w1', type: 'web', x: 250, y: 276, size: 'XL' },
    { id: 'w2', type: 'web', x: 510, y: 276, size: 'XL' },
    { id: 'c1', type: 'cache', x: 120, y: 372, size: 'L', ttl: '600', onWrite: 'delete' },
    { id: 'c2', type: 'cache', x: 640, y: 372, size: 'L', ttl: '600', onWrite: 'delete' },
    { id: 'b', type: 'db', x: 120, y: 468, size: 'XL', kind: 'sql', role: 'primary' },
    { id: 'r1', type: 'db', x: 380, y: 468, size: 'XL', kind: 'sql', role: 'replica' },
  ],
  startEdges: [
    { id: 's1', from: 'u', to: 'd' }, { id: 's2', from: 'u', to: 'l1' }, { id: 's3', from: 'u', to: 'l2' },
    { id: 's4', from: 'l1', to: 'w1' }, { id: 's5', from: 'l1', to: 'w2' }, { id: 's6', from: 'l2', to: 'w1' }, { id: 's7', from: 'l2', to: 'w2' },
    { id: 's8', from: 'w1', to: 'b' }, { id: 's9', from: 'w2', to: 'b' }, { id: 's10', from: 'w1', to: 'r1' }, { id: 's11', from: 'w2', to: 'r1' },
    { id: 's12', from: 'w1', to: 'c1' }, { id: 's13', from: 'w2', to: 'c1' }, { id: 's14', from: 'w1', to: 'c2' }, { id: 's15', from: 'w2', to: 'c2' },
  ],
  slots: {
    dns: { x: 120, y: 60 }, lb: { x: 510, y: 168 }, web: { x: 510, y: 276 }, cdn: { x: 640, y: 60 },
    cache: [{ x: 120, y: 372 }, { x: 640, y: 372 }, { x: 380, y: 372 }],
    db: [{ x: 640, y: 468 }, { x: 380, y: 468 }, { x: 120, y: 468 }],
  },

  connections: {
    ok: {
      'dns|users': dnsLookup(),
      'lb|users': usersToLb(),
      'lb|web': lbToWeb(),
      'db|web': webToReplicas(),
      'cache|web': webToCache(),
      'cdn|users': usersToCdn(),
      'cdn|lb': cdnToLb(),
    },
    bad: { ...lbBad(), ...replicaBad(), ...cacheBad(), ...cdnBad() },
  },

  missions: [
    {
      title: 'Shoppers in America', ref: 'CDN', qps: 4000, writes: 0.2, files: 0.5, far: 0.3, budget: BUDGET,
      gate: {
        hidesTraffic: false,
        lo: 45, hi: 60,
        prompt: '<b>Estimate before you build.</b> At peak, shoppers fetch 2,000 files a second; over a whole day that averages 1,000 a second. A file is about 20 KB. How many TB of files does the CDN send in a 30-day month?',
        label: 'Data per month (TB)',
        placeholder: 'e.g. 10',
        acceptedHtml: '<p><b>Estimate accepted.</b></p><div class="calc">1,000 files/s × 20 KB = 20 MB/s<br>20 MB/s × 86,400 s ≈ 1.7 TB a day<br>1.7 TB × 30 days ≈ 52 TB a month<br>At $0.02 per GB: 51,840 GB × $0.02 ≈ $1,037 a month</div>',
        acceptedLog: 'Estimate accepted: about 52 TB of files a month, so the CDN costs about $1,037. Play is unlocked.',
        notNumber: 'Type the estimate as a number of TB, for example 10.',
        hints: [
          { test: (v) => v >= 90 && v <= 115, text: 'That uses the peak. A monthly total follows the average: 1,000 files a second.' },
          { test: (v) => v >= 45000 && v <= 60000, text: 'That looks like GB. Answer in TB: 1 TB is 1,000 GB.' },
          { test: (v) => v >= 1.5 && v <= 2, text: 'That is one day. Multiply by 30 for the month.' },
        ],
        fallback: 'Not quite. Average files per second × 20 KB gives KB per second. Multiply by 86,400 seconds and 30 days, then divide by 1,000,000,000 for TB.',
      },
      story: 'The shop now sells in America too: 30% of shoppers are there, 120 ms from the data center in Frankfurt. Half of all requests are files, such as product photos, CSS and JavaScript, and each one makes that long trip. Serve the files from a CDN, so shoppers in America get them in under 60 ms.',
      goals: [
        { id: 'est', type: 'gate', text: 'Estimate the CDN\'s data per month' },
        farGoal, servedGoal(targets), latGoal(targets), costGoal(BUDGET),
      ],
      hint: 'Add a CDN. Connect Users to it, and connect it to both load balancers: they are its origin. Then select it and pick a TTL long enough that most files are still at the edge when the next request comes. Select Users to see both round trips.',
      takeaway: 'Files now come from an edge near each shopper: about 45 ms for America instead of about 130. The load balancers lost most of their traffic too. Pages still travel to Frankfurt; putting servers in America is Level 7.',
    },
    {
      title: 'The CDN goes down', ref: 'CDN fallback', qps: 4000, writes: 0.2, files: 0.5, far: 0.3, budget: BUDGET,
      story: 'CDNs have outages too, and the CDN now carries half your traffic. If pages link only to the CDN, an outage breaks every photo, stylesheet and script on the site. Make the pages fall back to your own servers.',
      goals: [
        farGoal, spofGoal(), servedGoal(targets), latGoal(targets), costGoal(BUDGET),
        { id: 'crash-cdn', type: 'exp', text: 'Break it: take the CDN down and still serve at least 99%' },
      ],
      hint: 'Select the CDN and set "If the CDN is down" to load files from the origin. Your two XL web servers sent every file before the CDN, so they can again.',
      takeaway: 'With fallback, the outage made files slower, but none failed: the origin took them all back. That works only while the origin can still carry every file, so don\'t size it for the misses alone.',
    },
    {
      title: 'A new logo', ref: 'Invalidation', qps: 4000, writes: 0.2, files: 0.5, far: 0.3, budget: BUDGET,
      story: 'Marketing ships a new logo at 9:00 and wants every shopper to see it within a minute. Edges and shoppers\' browsers both keep files until their TTL runs out. Keep files fast for America, and get the new logo out in time.',
      goals: [
        farGoal, spofGoal(), servedGoal(targets), latGoal(targets), costGoal(BUDGET),
        { id: 'new-logo', type: 'exp', text: 'Break it: ship the new logo; every shopper sees it within a minute' },
      ],
      hint: 'A 1-minute TTL is fresh enough, but then 1 request in 3 misses and America waits too long. Invalidating clears the edges, not the browsers. Keep a long TTL, and set "When a file changes" to give the file a new name.',
      takeaway: 'A new name is a new file: no edge or browser has it, so everyone fetches it at once, and a long TTL stays safe. Build tools do this for you by putting a hash of the file\'s content in its name, such as app.3f9a.css.',
    },
  ],

  // Break-it experiments. A crash takes down the component `target` picks when it starts;
  // `expect` is the outcome that must hold, at peak traffic, for the whole run before it counts.
  experiments: [
    {
      id: 'crash-cdn', kind: 'crash', target: (g) => g.onPath('cdn')[0] || null,
      label: 'Crash CDN', labelOn: 'Restore CDN',
      needsDesign: 'Build the design first: add a CDN and connect Users to it, then take it down.',
      on: 'The CDN is down at every edge.', onTone: 'bad',
      off: 'CDN back up. Files come from the edges again.',
      issue: 'The CDN is down, and pages link their files only to it, so every file fails.',
      expect: served99,
      notMet: (m) => `Only ${m.servedPct.toFixed(1)}% served: every file failed at the CDN. Select the CDN and set "If the CDN is down" to load files from the origin.`,
      observed: (m) => `Observed: CDN down, ${m.servedPct.toFixed(1)}% still served. Files came from Frankfurt again${m.farFileMs != null ? `, in ${fmt(m.farFileMs)} ms for America` : ''}.`,
    },
    {
      id: 'new-logo', kind: 'event',
      label: 'Ship the new logo', labelOn: 'Done',
      needsDesign: 'Build the design first, then ship the new logo.',
      on: 'The new logo.svg is on the origin.', onTone: '',
      off: 'Logo shipped.',
      expect: (m) => m.fileStaleSecs <= 60,
      notMet: (m) => ((cdnOf(m) || {}).onChange === 'purge'
        ? `The edges dropped the old logo, but browsers that already had it keep showing it for up to ${duration(m.fileStaleSecs)}. Give changed files a new name instead.`
        : `Shoppers can see the old logo for up to ${duration(m.fileStaleSecs)}: edges and browsers keep it until its TTL ends. Shorten the TTL, or give changed files a new name.`),
      observed: (m) => (m.fileStaleSecs === 0
        ? 'Observed: pages now link to logo.svg?v=3. No edge or browser had that file, so every shopper got the new logo at once.'
        : `Observed: files expire within ${duration(m.fileStaleSecs)}, so the new logo shows in time.`),
    },
  ],

  // Messages the engine shows for this level's design.
  text: { ...lbText(), ...replicaText(), noOrigin: NO_ORIGIN, levelComplete: levelComplete(5) },

  quiz: {
    passScore: 8,
    passText: passText(5, 'Stateless web tier and autoscaling'),
    failText,
    questions: [
      { q: 'In a design like this one, what does the CDN serve?', o: ['Pages built for each shopper', 'Order and payment requests', 'Photos, CSS and JavaScript', 'Database queries'], a: 2, e: 'A CDN keeps copies of static files, the same for every shopper, on edges near them. Pages built per shopper, orders and queries go to your own servers. Some CDNs can cache whole pages too, but that is a separate feature.', r: 'What a CDN does' },
      { q: 'A shopper asks for photo.jpg, and the nearest edge does not have it. What happens?', o: ['The request fails, and the browser retries in a minute', 'The edge pulls it from the origin, then keeps it', 'The browser asks another shopper\'s device', 'The origin pushes every file to every edge'], a: 1, e: 'On a miss the edge fetches the file from the origin, keeps it for the TTL the origin sends, and returns it. The next shopper near that edge gets a hit.', r: 'How a CDN works' },
      { q: 'Your data center is in Frankfurt. Which shoppers gain most from a CDN?', o: ['Shoppers far from Frankfurt', 'Shoppers next door to the data center', 'Shoppers who only place orders', 'Every shopper gains the same'], a: 0, e: 'An edge is near every shopper, so a far shopper\'s wait drops from the long trip to Frankfurt to the short trip to the edge. Shoppers next to the data center were already close. Orders are not static files.', r: 'What a CDN does' },
      { q: 'You set the CDN\'s TTL to 1 minute. What goes wrong?', o: ['Changed files stay old for days at a time', 'The CDN refuses large files', 'Browsers stop caching files', 'Edges refetch from the origin often'], a: 3, e: 'Files expire so quickly that many requests find them gone, and the edge goes back to the origin. The origin does the work again, and those shoppers wait for the long trip. Too long a TTL has the opposite problem: changed files stay old.', r: 'Considerations' },
      { q: 'Pages link their files only to the CDN, and the CDN goes down. What do shoppers see?', o: ['Pages without photos, styles or scripts', 'Nothing changes, since the edges keep their copies', 'Pages load faster from the origin', 'Only the login page'], a: 0, e: 'Every file request goes to the CDN and fails, so pages arrive without their photos, CSS and JavaScript. Pages themselves still load from your servers.', r: 'Considerations' },
      { q: 'How should a site cope with a CDN outage?', o: ['Shoppers wait until the CDN provider recovers', 'The CDN serves files from its database', 'Every page is switched off for safety', 'Pages fetch failed files from the origin'], a: 3, e: 'The page notices that a file failed and fetches it from your own servers instead. It is slower, and the origin must be able to carry every file again, but nothing breaks.', r: 'Considerations' },
      { q: 'You replace logo.svg and want every shopper to see it now, browsers included. What works?', o: ['Wait for the TTL to run out', 'Link pages to logo.svg?v=3', 'Lower the TTL after the change', 'Invalidate logo.svg on the CDN'], a: 1, e: 'A new URL is a file no edge or browser has, so everyone fetches it at once. Invalidating clears the edges, but browsers keep their own copy until it expires. Lowering the TTL only affects copies made after the change.', r: 'Invalidating files' },
      { q: 'You invalidate a file through the CDN\'s API. Which copies can still be old?', o: ['The copies on the edges', 'The copy on the origin', 'Copies in shoppers\' browsers', 'None: every copy everywhere is cleared'], a: 2, e: 'Invalidation removes the file from the CDN\'s edges. Browsers that cached the old file keep it until their own copy expires. That is one reason teams version file names instead.', r: 'Invalidating files' },
      { q: 'Why move rarely used files off the CDN?', o: ['The CDN cannot store them', 'Rarely used files slow down the popular ones', 'Browsers block rarely used files', 'You pay per GB, and they rarely get hits'], a: 3, e: 'You pay for the data the CDN sends and receives. A rarely used file has usually expired at the edge by the next request, so it costs you the trip to the origin and the transfer, with little speed gained.', r: 'Considerations' },
      { q: 'A site sends 200 files/s on average, 50 KB each. Roughly how much data is that per day?', o: ['~8.6 TB', '~860 GB', '~86 GB', '~86 TB'], a: 1, e: '200 × 50 KB = 10 MB/s. 10 MB/s × 86,400 s = 864,000 MB ≈ 860 GB a day, or about 26 TB in a 30-day month.', r: 'Numbers to carry into the interview' },
    ],
  },

  // Lesson tab content (HTML). The diagram below draws into its figCdn.
  lessonHtml: `
    <p class="label">Level 5 · CDN for static content</p>
    <h1>CDN for static content</h1>
    <p class="lede">The shop's data center is in Frankfurt. Shoppers in Europe are about 40 ms away, but shoppers in America are 120 ms away, and every photo, stylesheet and script makes that trip. In this level you put the files on servers near every shopper, choose how long they stay there, and see what happens when the CDN fails or a file changes.</p>
    <div class="goals-box">
      <div><b>You will learn</b>How a CDN works, and what it costs.</div>
      <div><b>You will decide</b>The TTL, what to do when a file changes, and what pages do when the CDN is down.</div>
      <div><b>You will estimate</b>How much data the CDN sends in a month.</div>
    </div>

    <section>
      <h2>What a CDN does</h2>
      <p class="src">Content delivery network</p>
      <p>A CDN is a network of servers spread around the world, called <b>edges</b>, that keep copies of static files: images, video, CSS and JavaScript. These files are the same for every shopper, so any edge can hand them out. Each shopper gets them from the nearest edge.</p>
      <p>Distance is time. If a CDN's only edge were in Frankfurt, shoppers in Paris would get files quickly, and shoppers in Sydney slowly. Real CDNs run edges in many cities, so most shoppers have one nearby:</p>
      <div class="tbl-wrap"><table class="t">
        <thead><tr><th>Round trip in this game</th><th>To the data center in Frankfurt</th><th>To the nearest edge</th></tr></thead>
        <tbody>
          <tr><td>Shopper in Europe</td><td class="n">40 ms</td><td class="n">40 ms</td></tr>
          <tr><td>Shopper in America</td><td class="n">120 ms</td><td class="n">40 ms</td></tr>
        </tbody>
      </table></div>
      <p>Some CDNs can also cache whole HTML pages, keyed by path, query string, cookies and headers. That is dynamic content caching; this level sticks to static files.</p>
    </section>

    <section>
      <h2>How a CDN works</h2>
      <p class="src">Origin pull</p>
      <figure class="fig"><svg id="figCdn" viewBox="0 0 640 270" role="img" aria-label="A shopper in Paris asks the CDN edge for logo.svg. The edge does not have it, so it fetches it from the origin and keeps it for the TTL. A shopper in Lyon then asks for the same file and gets it straight from the edge."></svg><figcaption>The first request fills the edge; nearby requests are hits until the TTL ends</figcaption></figure>
      <ol>
        <li>Pages link files to the CDN's address, such as <code>https://cdn.example.com/logo.svg</code>. The shopper's browser asks the nearest edge for it.</li>
        <li>If the edge does not have the file (a <b>miss</b>), it requests it from the <b>origin</b>: your web servers, or a storage service.</li>
        <li>The origin returns the file with a time to live, in a header such as <code>Cache-Control: max-age=3600</code>.</li>
        <li>The edge keeps the file and returns it to the shopper.</li>
        <li>The next shopper near that edge gets the file straight from it (a <b>hit</b>), until the TTL expires.</li>
      </ol>
      <p>The result: files reach far shoppers sooner, and the origin sends far fewer of them. Pages built for each shopper still go to your data center. Level 7 adds data centers closer to them.</p>
    </section>

    <section>
      <h2>Considerations</h2>
      <p class="src">Using a CDN</p>
      <ul>
        <li><b>Cost.</b> A CDN is a third-party service, and you pay for the data it sends and receives. A file that is rarely requested has usually expired at the edge by the next request, so it costs transfer and gains little. Keep such files off the CDN.</li>
        <li><b>Expiry.</b> Set the TTL with care. Too long, and a changed file stays old. Too short, and edges keep fetching files from the origin again.</li>
        <li><b>Fallback.</b> Plan for the CDN failing. Pages should notice that a file failed to load and fetch it from the origin instead, and the origin must be able to carry that load.</li>
      </ul>
    </section>

    <section>
      <h2>Invalidating files</h2>
      <p class="src">Invalidation and versioning</p>
      <p>To replace a file before its TTL ends, you have two options:</p>
      <ul>
        <li><b>Invalidate it</b> through the CDN provider's API. The edges drop the file, and the next request fetches the new one. Browsers that already cached the old file keep it until their own copy expires.</li>
        <li><b>Version it</b>: give the new file a new URL, such as <code>logo.svg?v=3</code>, and change the pages to link to it. No edge or browser has that URL yet, so everyone fetches the new file. Build tools often put a hash of the content in the name instead, such as <code>app.3f9a.css</code>.</li>
      </ul>
      <p>With versioned names a file never changes under the same URL, so its TTL can be very long.</p>
    </section>

    <section>
      <h2>How this level is simulated</h2>
      <p class="src">Game assumptions</p>
      <p>Half of all requests are files. When Users connect to a CDN, files go to it, and pages still go to the load balancer. Without one, files go to the load balancer like pages and end at a web server, which sends a file in 2 ms. A file is a tenth of a page's work. An edge answers a hit in 1 ms. A miss goes on to the origin and takes as long as the shopper's own trip there: 40 ms from Europe, 120 ms from America. The share of hits = TTL ÷ (TTL + 30 s).</p>
      <p class="assume">Game assumptions: 70% of shoppers are in Europe and 30% in America. Each file is requested at an edge about every 30 seconds. A file is 20 KB on average. The CDN costs $0.02 per GB sent, billed on the day's average traffic, half the peak; data sent to it on misses is too little to count. A server's price includes its network traffic. Edges and browsers keep a file for the same TTL. A page notices a failed file at once. The CDN never runs out of capacity.</p>
    </section>

    <section>
      <h2>Numbers to carry into the interview</h2>
      <p class="src">Bandwidth estimates</p>
      <p><b>Data per month</b> = average files per second × file size × about 2.6 million seconds. For example, 1,000 files/s × 20 KB = 20 MB/s, about 52 TB in a 30-day month.</p>
      <p><b>What a far user gains</b> = the round trip to the data center minus the round trip to the nearest edge, on every hit. Here that is 120 ms down to 40 ms for each file.</p>
    </section>

    <section>
      <h2>How each mission maps to the interview</h2>
      <p class="src">Interview loop · times for a 45-minute interview (formats vary by company)</p>
      <div class="steps4">
        <div><span>Step 1 · 5–8 min</span><b>Scope it</b>Where are the users? How much is static? Estimate the bandwidth.</div>
        <div><span>Step 2 · 10–12 min</span><b>Sketch it</b>A CDN for files, the origin behind it.</div>
        <div><span>Step 3 · 15–20 min</span><b>Go deep</b>TTL, invalidation, versioned names, cost.</div>
        <div><span>Step 4 · 5 min</span><b>Stress it</b>Take the CDN down. Change a file.</div>
      </div>
      <p>When you add a CDN in an interview, say which files go on it, the TTL, how you replace a changed file, and what pages do when the CDN is down.</p>
    </section>
`,

  // Lesson diagram. `f` provides the engine's drawing helpers.
  drawFigures(f) {
    const { $, figNode, figArrow, figDefs } = f;
    const f1 = $('figCdn'); f1.textContent = ''; figDefs(f1);
    figNode(f1, 'users', 120, 40, 'Shopper in Paris', 'First request');
    figNode(f1, 'users', 520, 40, 'Shopper in Lyon', 'A minute later');
    figNode(f1, 'cdn', 320, 130, 'CDN edge', 'Near both shoppers');
    figNode(f1, 'web', 320, 236, 'Origin', 'Your web servers');
    figArrow(f1, 150, 70, 270, 100, '1 · get logo.svg: miss', null, 214, 122, 'end');
    figArrow(f1, 320, 160, 320, 206, '2 · fetch it, keep it for the TTL', null, 332, 188, 'start');
    figArrow(f1, 490, 70, 370, 100, '3 · get logo.svg: hit', null, 426, 122, 'start');
  },
};
