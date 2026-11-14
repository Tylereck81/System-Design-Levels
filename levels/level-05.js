// @ts-check
/** @import { Level, Goal, Lesson } from '../js/types.js' */
// Level 5: CDN for static content.
// Everything specific to this level lives here: components, rules, missions, quiz and text.
import { servedGoal, latGoal, costGoal, spofGoal, servedAtLeast } from './shared/goals.js';
import { regionUsers, dns, lb, NO_DB_NOTE, replicaDb, cache, cdn } from './shared/components.js';
import { dnsLookup, usersToLb, lbToWeb, webToReplicas, webToCache, usersToCdn, cdnToLb, lbBad, replicaBad, cacheBad, cdnBad } from './shared/connections.js';
import { lbText, replicaText, NO_ORIGIN, levelComplete } from './shared/text.js';
import { ONE_DNS, TWO_LBS, THREE_DBS, THREE_CACHES, ONE_CDN } from './shared/limits.js';
import { failText, passText } from './shared/quiz.js';
import { filesWorkload } from './shared/workload.js';
import { fmt, percent, ms } from '../js/format.js';
import { COMPONENTS, T } from '../js/engine/catalog.js';
import { STEPS } from './mock-steps.js';

const targets = { latencyMs: 150, servedPct: 99 };
/** Peak traffic in req/s, the share that writes, the share that are files and the share of shoppers far away: the same in all three missions. */
const LOAD = { qps: 4000, writes: 0.2, files: 0.5, far: 0.3 };
/** Shoppers in America must get files in under this many milliseconds. */
const FAR_MS = 60;
/** Monthly budget of every mission, in dollars. */
const BUDGET = 3100;
/** Mission 3: every shopper sees the new logo within this many seconds. */
const FRESH_SECS = 60;

/** @type {Goal} */
const farGoal = {
  id: 'far', type: 'metric', text: `Shoppers in America get files in under ${FAR_MS} ms`,
  test: (m) => m.farFileMs != null && m.farFileMs < FAR_MS,
  val: (m) => (m.farFileMs == null ? '—' : fmt(m.farFileMs) + ' ms'),
};
const served99 = servedAtLeast(targets.servedPct);
const duration = (s) => ({ 60: '1 minute', 600: '10 minutes', 3600: '1 hour', 86400: '1 day' }[s] || `${s} seconds`);
const cdnOf = (m) => m.g.onPath('cdn')[0] || null;

// ---------------- Lesson ----------------
const cdnPart = COMPONENTS.cdn;
const freshWithin = duration(FRESH_SECS);
const [scope, sketch, deep, stress] = STEPS.map((step) => `<b>${step.name}</b>`);
// A round trip across an ocean: a rounded teaching value from the widely published latency list, not a game number.
const oceanMs = 150;

// Cost example (ours): a blog platform, 400 files a second on average, 30 KB each.
const bill = { files: 400, kb: 30 };
const billMbPerSec = (bill.files * bill.kb) / 1000; // 12 MB/s
const billTbPerDay = (billMbPerSec * 86400) / 1e6; // 1.0368 TB
const billTbPerMonth = Math.round(billTbPerDay * 30); // 31 TB
const billDollars = Math.round((billTbPerMonth * 1000 * cdnPart.perGB) / 10) * 10; // $620
// Check yourself: another site, 10 TB a month.
const checkTb = 10;
const checkDollars = checkTb * 1000 * cdnPart.perGB; // $200

