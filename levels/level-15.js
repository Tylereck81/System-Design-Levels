// @ts-check
/** @import { Level, Goal, Lesson } from '../js/types.js' */
// Level 15: Web crawler.
// Everything specific to this level lives here: components, rules, missions, quiz and text.
import { fmt, count } from '../js/format.js';
import { costGoal, fmtPct } from './shared/goals.js';
import { DNS_MS, SLOW_DNS_MS, DNS_MISS, DUP_SHARE, PAGE_KB, POLITE, TOP_HOST, FLOOD_SHARE, THREADS, PAGE_MS } from '../js/engine/crawl.js';
import { COMPONENTS } from '../js/engine/catalog.js';
import { lbText, levelComplete } from './shared/text.js';
import { failText, passText } from './shared/quiz.js';
import { panel, queueCells } from './shared/figures.js';
import { STEPS } from './mock-steps.js';

const targets = { latencyMs: 1000, servedPct: 99 };
const BUDGET = 1500;
const RATE = 800; // pages a second the frontier hands out
const STORE_TB = 450; // most storage a month Mission 3 allows

// ---------------- Lesson ----------------
const [scope, sketch, deep, stress] = STEPS.map((step) => `<b>${step.name}</b>`);
const dl = COMPONENTS.downloader;
const parser = COMPONENTS.parser;
const store = COMPONENTS.contentstore;
/** Seconds in a 30-day month: 2,592,000. */
const MONTH_S = 30 * 86400;
/** A large count to `digits` significant figures, with the word: 2,592,000 → "2.59 million" (3) or "2.6 million" (2). */
const about = (n, digits) => count(Number(n.toPrecision(digits)));
/** The share of pages that copy another, to the nearest 10%: 29% → "30%". */
const dupAbout = `${Math.round(DUP_SHARE * 10) * 10}%`;

// Scope example (ours): 3 billion pages a month of 100 KB, kept 4 years (the mission uses 2 billion of 300 KB for 5).
// 3 × 10⁹ × 10⁵ bytes = 3 × 10¹⁴ bytes = 300 TB a month; × 12 × 4 = 14,400 TB = 14.4 PB; 3 billion ÷ 2,592,000 s ≈ 1,157 a second.
const sc = { pages: 3e9, kb: 100, years: 4 };
sc.tbMonth = (sc.pages * sc.kb * 1000) / 1e12;
sc.pbAll = (sc.tbMonth * 12 * sc.years) / 1000;
sc.perSec = Math.round(sc.pages / MONTH_S);

// DNS example: lookups one at a time on one machine. The game's lookup (10 ms) gives 100 pages a second; a slow day's
// 100 ms gives 10. A machine's threads manage 200 (100 threads ÷ 500 ms a page).
const dns = { fast: DNS_MS, slow: 100 };
dns.fastCap = 1000 / dns.fast;
dns.slowCap = 1000 / dns.slow;

