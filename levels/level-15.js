// Level 15: Web crawler.
// Everything specific to this level lives here: components, rules, missions, quiz and text.
import { fmt } from '../js/format.js';
import { costGoal, fmtPct } from './shared/goals.js';
import { DNS_MS, SLOW_DNS_MS, DNS_MISS, DUP_SHARE, PAGE_KB, POLITE, TOP_HOST, FLOOD_SHARE, TRAP_SHARE, TRAP_LINKS, THREADS, PAGE_MS } from '../js/engine/crawl.js';
import { lbText, levelComplete } from './shared/text.js';
import { failText, passText } from './shared/quiz.js';

const targets = { latencyMs: 1000, servedPct: 99 };
const BUDGET = 1500;
const RATE = 800; // pages a second the frontier hands out

/** Share of downloads that are useful pages: fetched, not refused, not a trap's. */
const useful = (m) => (m.crawl ? m.servedPct * (1 - m.crawl.wasted) : m.servedPct);
const crawlGoal = { id: 'crawl', type: 'metric', text: `Download ${fmt(RATE)} useful pages a second (${targets.servedPct}%)`, test: (m) => useful(m) >= targets.servedPct, val: (m) => fmtPct(useful(m)) };
const politeGoal = { id: 'polite', type: 'metric', text: `At most ${POLITE} request a second to any website`, test: (m) => !!m.crawl && m.crawl.hostRate <= POLITE, val: (m) => (m.crawl ? `${fmt(m.crawl.hostRate)}/s` : '—') };
const storeGoal = { id: 'storage', type: 'metric', text: 'Store at most 450 TB a month', test: (m) => !!m.crawl && m.crawl.storageTB <= 450, val: (m) => (m.crawl ? `${fmt(m.crawl.storageTB)} TB` : '—') };
const crawlOk = (m) => useful(m) >= targets.servedPct;
const PER = THREADS * 1000 / PAGE_MS; // pages a second a downloader's threads allow