/** @type {Lesson} */
const lesson = {
  intro: {
    kicker: 'Level 5 · Part 1: Grow one app',
    title: 'CDN for static content',
    story: `The shop now sells in America, and ${percent(LOAD.far)} of your shoppers are an ocean away from your servers in Frankfurt. Every photo and script crosses that ocean. In this level you move the files next to the shoppers.`,
    picture: 'figBuilt',
    alt: 'The finished design: shoppers in Europe and America get files from a CDN edge near them and pages from the load balancers in Frankfurt. The CDN fetches a file from your servers only when it does not have it.',
    outcomes: [
      'say why distant users get slow pages',
      'explain what a CDN serves and how an edge fills up',
      'estimate a CDN bill from files per second',
      'keep the shop working when the CDN is down',
      'replace a file everywhere without waiting for it to expire',
    ],
  },
  last: 'Level 4 took most reads off the database. But half of all requests are files, such as photos, CSS and JavaScript, and every one still comes from your own servers, however far away the shopper is.',
  parts: [
    {
      title: 'Shoppers in America',
      mission: 0,
      minutes: 10,
      lead: 'Your servers are fast. They are also in one place.',
      newParts: [
        { type: 'cdn', aka: 'content delivery network', what: 'A provider\'s servers in cities around the world, each keeping copies of your files.', does: 'Sends each shopper photos, CSS and JavaScript from the server nearest to them. It fetches a file from your servers only when it has no copy.', game: `$${cdnPart.perGB} for each GB it sends.` },
      ],
      sections: [
        {
          title: 'Why is the shop slow for shoppers far away?',
          hook: 'A request has to travel there and back. Nothing you do to your servers shortens the trip.',
          body: [
            {
              figure: 'figDistance',
              alt: `A shopper in America is ${T.far} milliseconds, there and back, from the data center in Frankfurt, and ${T.rtt} milliseconds from a server nearby.`,
              caption: 'The round trip grows with distance',
            },
            { p: `A real round trip across an ocean takes about ${oceanMs} ms. In the game, shoppers near Frankfurt are ${ms(T.rtt)} away and shoppers in America ${ms(T.far)}.` },
            { p: 'One page loads many files, and each file pays the trip. So distant shoppers are the ones who gain most from moving files closer.' },
          ],
          takeaway: 'Distance adds time to every request, and faster servers cannot remove it.',
          quiz: [2],
        },
        {
          title: 'What does a CDN do?',
          hook: 'It keeps copies of your files close to every shopper.',
          body: [
            { p: 'A CDN serves <b>static files</b>: files that are the same for everyone, such as product photos, CSS and JavaScript. Each of its servers is called an <b>edge</b>. Your pages link to the CDN\'s address for files, so a shopper\'s browser fetches them from the nearest edge.' },
            { p: 'Pages are different. A page is built for one shopper (their cart, their prices), so it is <b>dynamic</b> and still comes from your own servers.' },
            { p: 'Your servers gain too: they stop sending files and keep their capacity for pages.' },
          ],
          takeaway: 'A CDN serves static files from near the user, and pages still come from you.',
          quiz: [0],
        },
        {
          title: 'How does an edge get a file?',
          hook: 'You do not upload anything. An edge fetches a file the first time someone asks for it.',
          body: [
            {
              figure: 'figPull',
              alt: 'Shopper A asks the edge for photo.jpg. The edge does not have it, fetches it from your servers, keeps a copy and sends it to shopper A. Shopper B then asks for the same file and gets it from the edge at once, without your servers being asked.',
              caption: 'The first request fills the edge. Later ones stop there',
            },
            { p: 'Your servers are the <b>origin</b>. With each file the origin sends a <b>TTL</b>: how long the edge may keep its copy. When it runs out, the edge fetches the file again.' },
            { p: 'So a TTL that is too short sends edges back to the origin all the time, and far shoppers wait again. One that is too long keeps old files around.' },
          ],
          takeaway: 'An edge pulls a file once, then serves its copy until the TTL ends.',
          quiz: [1, 3],
        },
        {
          title: 'How much does a CDN cost?',
          hook: `You pay for the data it sends. A blog platform sends ${fmt(bill.files)} files a second on average, ${bill.kb} KB each.`,
          body: [
            {
              calc: {
                formula: 'Data a month = files a second × file size × 86,400 × 30. Bill = GB × price per GB.',
                rows: [
                  { label: 'Each second', work: `${fmt(bill.files)} files/s × ${bill.kb} KB`, result: `${billMbPerSec} MB/s` },
                  { label: 'Each day', work: `${billMbPerSec} MB/s × 86,400 s`, result: `${billTbPerDay.toFixed(2)} TB` },
                  { label: 'Each month', work: `${billTbPerDay.toFixed(2)} TB × 30 days`, result: `${billTbPerMonth} TB`, approx: true },
                  { label: 'Bill', work: `${fmt(billTbPerMonth * 1000)} GB × $${cdnPart.perGB}`, result: `$${fmt(billDollars)} a month` },
                ],
                result: `About ${billTbPerMonth} TB and $${fmt(billDollars)} a month. Use the average rate here, not the peak: a bill adds up over the whole day.`,
              },
            },
            { p: 'Files that are rarely requested gain little from an edge. They can stay on your own servers.' },
          ],
          takeaway: 'A CDN bill follows the data sent, so estimate it from the average rate.',
          quiz: [8, 9],
        },
      ],
      checks: [
        {
          q: `A site sends ${checkTb} TB of files a month through a CDN at $${cdnPart.perGB} per GB. What is the bill?`,
          options: [
            { t: `$${checkTb * cdnPart.perGB}`, why: `That prices ${checkTb} GB. A TB is 1,000 GB.` },
            { t: `$${fmt(checkDollars)}`, right: true, why: `${checkTb} TB is ${fmt(checkTb * 1000)} GB. ${fmt(checkTb * 1000)} × $${cdnPart.perGB} = $${fmt(checkDollars)}.` },
            { t: `$${fmt(checkDollars * 10)}`, why: 'One zero too many. Write the units on every step.' },
          ],
        },
      ],
      youWill: [
        'estimate the data the CDN sends in a month (Play stays locked until you do)',
        'add a CDN, connect Users to it, and connect it to your load balancers as its origin',
        `pick a TTL so shoppers in America get files in under ${ms(FAR_MS)}`,
        `stay within $${fmt(BUDGET)} a month with Response under ${ms(targets.latencyMs)}`,
      ],
      debrief: {
        saw: 'Files came from an edge near each shopper, and your load balancers lost about half their traffic.',
        number: [`$${cdnPart.perGB} per GB`, 'what the CDN charges for data sent'],
        next: 'The CDN now carries half of all requests. CDNs have outages too.',
      },
    },
    {
      title: 'The CDN goes down',
      mission: 1,
      minutes: 5,
      lead: 'You do not run the CDN, so you cannot fix it. You can only plan for the day it stops.',
      sections: [
        {
          title: 'What breaks when the CDN is down?',
          hook: 'Your servers are fine, and pages still load. But every page links to its files on the CDN.',
          body: [
            { p: 'With the CDN gone, those links fail. Shoppers get pages with no photos, no styles and no scripts, which is as good as down. A part you rent can be a single point of failure just like a part you own.' },
          ],
          takeaway: 'If pages link only to the CDN, a CDN outage breaks every page.',
          quiz: [4],
        },
        {
          title: 'How to fall back to your own servers',
          hook: 'The origin still has every file. Let the page ask it when the CDN does not answer.',
          body: [
            { ol: [
              'The page tries the CDN first.',
              'If a file fails to load, the page requests the same file from the origin.',
              'When the CDN returns, pages go back to it on their own.',
            ] },
            { p: 'This is a <b>fallback</b>. During the outage far shoppers are slow again, but nothing is broken. It only works if the origin can carry every file, so keep enough web servers for that day.' },
          ],
          takeaway: 'Fall back to the origin, and keep the origin big enough to carry every file.',
          quiz: [5],
        },
      ],
      checks: [
        {
          q: 'After adding a CDN you halve your web servers, because they no longer send files. The CDN then has an outage and pages fall back to the origin. What happens?',
          options: [
            { t: 'Files are slower but all arrive', why: 'Only if the origin can carry them. You removed that capacity.' },
            { t: 'The origin is overloaded and requests fail', right: true, why: 'The fallback sends every file back to servers that were sized without them.' },
          ],
        },
      ],
      youWill: [
        'set what pages do when the CDN is down',
        'take the CDN down with the Break it button and stay above the Served target',
        `finish with no single point of failure, for at most $${fmt(BUDGET)} a month`,
      ],
      debrief: {
        saw: 'The CDN went down and the origin took every file back. Files were slower for America, but none failed.',
        number: [`${targets.servedPct}%`, 'still served with the CDN down'],
        next: `Marketing ships a new logo at 9:00 and wants every shopper to see it within ${freshWithin}.`,
      },
    },
    {
      title: 'A new logo',
      mission: 2,
      minutes: 7,
      lead: 'Copies make files fast. Copies also keep old files alive.',
      sections: [
        {
          title: 'Why do shoppers still see the old file?',
          hook: 'You replaced the file on your servers. But two other places hold a copy, each with its own TTL.',
          body: [
            {
              figure: 'figCopies',
              alt: 'The origin has the new logo. The edge and the shopper\'s browser each still hold a copy of the old one. Invalidating clears the edge only. A page that links to a new file name gets the new logo, because neither the edge nor the browser has that name.',
              caption: 'The edge and the browser each keep a copy',
            },
            { ul: [
              '<b>The edge</b> keeps its copy until the TTL ends.',
              '<b>The shopper\'s browser</b> keeps its own copy for the same time, and does not even ask the edge.',
            ] },
            { p: 'A short TTL would fix it, but then edges keep going back to the origin and far shoppers are slow again.' },
          ],
          takeaway: 'An old file lives on at the edge and in the browser until its TTL ends.',
          quiz: [7],
        },
        {
          title: 'How to replace a file everywhere at once',
          hook: 'There are two tools, and they do not reach the same copies.',
          body: [
            { table: { head: ['Tool', 'What it does', 'Clears the edge', 'Clears the browser'], rows: [
              ['<b>Invalidate</b>', 'Tell the CDN to drop its copy now', 'Yes', 'No'],
              ['<b>New name</b>', 'Publish the file under a new name and link pages to it', 'Not needed', 'Not needed'],
            ] } },
            { p: 'A new name is a new file. No edge and no browser has it, so everyone fetches it on the next page load. This is <b>versioning</b>: <code>logo.v2.svg</code>, or <code>logo.svg?v=2</code>.' },
            { p: 'Because a changed file always gets a new name, the old name never changes, and you can give every file a very long TTL.' },
          ],
          takeaway: 'Give a changed file a new name, and keep the TTL long.',
          quiz: [6],
        },
      ],
      checks: [
        {
          q: 'You invalidate style.css through the CDN. A shopper who visited an hour ago opens the shop again. Which style do they see?',
          options: [
            { t: 'The new one', why: 'Their browser still has its own copy and does not ask the edge until the TTL ends.' },
            { t: 'Possibly the old one', right: true, why: 'Invalidating clears edges, not browsers. A new file name reaches both.' },
          ],
        },
      ],
      youWill: [
        `keep files fast for America (under ${ms(FAR_MS)})`,
        `press Ship the new logo and make sure every shopper sees it within ${freshWithin}`,
        `stay within $${fmt(BUDGET)} a month`,
      ],
    },
  ],
  wrap: {
    picture: 'figBuiltEnd',
    alt: 'The design you built: shoppers get files from a CDN edge near them and pages from the load balancers in Frankfurt. The CDN fetches a file from your servers only when it does not have it.',
    say: [
      '"Static files go on a CDN, so each user gets them from an edge nearby."',
      '"If the CDN fails, pages fall back to the origin, which I keep big enough to carry every file."',
      '"A changed file gets a new name, so I can keep a long TTL."',
    ],
    numbers: [
      [`${oceanMs} ms`, 'a round trip across an ocean'],
      [`$${cdnPart.perGB}`, 'per GB sent, in the game'],
      ['86,400', 'seconds in a day, for turning a rate into a daily total'],
    ],
    loop: `The interview steps again: ${scope} (the data a month and the bill), ${sketch} (CDN in front, origin behind), ${deep} (TTL and file names), ${stress} (you took the CDN down and shipped a new logo).`,
    broken: 'Pages still cross the ocean, and your web servers still remember things about each shopper. Level 6 deals with what servers remember. Level 7 puts servers in America.',
  },
};