/** @type {Lesson} */
const lesson = {
  intro: {
    kicker: 'Level 15 · Part 3: Design real systems',
    title: 'Web crawler',
    story: 'A search engine needs a copy of the web, so it needs a crawler: a program that downloads pages, finds their links, and downloads those too. The web is huge and full of traps, and its owners did not ask to be visited.',
    picture: 'figBuilt',
    alt: 'The finished design: a frontier of URLs, with one queue per site, feeds downloaders that keep a DNS cache. A parser checks each page, skips content and links already seen, stores new pages and sends new links back to the frontier.',
    outcomes: [
      'scope a crawler with a storage estimate',
      'trace one URL through the crawl loop',
      'remove DNS as a bottleneck',
      'keep a crawler polite with a queue per site',
      'skip duplicate pages and endless sites',
    ],
  },
  last: 'Level 14 designed a service that answers requests. A crawler is the other way round: it sends billions of requests to other people\'s servers.',
  parts: [
    {
      title: 'Crawl at full speed',
      mission: 0,
      minutes: 10,
      lead: 'A crawler is a loop that never ends. Size it first, then find what slows it down.',
      newParts: [
        { type: 'downloader', before: 1, what: 'Machines that fetch web pages, many at once.', does: 'Take URLs from the frontier, find each site\'s address, and download the page.', game: `$${dl.cost} a month each. ${THREADS} threads; a page takes ${fmt(dl.base)} ms.` },
        { type: 'parser', before: 1, what: 'A server that reads each downloaded page.', does: 'Checks the page is valid, finds its links, drops the ones already seen and sends the rest back to the frontier.', game: `$${parser.cost} a month. Reads ${fmt(parser.cap)} pages/s.` },
        { type: 'contentstore', before: 1, what: 'Storage for the downloaded pages.', does: 'Keeps most pages on disk and the popular ones in memory.', game: `$${store.cost} a month.` },
      ],
      sections: [
        {
          title: 'Scope it: how much does a crawler download?',
          hook: `Ask what the crawl is for, how many pages, which kinds, and for how long they are kept. Say the answers are: for search, ${count(sc.pages)} pages a month, HTML only, kept ${sc.years} years.`,
          body: [
            {
              calc: {
                formula: 'Storage = pages × page size. Pages a second = pages a month ÷ seconds in a month.',
                rows: [
                  { label: 'Each month', work: `${count(sc.pages)} pages × ${sc.kb} KB`, result: `${sc.tbMonth} TB` },
                  { label: `In ${sc.years} years`, work: `${sc.tbMonth} TB × 12 months × ${sc.years}`, result: `${sc.pbAll} PB` },
                  { label: 'Pages a second', work: `${count(sc.pages)} pages ÷ ${about(MONTH_S, 3)} s`, result: `${fmt(sc.perSec)} pages/s`, approx: true },
                ],
                result: `About ${fmt(sc.perSec)} pages a second and ${sc.pbAll} PB of storage. A month is about ${about(MONTH_S, 2)} seconds.`,
              },
            },
            { p: 'A good crawler is also <b>robust</b> (bad pages and dead servers must not crash it), <b>polite</b> to the sites it visits, and <b>extensible</b> to new content types.' },
          ],
          takeaway: 'Pages a month gives the download rate, and page size gives the storage.',
          quiz: [9],
        },
        {
          title: 'How does a crawler work through the web?',
          hook: 'It starts from a few <b>seed URLs</b> and follows links outward.',
          body: [
            {
              figure: 'figLoop',
              alt: 'A loop of six steps: the frontier hands out URLs; the downloader finds the host and fetches the page; the parser checks the page and whether its content was seen; new pages are stored; links are extracted, filtered and checked against URLs already seen; new URLs go back to the frontier.',
              caption: 'Download, check, store, extract links, repeat',
            },
            { p: 'The list of URLs still to download is the <b>URL frontier</b>. The web is a graph: pages are points and links are arrows. A crawler takes the pages nearest the seeds first, <b>breadth-first</b>, because following links ever deeper into one site can go on almost for ever.' },
          ],
          takeaway: 'A crawler takes URLs from the frontier, downloads, and feeds new links back.',
          quiz: [0],
        },
        {
          title: 'Why is a crawler slow when its servers are idle?',
          hook: 'Before a page can be downloaded, its site\'s name must be turned into an address by DNS. Many DNS libraries do one lookup at a time.',
          body: [
            {
              calc: {
                formula: 'Pages a second for one machine, if lookups go one at a time = 1,000 ms ÷ time for one lookup.',
                rows: [
                  { label: `Lookups take ${dns.fast} ms`, work: `1,000 ms ÷ ${dns.fast} ms`, result: `${dns.fastCap} pages/s` },
                  { label: `Lookups take ${dns.slow} ms`, work: `1,000 ms ÷ ${dns.slow} ms`, result: `${dns.slowCap} pages/s` },
                ],
                result: `The machine could manage ${dl.cap} pages a second, but DNS holds it to ${dns.fastCap}, or ${dns.slowCap} on a slow day.`,
              },
            },
            { p: 'Keep a <b>DNS cache</b>: a table of site name to address, refreshed in the background. Only sites never seen before need a lookup, so DNS leaves the critical path.' },
          ],
          takeaway: 'Cache DNS answers so lookups stop holding up the downloads.',
          quiz: [2],
        },
      ],
      checks: [
        {
          q: 'A crawler downloads 1 billion pages a month of 200 KB each. About how much storage is that a month?',
          options: [
            { t: '20 TB', why: 'Check the zeros: 1 billion × 200 KB is 200 billion KB.' },
            { t: '200 TB', right: true, why: '1 billion × 200 KB = 2 × 10 to the 14 bytes = 200 TB.' },
            { t: '2 PB', why: 'That is ten times too much.' },
          ],
        },
      ],
      youWill: [
        'estimate the storage a month (Play stays locked until you do)',
        `connect downloaders, a parser and content storage, and download ${fmt(RATE)} useful pages a second`,
        'let DNS slow down with the Break it button and keep crawling at full speed',
        `stay within $${fmt(BUDGET)} a month`,
      ],
      debrief: {
        saw: 'With a DNS cache the downloaders were limited by their threads, not by lookups.',
        number: [`${dl.cap} pages/s`, 'one machine manages once DNS is cached'],
        next: 'Pages link mostly to their own site, so the queue now hands out long runs of URLs from one site.',
      },
    },
    {
      title: 'Be polite',
      mission: 1,
      minutes: 7,
      lead: 'A fast crawler and a rude crawler are easy to confuse.',
      sections: [
        {
          title: 'What makes a crawler polite?',
          hook: 'Hundreds of threads on one site look like an attack. The site slows down, and then it blocks you.',
          body: [
            {
              figure: 'figHosts',
              alt: 'With one shared queue, a run of URLs from one news site sends four threads at it at once. With one queue per site, each thread takes URLs from one site\'s queue and waits a second between requests, while the other threads work on other sites.',
              caption: 'One queue per site, one request at a time',
            },
            { p: 'Give every site its own queue, and let each queue be read by one thread, with a pause between requests. The site sees a gentle visitor, and the other threads stay busy with other sites.' },
            { p: 'Before crawling a site, read its <b>robots.txt</b>: the site\'s rules for which pages crawlers may fetch. Follow it, and cache it rather than fetching it every time.' },
          ],
          takeaway: 'One queue per site and one request at a time keep a crawler welcome.',
          quiz: [1, 5],
        },
        {
          title: 'How does the frontier decide what to crawl next?',
          hook: 'Not every page matters equally. A shop\'s home page matters more than a three-year-old forum reply.',
          body: [
            { table: { head: ['Part', 'Decides', 'How'], rows: [
              ['<b>Front queues</b>', 'What first', 'A score for each URL (links pointing to it, traffic, how often it changes) picks a queue; better queues are read more often'],
              ['<b>Back queues</b>', 'How fast per site', 'One queue per site, read by one thread with a pause'],
            ] } },
            { p: 'Pages also change. To keep the copy <b>fresh</b>, recrawl pages that change often and important pages first, not the whole web on a fixed timetable.' },
          ],
          takeaway: 'Front queues set priority and back queues set politeness.',
          quiz: [7, 8],
        },
      ],
      checks: [
        {
          q: 'A crawler gets 500 URLs from one site in a row. With a queue per site, what happens?',
          options: [
            { t: 'Many threads download them at once', why: 'That is the shared queue. A site\'s queue is read by one thread at a time.' },
            { t: 'They wait in that site\'s queue and go one at a time', right: true, why: 'Meanwhile the other threads crawl other sites, so the crawler stays busy.' },
          ],
        },
      ],
      youWill: [
        `send any site at most ${POLITE} request a second`,
        `let one site flood the frontier and still download ${fmt(RATE)} pages a second`,
        `stay within $${fmt(BUDGET)} a month`,
      ],
      debrief: {
        saw: 'The flooded site got one request a second, and the other threads crawled other sites meanwhile.',
        number: [`${POLITE} a second`, 'the most any one site received'],
        next: `About ${dupAbout} of pages copy a page you already have, and one site generates a new page for every click.`,
      },
    },
    {
      title: 'Don\'t waste work',
      mission: 2,
      minutes: 7,
      lead: 'The cheapest page to download is the one you skip.',
      sections: [
        {
          title: 'How to skip pages and links you already have',
          hook: 'Two checks, at two moments: before storing a page, and before queuing a link.',
          body: [
            { table: { head: ['Check', 'Asks', 'How'], rows: [
              ['<b>Content seen?</b>', 'Is this page a copy of one already stored?', 'Compare a hash of the page, not the page itself'],
              ['<b>URL seen?</b>', 'Has this link been crawled or queued already?', 'A Bloom filter or hash table of URLs'],
            ] } },
            { p: `Comparing whole pages would be far too slow at billions of pages. A <b>hash</b> turns each page into a short fixed-size value; equal pages give equal hashes. About ${dupAbout} of pages are copies, so this saves almost a third of the storage.` },
          ],
          takeaway: 'Hash pages to spot copies, and remember URLs so each is crawled once.',
          quiz: [3, 4],
        },
        {
          title: 'How do you avoid a site that never ends?',
          hook: 'Some sites make a new page for every link you follow: a calendar with a "next month" link, for ever.',
          body: [
            { p: 'This is a <b>spider trap</b>. Each URL is new, so "URL seen?" does not catch it. Set a <b>maximum URL length and depth</b>, and filter anything beyond it. No rule catches every trap: a site with an unusually large number of pages is the sign, and a person can then exclude it.' },
          ],
          takeaway: 'A limit on URL length and depth stops a crawler falling into endless sites.',
          quiz: [6],
        },
      ],
      checks: [
        {
          q: 'Two different URLs return exactly the same page. Which check catches it?',
          options: [
            { t: 'URL seen?', why: 'The URLs are different, so it lets both through.' },
            { t: 'Content seen?', right: true, why: 'The two pages give the same hash, so the second is not stored.' },
          ],
        },
      ],
      youWill: [
        `turn on the check that keeps storage under ${STORE_TB} TB a month`,
        'let the crawler find an endless calendar: no trap URLs may reach the frontier',
        `stay polite and within $${fmt(BUDGET)} a month`,
      ],
    },
  ],
  wrap: {
    picture: 'figBuiltEnd',
    alt: 'The finished design: a frontier with one queue per site feeds downloaders with a DNS cache. A parser skips content and links already seen, stores new pages and sends new links back.',
    say: [
      '"The frontier has front queues for priority and back queues, one per site, for politeness."',
      '"I cache DNS, because lookups done one at a time stall the downloaders."',
      '"Page hashes catch duplicates, a Bloom filter remembers URLs, and a depth limit stops spider traps."',
    ],
    numbers: [
      [about(MONTH_S, 2), 'seconds in a month'],
      [dupAbout, 'of pages are copies (an estimate)'],
    ],
    loop: `The interview steps: ${scope} (pages a second and storage), ${sketch} (the crawl loop), ${deep} (DNS cache, queues per site, duplicate checks), ${stress} (slow DNS, a flooded frontier, a spider trap).`,
    broken: 'Level 16 sends messages too, but to people: push notifications, texts and emails, through outside services that can fail.',
  },
};

