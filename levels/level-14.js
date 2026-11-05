// Level 14: URL shortener.
// Everything specific to this level lives here: components, rules, missions, quiz and text.
import { fmt } from '../js/format.js';
import { servedGoal, latGoal, costGoal, servedAtLeast, fmtPct } from './shared/goals.js';
import { dns, lb, NO_DB_NOTE, autoscaleSubOf, scalingChoices, db, cache } from './shared/components.js';
import { dnsLookup, usersToLb, lbToWeb, webToDb, lbBad, replicaBad, cacheBad } from './shared/connections.js';
import { lbText, levelComplete } from './shared/text.js';
import { failText, passText } from './shared/quiz.js';
import { dayTraffic } from './shared/workload.js';

const targets = { latencyMs: 150, servedPct: 99 };
const BUDGET = 1300;
const WRITES = 1 / 11; // 10 clicks for every new link
const REPEAT = 0.5; // clicks from a browser that has followed the link before
const VIRAL = 1500; // extra clicks a second on one link
const BULK = 3000; // new links a second from one account

const counted = (m) => !!m.link && m.link.counted > 0.9999;
const countGoal = { id: 'counted', type: 'metric', text: 'Every click is counted', test: counted, val: (m) => (m.link ? fmtPct(100 * m.link.counted) : '—') };
const privateGoal = { id: 'private', type: 'metric', text: 'Codes can\'t be guessed from each other', test: (m) => !!m.link && m.link.code !== 'base62', val: (m) => (m.link ? (m.link.code === 'base62' ? 'in sequence' : 'hashed') : '—') };
const served99 = servedAtLeast(targets.servedPct);
// The web server's settings as the canvas shows them (saved settings are checked on load, so these are valid options).
const codeName = { base62: 'base 62', hash: 'hash', bloom: 'hash + bloom' };
const ttlChoice = cache().choices[0];