/**
 * The finished design, shown on the intro and again on the wrap-up: one drawing, two svgs.
 * @param {Record<string, Function>} f the drawing helpers `drawFigures` is given
 * @param {SVGSVGElement} svg
 */
function drawBuilt(f, svg) {
  const { svgEl, figNode, figArrow, figDefs, figLabel, figDash } = f;
  svg.textContent = ''; svg.setAttribute('viewBox', '0 0 640 452'); figDefs(svg);
  figNode(svg, 'users', 110, 50, 'Users', 'In America');
  figNode(svg, 'users', 530, 50, 'Users', 'In Europe');
  figNode(svg, 'cdn', 320, 170, 'CDN', 'Edges near users');
  figArrow(svg, 150, 80, 270, 140, 'files', null, 220, 104);
  figArrow(svg, 490, 80, 370, 140, 'files', null, 430, 104, 'end');
  // Frankfurt: the load balancers are the CDN's origin; the web servers, caches and databases sit behind them.
  svgEl('rect', { x: 420, y: 238, width: 210, height: 204, rx: 12, class: 'tier-box' }, svg);
  figLabel(svg, 434, 258, 'Frankfurt', 'start', 'tier-label');
  figNode(svg, 'lb', 530, 300, 'Load balancers', 'The CDN\'s origin');
  figNode(svg, 'web', 530, 400, 'Your servers', 'Web, cache, DBs');
  figArrow(svg, 530, 330, 530, 370, '', null, 0, 0);
  figArrow(svg, 570, 80, 570, 270, 'pages', null, 580, 180);
  // Pages from America take the long way round.
  svgEl('line', { x1: 60, y1: 80, x2: 60, y2: 300, class: 'd-line' }, svg);
  figArrow(svg, 60, 300, 436, 300, 'pages: the long trip', null, 240, 292, 'middle');
  figDash(svg, 'M414 170 H470 V266');
  figLabel(svg, 460, 222, 'fetch on a miss', 'end');
}