// ---------------- Lesson pictures ----------------
/**
 * The crawl loop in six numbered steps: the frontier hands a URL to the downloader, which fetches the page for the
 * parser; "content seen?" sends new content to storage and the page's links to the link checks, which send new URLs
 * back to the frontier.
 * @param {Record<string, Function>} f the drawing helpers `drawFigures` is given
 * @param {SVGSVGElement} svg
 */
function drawLoop(f, svg) {
  const { figNode, figArrow, figSvg } = f;
  figSvg(svg, 400);
  figNode(svg, 'users', 120, 60, 'URL frontier', 'URLs to download');
  figNode(svg, 'downloader', 520, 60, 'Downloader', 'DNS, then download');
  figArrow(svg, 214, 60, 426, 60, 'next URL', '1', 290, 50);
  figNode(svg, 'parser', 520, 200, 'Parser', 'Valid page?');
  figArrow(svg, 520, 90, 520, 170, 'the page', '2', 548, 134);
  figNode(svg, 'parser', 520, 340, 'Content seen?', 'Compares hashes');
  figArrow(svg, 520, 230, 520, 310, 'valid page', '3', 548, 274);
  figNode(svg, 'contentstore', 120, 340, 'Content storage', 'New pages');
  figArrow(svg, 426, 340, 214, 340, 'new content', '4', 300, 364);
  figNode(svg, 'parser', 120, 200, 'Link checks', 'Filter, URL seen?');
  figArrow(svg, 430, 316, 214, 222, 'its links', '5', 360, 246);
  figArrow(svg, 120, 170, 120, 90, 'new URLs', '6', 148, 134);
}