export default {
  id: 15,
  saveKey: 'sdl-level15-v1',
  saveVersion: 1,
  targets,
  workload: { crawl: true },

  // The mock interview's brief and self-check list for this problem (see mock.js).
  mock: {
    title: 'Web crawler',
    brief: 'Design a web crawler for a search engine: 2 billion HTML pages a month, kept for 5 years, new and changed pages included, duplicate content skipped.',
    checklist: [
      'Estimated pages a second and storage (about 772 a second; 600 TB a month, 36 PB in 5 years)',
      'Drew the loop: frontier, downloader, DNS, parser, content seen, URL filter, URL seen',
      'Kept it polite: a queue per host, one request at a time, with a pause',
      'Cached DNS lookups',
      'Caught duplicate pages by their hash',
      'Guarded against crawler traps, and followed robots.txt',
    ],
  },

  components: {
    users: {
      name: 'URL frontier', sub: 'URLs to download',
      desc: `The URLs waiting to be downloaded, starting from seed URLs (popular sites by region or topic). It hands the downloaders ${fmt(RATE)} URLs a second. New links from each page come back here after the parser has checked them.`,
      choices: [
        {
          key: 'queues', label: 'Queues',
          options: [
            { id: 'fifo', name: 'One FIFO queue', sub: 'first in, first out', note: 'URLs leave in the order they came. Pages link mostly to their own site, so long runs of URLs from one host go out together: that host gets many requests at once.', log: 'Frontier set to one FIFO queue.' },
            { id: 'host', name: 'A queue per host', sub: 'one request a second each', note: `A router puts each host's URLs in its own queue, and a downloader thread takes one URL from a queue, then waits before the next: at most ${POLITE} request a second per host. Other hosts' queues keep the threads busy.`, log: 'Frontier set to a queue per host.' },
          ],
        },
      ],
    },
    downloader: {
      name: 'HTML downloader', short: 'Fetches pages',
      desc: `Machines that fetch pages over HTTP, ${THREADS} threads each; a page takes about ${PAGE_MS} ms. Each page needs its host's IP address first, and many DNS interfaces do one lookup at a time. $200 a month per machine.`,
      subOf: (n) => `${Number(n.count) || 4} machines · ${n.dns === 'cache' ? 'DNS cache' : 'DNS lookups'}`,
      choices: [
        { key: 'count', label: 'Machines', options: [1, 2, 4, 5, 6, 8].map((k) => ({ id: String(k), name: `${k} ${k === 1 ? 'machine' : 'machines'}`, sub: `$${fmt(k * 200)} a month`, note: `${k} downloader ${k === 1 ? 'machine' : 'machines'}, ${THREADS} threads each.`, log: `Downloaders set to ${k} ${k === 1 ? 'machine' : 'machines'}.` })) },
        {
          key: 'dns', label: 'DNS',
          options: [
            { id: 'lookup', name: 'Look up every host', sub: 'one lookup at a time', note: `Every page waits for a DNS lookup (${DNS_MS} ms here), one at a time: at most ${fmt(1000 / DNS_MS)} pages a second per machine.`, log: 'Downloaders look up every host.' },
            { id: 'cache', name: 'Keep a DNS cache', sub: 'host → IP, refreshed often', note: `Keep host → IP addresses in memory, refreshed by a scheduled job. Only new hosts (${Math.round(100 * DNS_MISS)}% of pages) need a lookup.`, log: 'Downloaders keep a DNS cache.' },
          ],
        },
      ],
    },
    parser: {
      name: 'Parser', short: 'Checks pages, finds links',
      desc: 'Checks each page is valid HTML, extracts its links, makes them absolute and drops those already seen ("URL seen?", a bloom filter). New links go back to the frontier. $150 a month.',
      subOf: (n) => [n.dedup === 'on' ? 'content seen?' : 'stores all', n.filter === 'on' ? 'URL filter' : 'no filter'].join(' · '),
      choices: [
        {
          key: 'dedup', label: 'Duplicate pages',
          options: [
            { id: 'off', name: 'Store every page', sub: 'no check', note: 'Every downloaded page is stored, even when another URL had the same content.', log: 'Parser stores every page.' },
            { id: 'on', name: 'Check "content seen?"', sub: 'compare hashes', note: `Hash each page and compare with the hashes of pages already stored; skip a match. About ${Math.round(100 * DUP_SHARE)}% of pages are duplicates.`, log: 'Parser now skips pages whose content is already stored.' },
          ],
        },
        {
          key: 'filter', label: 'URL filter',
          options: [
            { id: 'off', name: 'Keep every link', sub: 'no limit', note: 'Every new link goes to the frontier.', log: 'Parser keeps every link.' },
            { id: 'on', name: 'Filter URLs', sub: 'max depth and length', note: 'Drop links deeper or longer than a limit, and from sites on a block list. Endless URLs never reach the frontier.', log: 'Parser now filters URLs by depth and length.' },
          ],
        },
      ],
    },
    contentstore: {
      name: 'Content storage', short: 'Pages on disk',
      desc: 'Keeps the downloaded pages: most on disk, the popular ones also in memory. A managed service here, $300 a month.',
    },
  },
  palette: ['downloader', 'parser', 'contentstore'],
  limits: { downloader: 1, parser: 1, contentstore: 1 },
  limitMsg: {
    downloader: 'One downloader box is enough: set its machines in the inspector.',
    parser: 'One parser is enough here.',
    contentstore: 'One content storage is enough.',
  },
  // The crawl pipeline: frontier → downloaders (4 machines, no DNS cache) → parser → storage.
  startNodes: [
    { id: 'u', type: 'users', x: 380, y: 60, queues: 'fifo' },
    { id: 'h', type: 'downloader', x: 380, y: 180, count: '4', dns: 'lookup' },
    { id: 'p', type: 'parser', x: 380, y: 300, dedup: 'off', filter: 'off' },
    { id: 's', type: 'contentstore', x: 380, y: 420 },
  ],
  startEdges: [
    { id: 's1', from: 'u', to: 'h' }, { id: 's2', from: 'h', to: 'p' }, { id: 's3', from: 'p', to: 's' },
  ],
  slots: { downloader: { x: 380, y: 180 }, parser: { x: 380, y: 300 }, contentstore: { x: 380, y: 420 } },

  connections: {
    ok: {
      'downloader|users': { from: 'users', to: 'downloader', label: 'URLs', desc: 'The frontier hands each downloader thread its next URL.' },
      'downloader|parser': { from: 'downloader', to: 'parser', label: 'pages', desc: 'Each downloaded page goes to the parser.' },
      'contentstore|parser': { from: 'parser', to: 'contentstore', label: 'new pages', desc: 'The parser stores pages; its new links go back to the frontier.' },
    },
    bad: {
      'parser|users': 'The frontier hands URLs to the downloaders, not the parser.',
      'contentstore|users': 'The frontier hands URLs to the downloaders. Pages reach storage through the parser.',
      'contentstore|downloader': 'Downloaded pages go to the parser first, to be checked.',
    },
  },

  missions: [
    {
      title: 'Crawl at full speed', ref: 'HTML downloader', qps: RATE, budget: BUDGET,
      gate: {
        hidesTraffic: false,
        lo: 600, hi: 600,
        prompt: `<b>Estimate before you build.</b> The plan: 2 billion pages a month, ${PAGE_KB} KB each. How many TB of storage a month?`,
        label: 'TB a month',
        placeholder: 'e.g. 100',
        acceptedHtml: `<p><b>Estimate accepted.</b></p><div class="calc">2 billion × ${PAGE_KB} KB = 6 × 10¹⁴ bytes = 600 TB a month<br>Kept 5 years: 600 TB × 12 × 5 = 36 PB<br>2 billion ÷ 2.6 million seconds ≈ 772 pages a second</div>`,
        acceptedLog: 'Estimate accepted: 600 TB a month. Play is unlocked.',
        notNumber: 'Type the TB as a number, for example 100.',
        hints: [
          { test: (v) => v === 60 || v === 6000, text: 'Check the powers of ten: 2 × 10⁹ pages × 3 × 10⁵ bytes = 6 × 10¹⁴ bytes, and 1 TB = 10¹² bytes.' },
          { test: (v) => v === 36000 || v === 36, text: 'That is 5 years of it. The question is one month.' },
        ],
        fallback: 'Not quite. Multiply pages by page size, then divide by 10¹² bytes per TB.',
      },
      story: `A search engine needs ${fmt(RATE)} pages a second. The downloaders look up every host's IP address, one lookup at a time, so each machine waits on DNS. Keep crawling at full speed, even when the DNS provider slows down to ${SLOW_DNS_MS} ms a lookup.`,
      goals: [
        { id: 'est', type: 'gate', text: 'Estimate the storage a month' },
        crawlGoal, costGoal(BUDGET),
        { id: 'dns', type: 'exp', text: 'Break it: DNS slows down; still 99% of pages' },
      ],
      hint: `One lookup at a time caps a machine at ${fmt(1000 / DNS_MS)} pages a second, and at ${fmt(1000 / SLOW_DNS_MS)} when DNS slows. Keep a DNS cache: only new hosts need a lookup. Then ${fmt(PER)} pages a second per machine: 5 machines cover ${fmt(RATE)} with room for the peaks.`,
      takeaway: 'The DNS cache took lookups off the critical path, so the downloaders were limited by their threads, not by DNS. A cache is refreshed in the background, so a slow DNS provider barely matters.',
    },
    {
      title: 'Be polite', ref: 'Politeness', qps: RATE, budget: BUDGET,
      story: `Pages link mostly to their own site, so a FIFO queue hands out runs of URLs from one host: the busiest gets ${fmt(RATE * TOP_HOST)} requests a second. That's rude, and a site flooded with requests will block you. Send any site at most ${POLITE} request a second.`,
      goals: [
        politeGoal, crawlGoal, costGoal(BUDGET),
        { id: 'flood', type: 'exp', text: 'Break it: one site floods the frontier; still 99% of pages' },
      ],
      hint: 'Give each host its own queue, and let a thread take one URL from a queue, then wait. The other hosts keep the threads busy.',
      takeaway: `With a queue per host, the flooded site got ${POLITE} request a second, and the downloaders worked on other sites meanwhile. Its URLs wait their turn instead of hammering it.`,
    },
    {
      title: 'Don\'t waste work', ref: 'Problematic content', qps: RATE, budget: BUDGET,
      story: `About ${Math.round(100 * DUP_SHARE)}% of pages copy a page already stored. Storage must stay under 450 TB a month. And some sites never end: calendar.example/2026/11/next/next/next/… makes a new page for every click. Don't fall in.`,
      goals: [
        storeGoal, politeGoal, crawlGoal, costGoal(BUDGET),
        { id: 'trap', type: 'exp', text: 'Break it: the crawler finds an endless calendar; no trap URLs reach the frontier' },
      ],
      hint: 'Check "content seen?" with a hash of each page, and filter URLs deeper or longer than a limit.',
      takeaway: 'Hashes caught the duplicate pages before they were stored, and the URL filter dropped the calendar\'s endless links before they reached the frontier. No rule catches every trap; a site with unusually many pages is the sign to look at.',
    },
  ],

  // Break-it experiments. An event only checks its outcome; slowDns, flood and trap change the crawl while it runs.
  experiments: [
    {
      id: 'dns', kind: 'event', slowDns: true,
      label: 'DNS slows down', labelOn: 'DNS recovers',
      needsDesign: 'Build the pipeline first: frontier, downloaders, parser and storage.',
      on: `The DNS provider slows down: ${SLOW_DNS_MS} ms a lookup.`, onTone: 'bad',
      off: 'DNS is fast again.',
      expect: crawlOk,
      notMet: (m) => `Only ${fmtPct(useful(m))} of pages downloaded: one lookup at a time at ${SLOW_DNS_MS} ms is ${fmt(1000 / SLOW_DNS_MS)} pages a second per machine. Keep a DNS cache.`,
      observed: (m) => `Observed: DNS slowed down, and ${fmtPct(useful(m))} of pages were still downloaded.`,
    },
    {
      id: 'flood', kind: 'event', flood: true,
      label: 'One site floods the frontier', labelOn: 'Stop the flood',
      needsDesign: 'Build the pipeline first: frontier, downloaders, parser and storage.',
      on: `A huge site's pages link to each other: ${Math.round(100 * FLOOD_SHARE)}% of the frontier's URLs are now from one host.`, onTone: 'bad',
      off: 'The flood is over.',
      expect: (m) => crawlOk(m) && m.crawl.hostRate <= POLITE,
      notMet: (m) => `The site gets ${fmt(m.crawl.hostRate)} requests a second and refuses them: ${fmtPct(100 * m.crawl.refused)} of downloads fail. Give each host its own queue.`,
      observed: () => `Observed: the site got ${POLITE} request a second, and the crawl went on.`,
    },
    {
      id: 'trap', kind: 'event', trap: true,
      label: 'The crawler finds a trap', labelOn: 'Leave the trap',
      needsDesign: 'Build the pipeline first: frontier, downloaders, parser and storage.',
      on: 'The crawler finds calendar.example: every page links to a next page that never ends.', onTone: 'bad',
      off: 'The trap\'s URLs are cleared from the frontier.',
      expect: (m) => crawlOk(m) && m.crawl.trapAdds === 0,
      notMet: (m) => `The trap adds ${fmt(m.crawl.trapAdds)} new URLs a second to the frontier, forever${m.crawl.wasted >= 0.01 ? `, and takes ${fmtPct(100 * m.crawl.wasted)} of downloads` : ''}. Filter URLs by depth and length.`,
      observed: () => 'Observed: the URL filter dropped every trap link, and the crawl went on.',
    },
  ],

  // Messages the engine shows for this level's design.
  text: {
    ...lbText(),
    noWeb: 'Connect the URL frontier to the downloaders.',
    levelComplete: levelComplete(15),
  },

  quiz: {
    passScore: 8,
    passText: passText(15, 'Notification system'),
    failText,
    questions: [
      { q: 'Why do crawlers use breadth-first rather than depth-first search?', o: ['BFS uses less memory on every graph', 'DFS can go very deep on one site', 'BFS finds pages in alphabetical order', 'DFS can\'t follow links'], a: 1, e: 'The web is a huge graph; depth-first can follow one site\'s links down and down. Breadth-first, with a FIFO queue, spreads the crawl across the web.', r: 'DFS vs BFS' },
      { q: 'What makes a crawler polite?', o: ['Crawl only at night', 'Download each page twice', 'One request at a time per host, with a pause', 'Skip every page that has a form on it, to be safe'], a: 2, e: 'Map each host to its own queue, and let a thread download from it one page at a time with a delay in between. The site isn\'t flooded.', r: 'Politeness' },
      { q: 'Why does a DNS cache speed up the downloaders so much?', o: ['DNS gives bigger pages', 'It compresses IP addresses', 'It makes every page download in parallel threads', 'Many DNS interfaces do one lookup at a time'], a: 3, e: 'A lookup takes 10–200 ms, and many DNS interfaces block other threads while one runs. With host → IP in memory, only new hosts need a lookup.', r: 'Cache DNS resolver' },
      { q: 'How does "content seen?" find a duplicate page quickly?', o: ['Compare page hashes', 'Compare the pages character by character', 'Compare their URLs', 'Ask the website'], a: 0, e: 'Comparing whole pages is slow. A hash (checksum) of each page is compared with the hashes of pages already stored.', r: 'Content seen?' },
      { q: 'What does "URL seen?" usually use?', o: ['A relational table scan of every URL ever stored', 'A bloom filter or hash table', 'The DNS cache', 'robots.txt'], a: 1, e: 'A bloom filter (or a hash table) tells quickly whether a URL was already downloaded or is in the frontier, so it isn\'t added twice.', r: 'URL seen?' },
      { q: 'What is robots.txt?', o: ['A list of the site\'s robots', 'A sitemap of every page', 'Rules for which pages crawlers may fetch', 'A file that lists the passwords for the admin pages'], a: 2, e: 'The Robots Exclusion Protocol: a site lists what crawlers may not download, such as Disallow: /cart/. Fetch it before crawling the site, and cache it.', r: 'Robots.txt' },
      { q: 'calendar.example/2026/11/next/next/… never ends. What helps most?', o: ['A bigger DNS cache', 'More downloader machines and more threads on each', 'A maximum URL depth or length', 'A 301 redirect'], a: 2, e: 'An endless URL space is a crawler trap. Limit URL depth or length, and exclude sites found to be traps.', r: 'Spider traps' },
      { q: 'Front queues and back queues in the URL frontier do what?', o: ['Priority, then politeness', 'Reads first, then all the writes in a batch', 'Images, then HTML', 'Old URLs, then new'], a: 0, e: 'Front queues order URLs by priority (PageRank, traffic, update rate); back queues keep one host per queue, for politeness.', r: 'URL frontier' },
      { q: 'How does a crawler keep its copy of the web fresh?', o: ['Recrawl every page every day, whatever it is', 'Never recrawl', 'Only crawl new sites', 'Recrawl by update history and importance'], a: 3, e: 'Recrawling everything is too costly. Pages that change often, and important pages, are recrawled first and more often.', r: 'Freshness' },
      { q: '2 billion pages a month, 300 KB each, kept 5 years. About how much storage?', o: ['3.6 PB', '36 PB', '600 TB', '360 PB'], a: 1, e: '2 × 10⁹ × 300 KB = 600 TB a month; × 12 × 5 = 36,000 TB = 36 PB.', r: 'Back of the envelope' },
    ],
  },

  // Lesson tab content (HTML). The diagram below draws into figCrawl.
  lessonHtml: `
    <p class="label">Level 15 · Web crawler</p>
    <h1>Web crawler</h1>
    <p class="lede">A web crawler starts from a few URLs, downloads those pages, finds their links, and repeats. Search engines, web archives and price-comparison sites all run one. In this level nobody sends you requests: your own frontier feeds your downloaders, and every page feeds new links back. You keep it fast, polite and out of traps.</p>
    <div class="goals-box">
      <div><b>You will learn</b>The crawl loop, the URL frontier, politeness, the DNS cache, duplicates and traps.</div>
      <div><b>You will decide</b>The frontier's queues, the downloaders and their DNS, the duplicate check and the URL filter.</div>
      <div><b>You will estimate</b>Storage a month for the planned crawl.</div>
    </div>

    <section>
      <h2>Scope it</h2>
      <p class="src">Requirements</p>
      <p>Ask: what for (here, search indexing), how many pages a month (2 billion), which content (HTML only), new and changed pages too (yes), keep them how long (5 years), duplicates (skip). A good crawler is <b>scalable</b>, <b>robust</b> (the web is full of bad HTML and traps), <b>polite</b> and <b>extensible</b> (new content types later).</p>
      <ul>
        <li>2 billion ÷ (30 × 86,400 s) ≈ 772 pages a second; about 1,540 at a 2× peak.</li>
        <li>2 billion × ${PAGE_KB} KB = 600 TB a month; 5 years = 36 PB.</li>
      </ul>
    </section>

    <section>
      <h2>The crawl loop</h2>
      <p class="src">High-level design</p>
      <figure class="fig"><svg id="figCrawl" viewBox="0 0 660 230" role="img" aria-label="The URL frontier hands URLs to the downloaders; pages go to the parser; new content goes to storage; new links pass the URL filter and the URL-seen check and go back to the frontier."></svg><figcaption>Every page can add new URLs to the frontier: the loop</figcaption></figure>
      <ol>
        <li><b>Seed URLs</b> start the frontier: popular sites by region, or by topic (news, recipes, travel).</li>
        <li>The <b>HTML downloader</b> takes URLs from the frontier, gets each host's IP from <b>DNS</b>, and downloads.</li>
        <li>The <b>parser</b> checks the HTML. <b>Content seen?</b> compares a hash of the page with stored pages and drops duplicates.</li>
        <li>The <b>link extractor</b> pulls out links and makes them absolute. The <b>URL filter</b> drops unwanted ones; <b>URL seen?</b> (a bloom filter or hash table) drops ones already crawled or queued.</li>
        <li>New URLs go back to the frontier. Pages go to <b>content storage</b>: mostly disk, popular ones in memory.</li>
      </ol>
    </section>

    <section>
      <h2>The URL frontier</h2>
      <p class="src">BFS · Politeness · Priority · Freshness</p>
      <p>The web is a graph; crawlers walk it breadth-first with a FIFO queue, since depth-first can dive endlessly into one site. Plain FIFO has two problems:</p>
      <ul>
        <li><b>Impolite.</b> Most links point to the same site, so one host gets many requests at once. Fix: <b>back queues</b>, one host per queue, a thread per queue, a pause between downloads.</li>
        <li><b>No priority.</b> A site's home page matters more than an old forum post. Fix: <b>front queues</b> by priority (PageRank, traffic, update rate), picked with a bias to the high ones.</li>
      </ul>
      <p>Recrawl pages by how often they change and how important they are, to stay <b>fresh</b>. The frontier can hold hundreds of millions of URLs: keep most on disk, with buffers in memory.</p>
    </section>

    <section>
      <h2>The downloader</h2>
      <p class="src">Robots.txt · Performance</p>
      <p>Before crawling a site, fetch its <b>robots.txt</b> and obey it: <code>shop.example/robots.txt</code> might say <code>Disallow: /cart/</code>. Cache it. To go fast: spread the crawl over many machines and threads (partition URLs by host, consistent hashing from Level 11); <b>cache DNS</b>, because lookups take 10–200 ms and many DNS interfaces do one at a time; put crawlers near the sites they crawl; use short timeouts for slow sites.</p>
    </section>

    <section>
      <h2>Robustness and problem content</h2>
      <p class="src">Detect and avoid problematic content</p>
      <ul>
        <li><b>Duplicates:</b> nearly 30% of pages copy others. Hashes catch them.</li>
        <li><b>Crawler traps:</b> endless URLs such as <code>calendar.example/2026/11/next/next/next/…</code>. Limit URL length and depth; a site with an unusually large number of pages is a sign. No rule catches every trap.</li>
        <li><b>Noise:</b> ads, code, spam: skip what you can.</li>
        <li>Save crawl state so a crashed crawl can restart; handle errors without crashing.</li>
      </ul>
    </section>

    <section>
      <h2>How this level is simulated</h2>
      <p class="src">Game assumptions</p>
      <p>The frontier hands out ${fmt(RATE)} URLs a second. A downloader machine runs ${THREADS} threads at ${PAGE_MS} ms a page (${fmt(PER)} pages a second), and does DNS lookups one at a time: ${DNS_MS} ms each, ${SLOW_DNS_MS} ms when DNS slows. With a DNS cache only ${Math.round(100 * DNS_MISS)}% of pages need one. With one FIFO queue the busiest host gets ${Math.round(100 * TOP_HOST)}% of URLs; a flooding site ${Math.round(100 * FLOOD_SHARE)}%, and it refuses those requests. A trap fills ${Math.round(100 * TRAP_SHARE)}% of a FIFO frontier, and each trap page adds ${TRAP_LINKS} links.</p>
      <p class="assume">Game assumptions: ${Math.round(100 * DUP_SHARE)}% of pages are duplicates; the duplicate check and URL filter cost nothing; downloaders $200 a month a machine, parser $150, content storage $300.</p>
    </section>

    <section>
      <h2>Numbers to carry into the interview</h2>
      <p class="src">Capacity estimates</p>
      <p><b>Pages a second</b> = pages a month ÷ 2.6 million. 2 billion → about 772.</p>
      <p><b>Storage</b> = pages × size. 2 billion × ${PAGE_KB} KB = 600 TB a month, 36 PB over 5 years.</p>
    </section>

    <section>
      <h2>How each mission maps to the interview</h2>
      <p class="src">Interview loop · times for a 45-minute interview (formats vary by company)</p>
      <div class="steps4">
        <div><span>Step 1 · 5–8 min</span><b>Scope it</b>Purpose, pages a month, content types, how long to keep pages, duplicates.</div>
        <div><span>Step 2 · 10–12 min</span><b>Sketch it</b>The loop: seeds, frontier, downloader, DNS, parser, content seen, URL filter, URL seen.</div>
        <div><span>Step 3 · 15–20 min</span><b>Go deep</b>The frontier's priority and politeness queues, robots.txt, the DNS cache.</div>
        <div><span>Step 4 · 5 min</span><b>Stress it</b>A slow DNS, a flooded site, a crawler trap, a crash mid-crawl.</div>
      </div>
    </section>
`,

  // Lesson diagram. `f` provides the engine's drawing helpers.
  drawFigures(f) {
    const { $, figNode, figArrow, figDefs, svgEl } = f;
    const label = (svg, x, y, t, anchor = 'middle') => { const e = svgEl('text', { x, y, class: 'd-label', 'text-anchor': anchor }, svg); e.textContent = t; };
    const f1 = $('figCrawl'); f1.textContent = ''; figDefs(f1);
    figNode(f1, 'users', 110, 45, 'URL frontier', 'URLs to download');
    figNode(f1, 'downloader', 330, 45, 'Downloader', 'DNS, then HTTP');
    figNode(f1, 'parser', 550, 45, 'Parser', 'Content seen?');
    figNode(f1, 'contentstore', 550, 185, 'Content storage', 'New pages');
    figNode(f1, 'parser', 220, 185, 'URL filter, URL seen?', 'New links only');
    figArrow(f1, 206, 45, 234, 45, '', null, 0, 0);
    figArrow(f1, 426, 45, 454, 45, '', null, 0, 0);
    figArrow(f1, 550, 71, 550, 159, '', null, 0, 0);
    figArrow(f1, 454, 70, 316, 160, '', null, 0, 0);
    figArrow(f1, 160, 159, 120, 71, '', null, 0, 0);
    label(f1, 420, 128, 'links');
    label(f1, 98, 122, 'new URLs', 'end');
  },
};