/**
 * How an edge fills: the first shopper's request goes on to the origin; the second is answered from the edge's copy.
 * @param {Record<string, Function>} f the drawing helpers `drawFigures` is given
 * @param {SVGSVGElement} svg
 */
function drawPull(f, svg) {
  const { figNode, figArrow, figDefs } = f;
  svg.textContent = ''; svg.setAttribute('viewBox', '0 0 640 380'); figDefs(svg);
  figNode(svg, 'users', 110, 50, 'Shopper A', 'First to ask');
  figNode(svg, 'users', 530, 50, 'Shopper B', 'Asks later');
  figNode(svg, 'cdn', 320, 190, 'CDN edge', 'Keeps a copy');
  figNode(svg, 'web', 320, 330, 'Origin', 'Asked only once');
  figArrow(svg, 120, 80, 232, 160, 'photo.jpg?', '1', 40, 130);
  figArrow(svg, 300, 220, 300, 300, 'not here: fetch', '2', 130, 265);
  figArrow(svg, 340, 300, 340, 220, 'photo.jpg + TTL', '3', 380, 265);
  figArrow(svg, 270, 160, 158, 80, 'photo.jpg', '4', 230, 112);
  figArrow(svg, 520, 80, 408, 160, 'photo.jpg?', '5', 486, 135);
  figArrow(svg, 370, 160, 482, 80, 'its copy', '6', 352, 104);
}