/**
 * Politeness: one shared queue hands a run of one site's URLs to four threads at once; a queue per site lets one
 * thread take each site's URLs one at a time, with a pause.
 * @param {Record<string, Function>} f the drawing helpers `drawFigures` is given
 * @param {SVGSVGElement} svg
 */
function drawHosts(f, svg) {
  const { figNode, figArrow, figLabel, figSvg } = f;
  figSvg(svg, 426);
  panel(f, svg, 10, 160, 'One shared queue: a run of URLs from one site');
  queueCells(f, svg, 40, 76, ['wiki', 'shop', 'news', 'news', 'news', 'news']);
  figNode(svg, 'web', 530, 90, 'news.example', 'Overloaded');
  for (const y of [66, 82, 98, 114]) figArrow(svg, 286, 76, 432, y, '', null, 0, 0);
  figLabel(svg, 360, 150, 'four threads at once');
  panel(f, svg, 186, 230, 'One queue per site: one request at a time');
  figNode(svg, 'users', 110, 306, 'Queue router', 'Sorts by site');
  ['news', 'shop', 'wiki'].forEach((site, i) => {
    const y = 236 + 70 * i;
    figArrow(svg, 204, 306, 236, y, '', null, 0, 0);
    queueCells(f, svg, 240, y, [site, site, site, site]);
    figArrow(svg, 404, y, 436, y, `one thread, ${POLITE} a second`, null, 446, y + 4);
  });
}