export default {
  id: 14,
  saveKey: 'sdl-level14-v1',
  saveVersion: 1,
  targets,
  // The day's traffic curve (for the autoscaled web servers). repeatClicks: clicks from a browser that has followed
  // the link before. catalogGB: the links clicked in a month, readGapSecs: seconds between clicks on a link (for the cache).
  workload: { day: dayTraffic(), repeatClicks: REPEAT, catalogGB: 20, readGapSecs: 60 },

  // The mock interview's brief and self-check list for this problem (see mock.js).
  mock: {
    title: 'URL shortener',
    brief: 'Design a URL shortener: people turn long links into short ones, and every click on a short link redirects to the long one. 60 million new links a day, 10 clicks for each, links kept for 10 years; codes use 0–9, a–z and A–Z.',
    checklist: [
      'Estimated writes, reads and storage (about 694 and 6,900 a second; 21.9 TB over 10 years)',
      'Worked out the code length: 7 characters for 219 billion links',
      'Chose 301 or 302 and said why: less load, or every click counted',
      'Compared a hash with a collision check against base 62 of a unique ID',
      'Put a cache in front of the database for redirects',
      'Limited link creation per account against bulk scripts',
    ],
  },

  components: {
    users: {
      name: 'Users', sub: 'Shorten links, click them',
      desc: 'People who shorten long links and people who click short ones. For every new link there are 10 clicks. A click asks for the long link behind a code, such as lnk.example/aZ3k9Qe, and gets a redirect.',
    },
    dns: dns(),
    lb: lb(),
    web: {
      name: 'Link service', short: 'Shortens and redirects',
      desc: 'Your web servers: POST /api/v1/shorten makes a code for a long link; GET /{code} looks it up and answers with a redirect. An autoscaled group of L servers, as in Level 6.',
      noDbNote: NO_DB_NOTE,
      subOf: (n, size) => `${autoscaleSubOf(n, size)} · ${n.redirect === '301' ? '301' : '302'} · ${codeName[n.code] || 'base 62'}`,
      choices: [
        ...scalingChoices(),
        {
          key: 'redirect', label: 'Redirect',
          options: [
            { id: '301', name: '301 Moved Permanently', sub: 'the browser remembers it', note: 'The browser keeps the redirect, so a second click on the same link goes straight to the long link. Less load, but you never see those clicks.', log: 'Redirects set to 301: browsers remember them.' },
            { id: '302', name: '302 Found', sub: 'every click comes back', note: 'A temporary redirect: every click asks your servers again, so you can count each one (when, from where). More load.', log: 'Redirects set to 302: every click reaches the servers.' },
          ],
        },
        {
          key: 'code', label: 'Short code',
          options: [
            { id: 'base62', name: 'Base 62 of a unique ID', sub: 'next ID, no lookup', note: 'Each new link gets the next unique ID, written in base 62 (0–9, a–z, A–Z). No collisions, one insert. But codes follow each other, so anyone can guess the next one.', log: 'Short codes are now base 62 of a unique ID.' },
            { id: 'hash', name: 'Hash, check the database', sub: 'first 7 characters', note: 'Hash the long link and keep 7 characters. Another link may already have them, so look the code up first and rehash on a collision: two queries for every new link.', log: 'Short codes are now hashed, with a database check.' },
            { id: 'bloom', name: 'Hash, check a bloom filter', sub: 'memory answers most checks', note: 'A bloom filter in memory says "surely not used" for almost every new code; only its rare false positives (1% here) go to the database.', log: 'Short codes are now hashed, checked against a bloom filter.' },
          ],
        },
        {
          key: 'limit', label: 'New links per account',
          options: [
            { id: 'none', name: 'No limit', sub: 'any account, any rate', note: 'Anyone can create links as fast as they like.', log: 'New links are no longer limited.' },
            { id: 'account', name: 'Rate limited', sub: '10 a minute per account', note: 'Each account may create 10 links a minute, as in Level 10; more get 429 Too Many Requests.', log: 'New links limited to 10 a minute per account.' },
          ],
        },
      ],
    },
    db: { ...db(), desc: 'The table of links: id, code, long link. Every new link is a write; every click the cache misses is a read.' },
    cache: { ...cache(), desc: 'Keeps code → long link in memory. A link never changes, so a cached copy never goes stale. In this game it handles 10,000 lookups/s.', subOf: (n, size) => `${size.mem} GB · TTL ${(ttlChoice.options.find((o) => o.id === n.ttl) || ttlChoice.options[1]).short}`, choices: [ttlChoice] },
  },
  palette: ['dns', 'lb', 'web', 'db', 'cache'],
  limits: { dns: 1, lb: 1, web: 1, db: 1, cache: 1 },
  limitMsg: {
    dns: 'You only need one DNS service.',
    lb: 'One load balancer is enough in this level.',
    web: 'One autoscaled group of web servers is enough: it grows on its own.',
    db: 'One database is enough here: let the cache take the clicks.',
    cache: 'One cache is enough: pick its size in the inspector.',
  },
  // One data center: an autoscaled link service with 301 redirects and base 62 codes, and one database.
  startNodes: [
    { id: 'u', type: 'users', x: 380, y: 60 },
    { id: 'd', type: 'dns', x: 120, y: 60 },
    { id: 'l', type: 'lb', x: 380, y: 168, algo: 'rr' },
    { id: 'w', type: 'web', x: 380, y: 276, size: 'L', scaling: 'auto', redirect: '301', code: 'base62', limit: 'none' },
    { id: 'b', type: 'db', x: 380, y: 420, size: 'XL', kind: 'sql' },
  ],
  startEdges: [
    { id: 's1', from: 'u', to: 'd' }, { id: 's2', from: 'u', to: 'l' },
    { id: 's3', from: 'l', to: 'w' }, { id: 's4', from: 'w', to: 'b' },
  ],
  slots: { dns: { x: 120, y: 60 }, lb: { x: 380, y: 168 }, web: { x: 380, y: 276 }, db: { x: 380, y: 420 }, cache: { x: 640, y: 348 } },

  connections: {
    ok: {
      'dns|users': dnsLookup(),
      'lb|users': usersToLb(),
      'lb|web': lbToWeb(),
      'db|web': webToDb(),
      'cache|web': { from: 'web', to: 'cache', label: 'lookups', desc: 'For each click the link service asks the cache for the code first. On a miss it reads the database, then stores the link in the cache.' },
    },
    bad: { ...lbBad(), ...replicaBad(), ...cacheBad() },
  },

  missions: [
    {
      title: 'Short links', ref: 'URL redirecting', qps: 2200, writes: WRITES, budget: BUDGET,
      gate: {
        hidesTraffic: false,
        lo: 7, hi: 7,
        prompt: '<b>Estimate before you build.</b> The plan: 60 million new links a day, kept for 10 years, about 219 billion in all. Codes use 0–9, a–z and A–Z: 62 characters. How many characters does a code need?',
        label: 'Characters',
        placeholder: 'e.g. 5',
        acceptedHtml: '<p><b>Estimate accepted.</b></p><div class="calc">60 million × 365 × 10 ≈ 219 billion links<br>62⁶ ≈ 56.8 billion: too few<br>62⁷ ≈ 3.5 trillion: enough, so 7 characters</div>',
        acceptedLog: 'Estimate accepted: 7 characters. Play is unlocked.',
        notNumber: 'Type the number of characters, for example 5.',
        hints: [
          { test: (v) => v === 6, text: '62⁶ ≈ 56.8 billion codes, fewer than 219 billion links.' },
          { test: (v) => v <= 5, text: 'Far too few: 62⁵ is under a billion codes.' },
          { test: (v) => v >= 8, text: 'That works, but shorter is the point: 62⁷ ≈ 3.5 trillion is already enough.' },
        ],
        fallback: 'Not quite. Find the smallest n with 62ⁿ above 219 billion.',
      },
      story: `A link service with 200 new links and 2,000 clicks a second. Redirects are 301, so a browser that has followed a link goes straight there next time: half the clicks never reach you. Keep it fast when a link goes viral: ${fmt(VIRAL)} more clicks a second, from people who have never clicked it.`,
      goals: [
        { id: 'est', type: 'gate', text: 'Estimate the code length' },
        servedGoal(targets), latGoal(targets), costGoal(BUDGET),
        { id: 'viral', type: 'exp', text: 'Break it: a link goes viral; still 99% served' },
      ],
      hint: 'Every click the browser can\'t answer becomes a database read. Add a cache: the viral link is one key, so after the first click every click on it is a hit.',
      takeaway: 'Clicks outnumber new links 10 to 1, and a few links get most clicks: a cache in front of the database answers them. A viral link is a single hot key, so the cache absorbs it entirely.',
    },
    {
      title: 'Count every click', ref: '301 vs 302', qps: 2200, writes: WRITES, budget: BUDGET,
      story: 'Marketing teams want to see how many people click their links, and when. With 301, a browser\'s second click never reaches you. Count every click, and stay up when a script starts creating links in bulk.',
      goals: [
        countGoal, servedGoal(targets), latGoal(targets), costGoal(BUDGET),
        { id: 'bulk', type: 'exp', text: 'Break it: one account creates links in bulk; still 99% served' },
      ],
      hint: 'Switch redirects to 302 so every click comes back. Then limit new links per account: one script shouldn\'t be able to fill the database.',
      takeaway: '302 trades load for data: every click reaches you and can be counted. A per-account limit turns the bulk script away with 429s before it reaches the database.',
    },
    {
      title: 'Private links', ref: 'Hash + collision resolution', qps: 2800, writes: 800 / 2800, budget: BUDGET,
      story: 'Partners now shorten every link in their emails, many of them private (a shared document, an invoice): 800 new links and 2,000 clicks a second. Codes in sequence let anyone try the next one, so codes must not be guessable. Keep it up when one of them goes viral.',
      goals: [
        privateGoal, countGoal, servedGoal(targets), latGoal(targets), costGoal(BUDGET),
        { id: 'viral', type: 'exp', text: 'Break it: a link goes viral; still 99% served' },
      ],
      hint: 'A hash doesn\'t follow a sequence, but checking each new code in the database doubles the queries for new links. Check a bloom filter in memory instead.',
      takeaway: 'Hashed codes can\'t be guessed from each other, and a bloom filter answers almost every collision check from memory, so a new link still costs about one query.',
    },
  ],

  // Break-it experiments. An event only checks its outcome; `viral` adds clicks on one link, `bulk` new links from one account.
  experiments: [
    {
      id: 'viral', kind: 'event', viral: VIRAL,
      label: 'A link goes viral', labelOn: 'Calm down',
      needsDesign: 'Build the design first: the link service needs its database.',
      on: `A link goes viral: ${fmt(VIRAL)} more clicks a second, all on one code, from people who have never clicked it.`, onTone: 'bad',
      off: 'The link calms down.',
      expect: served99,
      notMet: (m) => `Only ${m.servedPct.toFixed(1)}% served. Every click on the viral link that misses a cache is a database read. One link is one key: a cache answers it from memory.`,
      observed: (m) => `Observed: a link went viral, and ${m.servedPct.toFixed(1)}% of requests were still served.`,
    },
    {
      id: 'bulk', kind: 'event', bulk: BULK,
      label: 'A script creates links', labelOn: 'Stop the script',
      needsDesign: 'Build the design first: the link service needs its database.',
      on: `One account starts creating ${fmt(BULK)} links a second.`, onTone: 'bad',
      off: 'The script stops.',
      expect: served99,
      notMet: (m) => `Only ${m.servedPct.toFixed(1)}% served: ${fmt(m.link ? m.link.bots : 0)} new links a second from one account reach the database. Limit new links per account.`,
      observed: () => 'Observed: the script was turned away with 429s, and real users were served.',
    },
  ],

  // Messages the engine shows for this level's design.
  text: {
    ...lbText(),
    levelComplete: levelComplete(14),
  },

  quiz: {
    passScore: 8,
    passText: passText(14, 'Web crawler'),
    failText,
    questions: [
      { q: 'Which redirect lets you count every click?', o: ['301 Moved Permanently', '302 Found', '200 OK with the page', '404 Not Found'], a: 1, e: 'With 302 the browser asks your servers on every click, so you can count each one. With 301 it keeps the redirect and skips you next time: less load, fewer counted clicks.', r: '301 vs 302' },
      { q: 'Why does a 301 redirect lower the load?', o: ['It compresses the reply', 'It skips the load balancer', 'It is cached in the database', 'The browser remembers it'], a: 3, e: 'A permanent redirect is kept by the browser, so the next click on the same link goes straight to the long link without asking your servers.', r: '301 vs 302' },
      { q: '62⁶ ≈ 56.8 billion. How many characters for 219 billion links?', o: ['6', '8', '7', '11'], a: 2, e: '62⁶ is too few; 62⁷ ≈ 3.5 trillion is enough. So 7 characters.', r: 'Hash value length' },
      { q: 'What is 20000 in base 62 (0–9, a–z, A–Z)?', o: ['20k', 'c5A', 'A5c', '5cA'], a: 3, e: '20000 = 5 × 62² + 12 × 62 + 36. Digit 5 is "5", 12 is "c" (a = 10), 36 is "A" (the first capital). So 5cA.', r: 'Base 62 conversion' },
      { q: 'Even CRC32 gives 8 hex characters. How does hashing get a 7-character code?', o: ['Use the whole hash', 'Keep the first 7, recheck', 'Encrypt the long link', 'Switch to a shorter hash function'], a: 1, e: 'Keep the first 7 characters. Two links can then share a code, so look it up and, on a collision, append a fixed string and hash again until it is free.', r: 'Hash + collision resolution' },
      { q: 'What does a bloom filter answer?', o: ['Where a key is stored', 'The newest version of a key', 'How many times a key has been read in total', '"Surely not in the set" or "maybe"'], a: 3, e: 'A bloom filter is a small bit array in memory. "Not in the set" is always right; "maybe" can be a false positive, and only then do you check the database.', r: 'Hash + collision resolution' },
      { q: 'What is the downside of base 62 codes from a unique ID?', o: ['Codes can collide', 'Codes are too long', 'The next code is easy to guess', 'Each new link needs two database lookups first'], a: 2, e: 'IDs go up one by one, so codes do too: anyone can try the next code and find other people\'s links. They never collide and need no lookup, though.', r: 'Comparison of the two approaches' },
      { q: 'A click\'s code is not in the cache or the database. What do you answer?', o: ['A 404: no such link', 'A random long link', 'A 301 to the home page', 'A 500 error'], a: 0, e: 'The code was never created (often a typo), so there is nothing to redirect to: answer 404 Not Found.', r: 'URL redirecting deep dive' },
      { q: 'A link goes viral. Which part takes the extra clicks?', o: ['The database, which holds every link', 'The cache, since it\'s one key', 'The unique ID generator', 'The rate limiter'], a: 1, e: 'Every viral click asks for the same code. After the first miss the cache holds it, so all the others are hits and the database never sees them.', r: 'URL redirecting deep dive' },
      { q: '219 billion links × 100 bytes each. About how much storage?', o: ['219 GB', '2.19 TB', '21.9 TB', '219 TB'], a: 2, e: '219 × 10⁹ × 100 bytes = 2.19 × 10¹³ bytes ≈ 21.9 TB. The 219 billion already covers the 10 years.', r: 'Back of the envelope' },
    ],
  },

  // Lesson tab content (HTML). The diagram below draws into figRedirect.
  lessonHtml: `
    <p class="label">Level 14 · URL shortener</p>
    <h1>URL shortener</h1>
    <p class="lede">A URL shortener turns <code>www.example.com/guides/how-dns-works?ref=newsletter</code> into <code>lnk.example/aZ3k9Qe</code> and sends every click on the short link to the long one. It is two operations, creating a link and following one, at very different rates. In this level you choose how codes are made, how clicks are redirected, and what protects the database.</p>
    <div class="goals-box">
      <div><b>You will learn</b>The two APIs, 301 vs 302, code length, hashing vs base 62, the cache, and rate limits.</div>
      <div><b>You will decide</b>The redirect, how codes are made, the cache, and a limit on new links.</div>
      <div><b>You will estimate</b>How many characters a code needs.</div>
    </div>

    <section>
      <h2>Scope and numbers</h2>
      <p class="src">Back of the envelope</p>
      <p>Ask: how many new links a day, how short, which characters, can links be changed or deleted? Here: 60 million a day; as short as possible; 0–9, a–z, A–Z; never changed.</p>
      <ul>
        <li><b>Writes:</b> 60 million ÷ 86,400 ≈ 694 new links a second.</li>
        <li><b>Reads:</b> 10 clicks for each new link ≈ 6,900 a second.</li>
        <li><b>Records:</b> 60 million × 365 × 10 years ≈ 219 billion. At 100 bytes each, 21.9 TB.</li>
      </ul>
    </section>

    <section>
      <h2>Two APIs</h2>
      <p class="src">API endpoints</p>
      <ul>
        <li><code>POST /api/v1/shorten</code> with <code>{ longUrl }</code> returns the short link.</li>
        <li><code>GET /{code}</code> returns a redirect to the long link: status 301 or 302 with a <code>Location</code> header.</li>
      </ul>
      <figure class="fig"><svg id="figRedirect" viewBox="0 0 660 200" role="img" aria-label="The browser asks lnk.example for code aZ3k9Qe; the link service answers 302 with the long link in the Location header; the browser then opens the long link."></svg><figcaption>A click: the service answers with a redirect, and the browser follows it</figcaption></figure>
    </section>

    <section>
      <h2>301 or 302</h2>
      <p class="src">URL redirecting</p>
      <ul>
        <li><b>301 Moved Permanently:</b> the browser keeps the redirect and skips your servers next time. Less load.</li>
        <li><b>302 Found:</b> temporary, so every click asks your servers again. More load, but you can count clicks and where they come from.</li>
      </ul>
    </section>

    <section>
      <h2>How long is a code?</h2>
      <p class="src">Hash value length</p>
      <p>With 62 characters, n characters give 62ⁿ codes. 62⁶ ≈ 56.8 billion is too few for 219 billion links; 62⁷ ≈ 3.5 trillion is enough. So 7 characters.</p>
    </section>

    <section>
      <h2>Two ways to make a code</h2>
      <p class="src">Hash + collision resolution · Base 62 conversion</p>
      <p><b>Hash and cut.</b> Hash the long link and keep 7 characters. Even CRC32 is too long as it is: for <code>https://www.example.com/guides/how-dns-works</code> it gives <code>41560b3e</code>, 8 hex characters (MD5 and SHA-1 give 32 and 40). Cutting can collide with another link's code, so look the code up and, if it is taken, append a fixed string and hash again. A lookup for every new link is costly; a <b>bloom filter</b> in memory answers "surely not used" for almost all of them.</p>
      <p><b>Base 62 of a unique ID.</b> Take the next unique ID (Level 13) and write it in base 62: 0–9 for 0–9, a–z for 10–35, A–Z for 36–61. 20000 = 5 × 62² + 12 × 62 + 36 → <code>5cA</code>. No collisions and no lookup, and the code grows with the ID. But codes follow one another, so the next one is easy to guess. For 7 characters the ID must stay below 62⁷, so it is a counter, not a 64-bit timestamp ID (up to 11 characters).</p>
      <p>Before either, check whether the long link already has a code, and return that one.</p>
    </section>

    <section>
      <h2>Redirects at scale</h2>
      <p class="src">URL redirecting deep dive</p>
      <p>Clicks outnumber new links 10 to 1, and a few links get most of them, so put code → long link in a <b>cache</b>. A click checks the cache, then the database; a code in neither was never made, so answer 404. A viral link is one hot key: the cache answers every click after the first.</p>
      <p>A script could create millions of links: a <b>rate limiter</b> (Level 10) caps new links per account or IP. The web tier is stateless, so it scales out; the database scales with replicas and shards (Levels 3 and 9).</p>
    </section>

    <section>
      <h2>How this level is simulated</h2>
      <p class="src">Game assumptions</p>
      <p>Each mission has 10 clicks for every new link, except Mission 3. With 301, half of all clicks come from a browser that has followed that link before, so they never reach your servers and aren't counted. A viral link adds ${fmt(VIRAL)} clicks a second from new visitors. Hashed codes with a database check cost two queries per new link; with a bloom filter, 1.01; base 62, one.</p>
      <p class="assume">Game assumptions: a cache holds the links clicked in a month (20 GB); the limit allows 10 new links a minute per account and its check costs nothing; the script creates ${fmt(BULK)} links a second.</p>
    </section>

    <section>
      <h2>Numbers to carry into the interview</h2>
      <p class="src">Capacity estimates</p>
      <p><b>Code length:</b> smallest n with 62ⁿ above the links. 62⁶ ≈ 56.8 billion, 62⁷ ≈ 3.5 trillion.</p>
      <p><b>Storage</b> = links × bytes each. 219 billion × 100 bytes ≈ 21.9 TB.</p>
    </section>

    <section>
      <h2>How each mission maps to the interview</h2>
      <p class="src">Interview loop · times for a 45-minute interview (formats vary by company)</p>
      <div class="steps4">
        <div><span>Step 1 · 5–8 min</span><b>Scope it</b>Links a day, read to write ratio, characters, how long links live.</div>
        <div><span>Step 2 · 10–12 min</span><b>Sketch it</b>Two APIs, 301 or 302, a table of code and long link.</div>
        <div><span>Step 3 · 15–20 min</span><b>Go deep</b>Code length, hash and collisions vs base 62, the cache for redirects.</div>
        <div><span>Step 4 · 5 min</span><b>Stress it</b>A viral link, a bulk script, analytics, scaling the database.</div>
      </div>
    </section>
`,

  // Lesson diagram. `f` provides the engine's drawing helpers.
  drawFigures(f) {
    const { $, figNode, figArrow, figDefs, svgEl } = f;
    const label = (svg, x, y, t, anchor = 'middle') => { const e = svgEl('text', { x, y, class: 'd-label', 'text-anchor': anchor }, svg); e.textContent = t; };
    const f1 = $('figRedirect'); f1.textContent = ''; figDefs(f1);
    figNode(f1, 'users', 110, 100, 'Browser', 'Clicks aZ3k9Qe');
    figNode(f1, 'web', 540, 40, 'Link service', 'Looks up the code');
    figNode(f1, 'web', 540, 160, 'example.com', 'The long link');
    figArrow(f1, 206, 92, 444, 46, '', null, 0, 0);
    figArrow(f1, 206, 108, 444, 154, '', null, 0, 0);
    label(f1, 300, 58, '1. GET /aZ3k9Qe');
    label(f1, 540, 100, '2. 302, Location: long link');
    label(f1, 300, 160, '3. GET the long link');
  },
};