/**
 * Where an old file lives on: the edge and the browser each keep a copy. Invalidating reaches only the edge; a new
 * name reaches both.
 * @param {Record<string, Function>} f the drawing helpers `drawFigures` is given
 * @param {SVGSVGElement} svg
 */
function drawCopies(f, svg) {
  const { svgEl, figNode, figArrow, figDefs, figLabel } = f;
  svg.textContent = ''; svg.setAttribute('viewBox', '0 0 640 420'); figDefs(svg);
  /** One panel: the origin, the edge and the browser in a row, with a line under them. */
  const panel = (y, label, subs, note) => {
    svgEl('rect', { x: 10, y, width: 620, height: 190, rx: 12, class: 'tier-box' }, svg);
    figLabel(svg, 24, y + 20, label, 'start', 'tier-label');
    figNode(svg, 'web', 114, y + 100, 'Origin', subs[0]);
    figNode(svg, 'cdn', 320, y + 100, 'CDN edge', subs[1]);
    figNode(svg, 'users', 526, y + 100, 'Browser', subs[2]);
    figLabel(svg, 320, y + 168, note);
  };
  panel(10, 'Same name: logo.svg', ['Has the new logo', 'Copy dropped', 'Still the old logo'], 'Invalidating reaches the edge, not the browser');
  figArrow(svg, 320, 40, 320, 78, 'invalidate', null, 332, 62);
  panel(220, 'New name: logo.v2.svg', ['Has logo.v2.svg', 'No copy: fetches it', 'No copy: fetches it'], 'No one has the new name, so everyone fetches it');
}