/**
 * The finished design, drawn for the intro and again for the wrap-up: a frontier with a queue per site feeds
 * downloaders with a DNS cache; the parser stores new pages and sends new links, filtered and checked, back.
 * @param {Record<string, Function>} f the drawing helpers `drawFigures` is given
 * @param {SVGSVGElement} svg
 */
function drawBuilt(f, svg) {
  const { figNode, figArrow, figLabel, figSvg } = f;
  figSvg(svg, 400);
  figNode(svg, 'users', 120, 200, 'URL frontier', 'Queue per site');
  figNode(svg, 'downloader', 520, 60, 'Downloaders', 'With a DNS cache');
  figArrow(svg, 170, 170, 426, 66, 'URLs', null, 284, 108, 'end');
  figNode(svg, 'parser', 520, 200, 'Parser', 'Content seen?');
  figArrow(svg, 520, 90, 520, 170, 'pages', null, 534, 134);
  figNode(svg, 'contentstore', 520, 340, 'Content storage', 'New pages only');
  figArrow(svg, 520, 230, 520, 310, 'new pages', null, 534, 274);
  figArrow(svg, 426, 200, 214, 200, 'new links', null, 320, 190, 'middle');
  figLabel(svg, 320, 222, 'URL filter, URL seen?');
}

/** Share of downloads that are useful pages: fetched, not refused, not a trap's. */
const useful = (m) => (m.crawl ? m.servedPct * (1 - m.crawl.wasted) : m.servedPct);
/** @type {Goal} */
const crawlGoal = { id: 'crawl', type: 'metric', text: `Download ${fmt(RATE)} useful pages a second (${targets.servedPct}%)`, test: (m) => useful(m) >= targets.servedPct, val: (m) => fmtPct(useful(m)) };
/** @type {Goal} */
const politeGoal = { id: 'polite', type: 'metric', text: `At most ${POLITE} request a second to any website`, test: (m) => !!m.crawl && m.crawl.hostRate <= POLITE, val: (m) => (m.crawl ? `${fmt(m.crawl.hostRate)}/s` : '—') };
/** @type {Goal} */
const storeGoal = { id: 'storage', type: 'metric', text: `Store at most ${STORE_TB} TB a month`, test: (m) => !!m.crawl && m.crawl.storageTB <= STORE_TB, val: (m) => (m.crawl ? `${fmt(m.crawl.storageTB)} TB` : '—') };
const crawlOk = (m) => useful(m) >= targets.servedPct;