/** @type {Level} */
export default {
  id: 5,
  saveKey: 'sdl-level5-v1',
  saveVersion: 2, // 2: which missions were opened from the lesson (`opened`)
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
      title: 'Shoppers in America', ref: 'CDN', ...LOAD, budget: BUDGET,
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
      story: `The shop now sells in America too: ${percent(LOAD.far)} of shoppers are there, ${ms(T.far)} from the data center in Frankfurt. Half of all requests are files, such as product photos, CSS and JavaScript, and each one makes that long trip. Serve the files from a CDN, so shoppers in America get them in under ${ms(FAR_MS)}.`,
      goals: [
        { id: 'est', type: 'gate', text: 'Estimate the CDN\'s data per month' },
        farGoal, servedGoal(targets), latGoal(targets), costGoal(BUDGET),
      ],
      hint: 'Add a CDN. Connect Users to it, and connect it to both load balancers: they are its origin. Then select it and pick a TTL long enough that most files are still at the edge when the next request comes. Select Users to see both round trips.',
      takeaway: 'Files now come from an edge near each shopper: about 45 ms for America instead of about 130. The load balancers lost most of their traffic too. Pages still travel to Frankfurt; putting servers in America is Level 7.',
    },
    {
      title: 'The CDN goes down', ref: 'CDN fallback', ...LOAD, budget: BUDGET,
      story: 'CDNs have outages too, and the CDN now carries half your traffic. If pages link only to the CDN, an outage breaks every photo, stylesheet and script on the site. Make the pages fall back to your own servers.',
      goals: [
        farGoal, spofGoal(), servedGoal(targets), latGoal(targets), costGoal(BUDGET),
        { id: 'crash-cdn', type: 'exp', text: 'Break it: take the CDN down and still serve at least 99%' },
      ],
      hint: 'Select the CDN and set "If the CDN is down" to load files from the origin. Your two XL web servers sent every file before the CDN, so they can again.',
      takeaway: 'With fallback, the outage made files slower, but none failed: the origin took them all back. That works only while the origin can still carry every file, so don\'t size it for the misses alone.',
    },
    {
      title: 'A new logo', ref: 'Invalidation', ...LOAD, budget: BUDGET,
      story: `Marketing ships a new logo at 9:00 and wants every shopper to see it within ${freshWithin}. Edges and shoppers' browsers both keep files until their TTL runs out. Keep files fast for America, and get the new logo out in time.`,
      goals: [
        farGoal, spofGoal(), servedGoal(targets), latGoal(targets), costGoal(BUDGET),
        { id: 'new-logo', type: 'exp', text: `Break it: ship the new logo; every shopper sees it within ${freshWithin}` },
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
      expect: (m) => m.fileStaleSecs <= FRESH_SECS,
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
      { q: 'In a design like this one, what does the CDN serve?', o: ['Pages built for each shopper', 'Order and payment requests', 'Photos, CSS and JavaScript', 'Database queries'], a: 2, e: 'A CDN keeps copies of static files, the same for every shopper, on edges near them. Pages built per shopper, orders and queries go to your own servers. Some CDNs can cache whole pages too, but that is a separate feature.', r: 'What does a CDN do?' },
      { q: 'A shopper asks for photo.jpg, and the nearest edge does not have it. What happens?', o: ['The request fails, and the browser retries in a minute', 'The edge pulls it from the origin, then keeps it', 'The browser asks another shopper\'s device', 'The origin pushes every file to every edge'], a: 1, e: 'On a miss the edge fetches the file from the origin, keeps it for the TTL the origin sends, and returns it. The next shopper near that edge gets a hit.', r: 'How does an edge get a file?' },
      { q: 'Your data center is in Frankfurt. Which shoppers gain most from a CDN?', o: ['Shoppers far from Frankfurt', 'Shoppers next door to the data center', 'Shoppers who only place orders', 'Every shopper gains the same'], a: 0, e: 'An edge is near every shopper, so a far shopper\'s wait drops from the long trip to Frankfurt to the short trip to the edge. Shoppers next to the data center were already close. Orders are not static files.', r: 'Why is the shop slow for shoppers far away?' },
      { q: 'You set the CDN\'s TTL to 1 minute. What goes wrong?', o: ['Changed files stay old for days at a time', 'The CDN refuses large files', 'Browsers stop caching files', 'Edges refetch from the origin often'], a: 3, e: 'Files expire so quickly that many requests find them gone, and the edge goes back to the origin. The origin does the work again, and those shoppers wait for the long trip. Too long a TTL has the opposite problem: changed files stay old.', r: 'How does an edge get a file?' },
      { q: 'Pages link their files only to the CDN, and the CDN goes down. What do shoppers see?', o: ['Pages without photos, styles or scripts', 'Nothing changes, since the edges keep their copies', 'Pages load faster from the origin', 'Only the login page'], a: 0, e: 'Every file request goes to the CDN and fails, so pages arrive without their photos, CSS and JavaScript. Pages themselves still load from your servers.', r: 'What breaks when the CDN is down?' },
      { q: 'How should a site cope with a CDN outage?', o: ['Shoppers wait until the CDN provider recovers', 'The CDN serves files from its database', 'Every page is switched off for safety', 'Pages fetch failed files from the origin'], a: 3, e: 'The page notices that a file failed and fetches it from your own servers instead. It is slower, and the origin must be able to carry every file again, but nothing breaks.', r: 'How to fall back to your own servers' },
      { q: 'You replace logo.svg and want every shopper to see it now, browsers included. What works?', o: ['Wait for the TTL to run out', 'Link pages to logo.svg?v=3', 'Lower the TTL after the change', 'Invalidate logo.svg on the CDN'], a: 1, e: 'A new URL is a file no edge or browser has, so everyone fetches it at once. Invalidating clears the edges, but browsers keep their own copy until it expires. Lowering the TTL only affects copies made after the change.', r: 'How to replace a file everywhere at once' },
      { q: 'You invalidate a file through the CDN\'s API. Which copies can still be old?', o: ['The copies on the edges', 'The copy on the origin', 'Copies in shoppers\' browsers', 'None: every copy everywhere is cleared'], a: 2, e: 'Invalidation removes the file from the CDN\'s edges. Browsers that cached the old file keep it until their own copy expires. That is one reason teams version file names instead.', r: 'Why do shoppers still see the old file?' },
      { q: 'Why move rarely used files off the CDN?', o: ['The CDN cannot store them', 'Rarely used files slow down the popular ones', 'Browsers block rarely used files', 'You pay per GB, and they rarely get hits'], a: 3, e: 'You pay for the data the CDN sends and receives. A rarely used file has usually expired at the edge by the next request, so it costs you the trip to the origin and the transfer, with little speed gained.', r: 'How much does a CDN cost?' },
      { q: 'A site sends 200 files/s on average, 50 KB each. Roughly how much data is that per day?', o: ['~8.6 TB', '~860 GB', '~86 GB', '~86 TB'], a: 1, e: '200 × 50 KB = 10 MB/s. 10 MB/s × 86,400 s = 864,000 MB ≈ 860 GB a day, or about 26 TB in a 30-day month.', r: 'How much does a CDN cost?' },
    ],
  },

  lesson,

  // Lesson diagrams. `f` provides the engine's drawing helpers. Each figure sets its own viewBox.
  drawFigures(f) {
    const { $, figNode, figArrow, figDefs } = f;
    // Distance: the shopper in America is a short round trip from an edge and a long one from Frankfurt.
    const f1 = $('figDistance'); f1.textContent = ''; f1.setAttribute('viewBox', '0 0 640 270'); figDefs(f1);
    figNode(f1, 'users', 110, 70, 'Shopper', 'In America');
    figNode(f1, 'web', 530, 70, 'Your servers', 'In Frankfurt');
    figNode(f1, 'cdn', 110, 230, 'CDN edge', 'Near the shopper');
    figArrow(f1, 204, 60, 436, 60, `${ms(T.far)} round trip`, null, 320, 48, 'middle');
    figArrow(f1, 436, 80, 204, 80, '', null, 0, 0);
    figArrow(f1, 100, 100, 100, 200, `${ms(T.rtt)} round trip`, null, 134, 155);
    figArrow(f1, 120, 200, 120, 100, '', null, 0, 0);

    drawPull(f, $('figPull'));
    drawCopies(f, $('figCopies'));
    drawBuilt(f, $('figBuilt'));
    drawBuilt(f, $('figBuiltEnd'));
  },
};