/** @type {Level} */
export default {
  id: 15,
  saveKey: 'sdl-level15-v1',
  saveVersion: 2, // 2: which missions were opened from the lesson (`opened`)
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
      hint: `One lookup at a time caps a machine at ${fmt(1000 / DNS_MS)} pages a second, and at ${fmt(1000 / SLOW_DNS_MS)} when DNS slows. Keep a DNS cache: only new hosts need a lookup. Then ${fmt(dl.cap)} pages a second per machine: 5 machines cover ${fmt(RATE)} with room for the peaks.`,
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
      story: `About ${Math.round(100 * DUP_SHARE)}% of pages copy a page already stored. Storage must stay under ${STORE_TB} TB a month. And some sites never end: calendar.example/2026/11/next/next/next/… makes a new page for every click. Don't fall in.`,
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
      { q: 'Why do crawlers use breadth-first rather than depth-first search?', o: ['BFS uses less memory on every graph', 'DFS can go very deep on one site', 'BFS finds pages in alphabetical order', 'DFS can\'t follow links'], a: 1, e: 'The web is a huge graph; depth-first can follow one site\'s links down and down. Breadth-first, with a FIFO queue, spreads the crawl across the web.', r: 'How does a crawler work through the web?' },
      { q: 'What makes a crawler polite?', o: ['Crawl only at night', 'Download each page twice', 'One request at a time per host, with a pause', 'Skip every page that has a form on it, to be safe'], a: 2, e: 'Map each host to its own queue, and let a thread download from it one page at a time with a delay in between. The site isn\'t flooded.', r: 'What makes a crawler polite?' },
      { q: 'Why does a DNS cache speed up the downloaders so much?', o: ['DNS gives bigger pages', 'It compresses IP addresses', 'It makes every page download in parallel threads', 'Many DNS interfaces do one lookup at a time'], a: 3, e: 'A lookup takes 10–200 ms, and many DNS interfaces block other threads while one runs. With host → IP in memory, only new hosts need a lookup.', r: 'Why is a crawler slow when its servers are idle?' },
      { q: 'How does "content seen?" find a duplicate page quickly?', o: ['Compare page hashes', 'Compare the pages character by character', 'Compare their URLs', 'Ask the website'], a: 0, e: 'Comparing whole pages is slow. A hash (checksum) of each page is compared with the hashes of pages already stored.', r: 'How to skip pages and links you already have' },
      { q: 'What does "URL seen?" usually use?', o: ['A relational table scan of every URL ever stored', 'A bloom filter or hash table', 'The DNS cache', 'robots.txt'], a: 1, e: 'A bloom filter (or a hash table) tells quickly whether a URL was already downloaded or is in the frontier, so it isn\'t added twice.', r: 'How to skip pages and links you already have' },
      { q: 'What is robots.txt?', o: ['A list of the site\'s robots', 'A sitemap of every page', 'Rules for which pages crawlers may fetch', 'A file that lists the passwords for the admin pages'], a: 2, e: 'The Robots Exclusion Protocol: a site lists what crawlers may not download, such as Disallow: /cart/. Fetch it before crawling the site, and cache it.', r: 'What makes a crawler polite?' },
      { q: 'calendar.example/2026/11/next/next/… never ends. What helps most?', o: ['A bigger DNS cache', 'More downloader machines and more threads on each', 'A maximum URL depth or length', 'A 301 redirect'], a: 2, e: 'An endless URL space is a crawler trap. Limit URL depth or length, and exclude sites found to be traps.', r: 'How do you avoid a site that never ends?' },
      { q: 'Front queues and back queues in the URL frontier do what?', o: ['Priority, then politeness', 'Reads first, then all the writes in a batch', 'Images, then HTML', 'Old URLs, then new'], a: 0, e: 'Front queues order URLs by priority (PageRank, traffic, update rate); back queues keep one host per queue, for politeness.', r: 'How does the frontier decide what to crawl next?' },
      { q: 'How does a crawler keep its copy of the web fresh?', o: ['Recrawl every page every day, whatever it is', 'Never recrawl', 'Only crawl new sites', 'Recrawl by update history and importance'], a: 3, e: 'Recrawling everything is too costly. Pages that change often, and important pages, are recrawled first and more often.', r: 'How does the frontier decide what to crawl next?' },
      { q: '2 billion pages a month, 300 KB each, kept 5 years. About how much storage?', o: ['3.6 PB', '36 PB', '600 TB', '360 PB'], a: 1, e: '2 × 10⁹ × 300 KB = 600 TB a month; × 12 × 5 = 36,000 TB = 36 PB.', r: 'Scope it: how much does a crawler download?' },
    ],
  },

  lesson,

  // Lesson diagrams. `f` provides the engine's drawing helpers. Each figure sets its own viewBox.
  drawFigures(f) {
    const { $ } = f;
    drawLoop(f, $('figLoop'));
    drawHosts(f, $('figHosts'));
    drawBuilt(f, $('figBuilt'));
    drawBuilt(f, $('figBuiltEnd'));
  },
};
