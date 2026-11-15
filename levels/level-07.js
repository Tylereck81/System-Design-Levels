// @ts-check
/** @import { Level, Goal, Lesson } from '../js/types.js' */
// Level 7: Multiple data centers.
// Everything specific to this level lives here: components, rules, missions, quiz and text.
// From this level on, one box stands for a whole data center: the design built in Levels 2 to 6.
import { fmt, percent, ms } from '../js/format.js';
import { T } from '../js/engine/catalog.js';
import { servedGoal, latGoal, costGoal, spofGoal, servedAtLeast, fmtPct } from './shared/goals.js';
import { regionUsers, cdn } from './shared/components.js';
import { dnsLookup, usersToCdn, CDN_DNS_BAD } from './shared/connections.js';
import { lbText, replicaText, levelComplete } from './shared/text.js';
import { ONE_DNS, ONE_CDN } from './shared/limits.js';
import { failText, passText } from './shared/quiz.js';
import { filesWorkload } from './shared/workload.js';
import { STEPS } from './mock-steps.js';

const targets = { latencyMs: 150, servedPct: 99 };
/** Peak traffic in req/s, the share that writes, the share that are files and the share of shoppers in America: the same in both missions. */
const LOAD = { qps: 4000, writes: 0.2, files: 0.5, far: 0.3 };
const PCT = { wholeFrom: 10 }; // percentages: whole numbers from 10% up
/** Mission 1's goal: pages reach shoppers in America in under this many ms. */
const FAR_PAGE_MS = 100;
/** Monthly budget of Mission 1, in dollars. */
const BUDGET = 3100;
/** Monthly budget of Mission 2, in dollars. */
const FAILOVER_BUDGET = 3500;
const NO_DATA_MAX = 0.05; // % of requests: below this, nobody missed their data

/** @type {Goal} */
const farPageGoal = {
  id: 'far-page', type: 'metric', text: `Pages reach shoppers in America in under ${FAR_PAGE_MS} ms`,
  test: (m) => m.farPageMs != null && m.farPageMs < FAR_PAGE_MS,
  val: (m) => (m.farPageMs == null ? '—' : fmt(m.farPageMs) + ' ms'),
};
const served99 = servedAtLeast(targets.servedPct);
const place = (n) => (n.region === 'far' ? 'Virginia' : 'Frankfurt');

// ---------------- Lesson ----------------
const [scope, sketch, deep, stress] = STEPS.map((step) => `<b>${step.name}</b>`);
/** A round trip across an ocean in real life, in ms: the rounded value from the public table of timings every programmer should know. */
const OCEAN_MS = 150;
// Failover example (ours): 3,000 pages/s at peak, 1,650 in one region and 1,350 in the other (55% and 45%).
const fo = { big: 1650, small: 1350 };
const foTotal = fo.big + fo.small; // 3,000 pages/s
// Check yourself: three data centers share 7,500 pages/s; one fails, so 7,500 ÷ 2 = 3,750 each (2,500 normally).
const foCheck = { total: 7500, n: 3 };
const europe = percent(1 - LOAD.far); // 70%
const america = percent(LOAD.far); // 30%

/** @type {Lesson} */
const lesson = {
  intro: {
    kicker: 'Level 7 · Part 1: Grow one app',
    title: 'Multiple data centers',
    story: 'Everything you have built stands in one building in Frankfurt. American shoppers wait for every page to cross the ocean, and one power failure would close the shop. In this level you open a second data center.',
    picture: 'figBuilt',
    alt: 'The finished design: GeoDNS sends shoppers in Europe to the Frankfurt data center and shoppers in America to the Virginia data center. The two data centers copy data to each other.',
    outcomes: [
      'say what a second data center improves',
      'explain how GeoDNS picks a data center for each user',
      'list what a failover between data centers needs',
      'size a data center to survive losing the other',
      'explain why the newest data can be missing after failover',
    ],
  },
  last: 'Level 6 made the web tier stateless and automatic. But the whole design sits in one data center: pages for America still cross the ocean, and the building itself is a single point of failure.',
  parts: [
    {
      title: 'Pages for America',
      mission: 0,
      minutes: 7,
      lead: 'From here on, your whole design from Levels 2 to 6 is one box: a data center.',
      newParts: [
        { type: 'dc', what: 'A building full of servers. Here it holds your whole design: load balancers, web servers, caches, databases and the session store.', does: 'Serves pages to the shoppers that DNS sends to it.', game: `Three sizes. A page takes about ${ms(T.dcPage)} inside it.` },
      ],
      sections: [
        {
          title: 'Why are pages still slow in America?',
          hook: 'The CDN moved the files. It did not move the pages.',
          body: [
            { p: `A page is built for one shopper, so it comes from your own servers, and for America that means a trip across the ocean and back: about ${ms(OCEAN_MS)} in real life, ${ms(T.far)} in the game, before your servers do any work.` },
            { p: 'The only way to shorten that trip is to put servers closer. A second <b>data center</b> in America gives American shoppers a short trip for pages too.' },
            { p: 'It also removes the last single point of failure you have: the building. Power cuts, floods and network faults take out a whole data center at once, however many spare servers are inside it.' },
          ],
          takeaway: 'A second data center shortens the trip for pages and survives the loss of a building.',
          quiz: [8],
        },
        {
          title: 'How does a shopper reach the nearest data center?',
          hook: 'DNS already tells every device where the shop is. Now it gives a different answer depending on who asks.',
          body: [
            {
              figure: 'figGeo',
              alt: 'A shopper in Berlin asks GeoDNS for example.com and is given the address of the Frankfurt data center. A shopper in Boston asks the same question and is given the address of the Virginia data center.',
              caption: 'The same name, a different address for each region',
            },
            { p: '<b>GeoDNS</b> is a DNS service that looks at where the request comes from and answers with the address of the nearest data center. This is <b>geo-routing</b>.' },
            { p: 'Each data center now serves only its own region, so each can be smaller than the one that served everybody.' },
          ],
          takeaway: 'GeoDNS answers by location, so each user is sent to the nearest data center.',
          quiz: [0],
        },
      ],
      checks: [
        {
          q: 'A shop has one data center in Europe and a CDN. It opens a second data center in America. What improves most for American shoppers?',
          options: [
            { t: 'How fast photos load', why: 'Photos already came from a CDN edge nearby.' },
            { t: 'How fast pages load', right: true, why: 'Pages come from your own servers, and those are now on the same continent.' },
          ],
        },
      ],
      youWill: [
        'add a data center, set its location to Virginia and connect Users to it',
        'switch DNS to GeoDNS',
        `get pages to shoppers in America in under ${ms(FAR_PAGE_MS)}`,
        `resize Frankfurt for Europe alone, for at most $${fmt(BUDGET)} a month`,
      ],
      debrief: {
        saw: 'Each shopper reached the nearest data center, and pages in America no longer crossed the ocean.',
        number: [america, 'of shoppers are in America'],
        next: 'Each data center is now sized for its own region. A power failure is about to take Virginia offline at the evening peak.',
      },
    },
    {
      title: 'Virginia goes dark',
      mission: 1,
      minutes: 11,
      lead: 'Two data centers only protect you if one can stand in for the other.',
      sections: [
        {
          title: 'What must be true for a failover to work?',
          hook: 'When a data center goes offline, its shoppers must carry on from the other one. Three things have to be ready before that day.',
          body: [
            { table: { head: ['Needed', 'How', 'If it is missing'], rows: [
              ['<b>Traffic moves</b>', 'GeoDNS stops giving out the dead address', 'Shoppers keep knocking on a dead door'],
              ['<b>Room</b>', 'The survivor can carry both regions', 'The survivor is overloaded and fails too'],
              ['<b>Data</b>', 'Accounts, carts and orders were copied there already', 'Shoppers arrive and their data is not there'],
            ] } },
            { p: 'Devices remember a DNS answer until its TTL runs out, as a cache does in Level 4. Until then, some keep trying the old address. A short TTL makes a failover quicker, at the price of more lookups. In the game the switch is immediate.' },
          ],
          takeaway: 'Failover needs traffic to move, room in the survivor, and the data already there.',
          quiz: [1, 5, 2],
        },
        {
          title: 'How big must the surviving data center be?',
          hook: `A shop opens ${fmt(foTotal)} pages a second at peak: ${percent(fo.big / foTotal)} in one region and ${percent(fo.small / foTotal)} in the other.`,
          body: [
            {
              calc: {
                formula: 'Load on the survivor = its own region + the region that failed.',
                rows: [
                  { label: 'Larger region', work: `${fmt(foTotal)} pages/s × ${percent(fo.big / foTotal)}`, result: `${fmt(fo.big)} pages/s` },
                  { label: 'Smaller region', work: `${fmt(foTotal)} pages/s × ${percent(fo.small / foTotal)}`, result: `${fmt(fo.small)} pages/s` },
                  { label: 'Either one alone', work: `${fmt(fo.big)} pages/s + ${fmt(fo.small)} pages/s`, result: `${fmt(foTotal)} pages/s` },
                ],
                result: `Whichever one survives must carry all ${fmt(foTotal)} pages a second.`,
              },
            },
            { p: 'This is N + 1 again, with buildings in place of servers. A data center sized only for its own region saves money every day and fails on the one day you need it. In this mission only Virginia can fail, so only Frankfurt must be big enough; a real setup sizes both.' },
          ],
          takeaway: 'Size each data center for all the traffic, not just its own region.',
          quiz: [7, 9],
        },
        {
          title: 'Why can the newest changes be missing?',
          hook: 'The data centers copy every change to each other. The copy has to cross the ocean.',
          body: [
            {
              figure: 'figFailover',
              alt: 'Virginia is offline. GeoDNS now sends shoppers in America to Frankfurt, which carries both regions. The last second of changes made in Virginia had not been copied to Frankfurt.',
              caption: 'All traffic on Frankfurt, and the last second of Virginia\'s changes never arrived',
            },
            { p: `If every write waited for the far side to confirm, every write would be slow by an ocean round trip, and writes would stop whenever the link failed. So the copy is sent <b>without waiting</b>. In the game it arrives about ${T.dcLag} second later.` },
            { p: 'When a data center dies suddenly, the changes still on their way are lost. This is the same replication lag as in Level 3, at a larger distance.' },
          ],
          takeaway: 'Copies between data centers do not wait, so a failover can lose the newest changes.',
          quiz: [3, 4],
        },
        {
          title: 'How to keep two data centers the same',
          hook: 'Two data centers must behave as one shop.',
          body: [
            { p: 'Release new versions with <b>automated deployment</b>, so both always run the same code. Test the shop from each region, not only from your own desk. And practise the failover before you need it, which is what the Break it button is for.' },
          ],
          takeaway: 'Automate deployment so every data center runs the same version.',
          quiz: [6],
        },
      ],
      checks: [
        {
          q: `Three data centers share ${fmt(foCheck.total)} pages a second equally. One goes offline. What must each of the other two carry?`,
          options: [
            { t: `${fmt(foCheck.total / foCheck.n)} pages/s`, why: 'That is the normal share. The failed data center\'s traffic has to go somewhere.' },
            { t: `${fmt(foCheck.total / (foCheck.n - 1))} pages/s`, right: true, why: `${fmt(foCheck.total)} over the ${foCheck.n - 1} that are left. More data centers means each needs less spare room.` },
            { t: `${fmt(foCheck.total)} pages/s`, why: 'That would be needed only if two failed at once.' },
          ],
        },
        {
          q: 'A data center fails one second after a shopper there placed an order. The order may be missing from the other data center. Why?',
          options: [
            { t: 'The order was never saved', why: 'It was saved, in the data center that then failed.' },
            { t: 'The copy had not crossed the ocean yet', right: true, why: 'Changes are copied without waiting, so the newest ones can still be on their way.' },
          ],
        },
      ],
      youWill: [
        'estimate what Frankfurt must carry alone (Play stays locked until you do)',
        'connect the two data centers so Virginia\'s data is copied to Frankfurt',
        'take Virginia offline with the Break it button and stay above the Served target',
        `finish with no single point of failure, for at most $${fmt(FAILOVER_BUDGET)} a month`,
      ],
    },
  ],
  wrap: {
    picture: 'figBuiltEnd',
    alt: 'The design you built: GeoDNS sends shoppers in Europe to the Frankfurt data center and shoppers in America to the Virginia data center. The two data centers copy data to each other.',
    say: [
      '"I run two data centers and use GeoDNS to send each user to the nearest one."',
      '"Each data center is sized to carry all the traffic, so one can fail."',
      '"Data is copied between them without waiting, so a failover can lose the newest writes."',
    ],
    numbers: [
      [ms(OCEAN_MS), 'a round trip across an ocean'],
      [`${T.dcLag} second`, 'for a change to reach the other data center, in the game'],
    ],
    loop: `The interview steps again: ${scope} (what the survivor must carry), ${sketch} (two data centers and GeoDNS), ${deep} (sizes and copying data), ${stress} (you took a whole data center offline).`,
    broken: `Some work is too slow to do while a user waits. In Level 8, creators upload audio that takes ${T.job / 1000} seconds to process, and the web servers stall. A queue does that work later.`,
  },
};

/**
 * The finished design, drawn for the intro and again for the wrap-up: each region's shoppers look up GeoDNS, get
 * files from the CDN and pages from their own data center; the data centers copy data both ways.
 * @param {Record<string, Function>} f the drawing helpers `drawFigures` is given
 * @param {SVGSVGElement} svg
 */
function drawBuilt(f, svg) {
  const { figNode, figArrow, figSvg, figLabel, figDash } = f;
  figSvg(svg, 350);
  figNode(svg, 'dns', 160, 46, 'GeoDNS', 'Nearest data center');
  figNode(svg, 'cdn', 480, 46, 'CDN', 'Files near shoppers');
  figNode(svg, 'users', 160, 166, 'Europe', `${europe} of shoppers`);
  figNode(svg, 'users', 480, 166, 'America', `${america} of shoppers`);
  figNode(svg, 'dc', 160, 306, 'Frankfurt DC', 'Serves Europe');
  figNode(svg, 'dc', 480, 306, 'Virginia DC', 'Serves America');
  figArrow(svg, 120, 136, 120, 76, 'lookup', null, 108, 112, 'end');
  figArrow(svg, 520, 136, 520, 76, 'files', null, 532, 112);
  figArrow(svg, 210, 136, 430, 76, '', null, 0, 0);
  figArrow(svg, 430, 136, 210, 76, '', null, 0, 0);
  figArrow(svg, 160, 196, 160, 276, 'pages', null, 172, 242);
  figArrow(svg, 480, 196, 480, 276, 'pages', null, 492, 242);
  figDash(svg, 'M254 296 H386');
  figDash(svg, 'M386 316 H254');
  figLabel(svg, 320, 284, 'copies data');
}

/**
 * GeoDNS (left) and failover (right) share one layout: GeoDNS on top, a shopper in each region, a data center under
 * each. Each shopper asks for example.com (1), gets an answer (2) and sends pages there.
 * @param {Record<string, Function>} f the drawing helpers `drawFigures` is given
 * @param {SVGSVGElement} svg
 * @param {string} dnsSub GeoDNS's second line
 * @param {string} bostonGets the data center GeoDNS names to the shopper in Boston
 */
function drawLookups(f, svg, dnsSub, bostonGets) {
  const { figNode, figArrow, figSvg } = f;
  figSvg(svg, 350);
  figNode(svg, 'dns', 320, 46, 'GeoDNS', dnsSub);
  figNode(svg, 'users', 110, 166, 'Berlin', 'Shopper in Europe');
  figNode(svg, 'users', 530, 166, 'Boston', 'Shopper in America');
  figArrow(svg, 150, 136, 240, 76, 'example.com?', '1', 96, 104);
  figArrow(svg, 260, 76, 190, 136, 'Frankfurt', '2', 236, 132);
  figArrow(svg, 490, 136, 400, 76, 'example.com?', '1', 468, 104);
  figArrow(svg, 380, 76, 450, 136, bostonGets, '2', 350, 132);
  figArrow(svg, 110, 196, 110, 276, 'pages', null, 122, 242);
}

/** @type {Level} */
export default {
  id: 7,
  saveKey: 'sdl-level7-v1',
  saveVersion: 2, // 2: which missions were opened from the lesson (`opened`)
  targets,
  workload: filesWorkload(),

  components: {
    users: {
      ...regionUsers(),
      regions: null, // round trips depend on which data center each region reaches
      desc: 'Your shoppers: 70% in Europe and 30% in America. Each region is 40 ms from a data center of its own, and 120 ms from one across the ocean. Half of all requests are files, which come from the CDN.',
    },
    dns: {
      name: 'DNS', short: 'Domain → IP address',
      desc: 'Turns example.com into a data center\'s address. Costs $5/month in this game.',
      subOf: (n) => (n.routing === 'geo' ? 'GeoDNS' : 'Same answer for all'),
      choices: [
        {
          key: 'routing', label: 'Answers',
          options: [
            { id: 'rr', name: 'Same for everyone', sub: 'every data center\'s address', note: 'Every device gets the same answer: each data center\'s address. Each device picks one, so shoppers spread evenly over the data centers, wherever they are. Plain DNS does not check health, so it keeps handing out the address of a data center that is down.', log: 'DNS now gives every shopper the same answer.' },
            { id: 'geo', name: 'GeoDNS', sub: 'nearest healthy data center', note: 'Answers by where the shopper is: Europe gets Frankfurt\'s address, America gets Virginia\'s. It checks each data center\'s health, and sends everyone to the healthy one when the other is down.', log: 'DNS set to GeoDNS: each shopper gets the nearest healthy data center.' },
          ],
        },
      ],
    },
    cdn: cdn(),
    dc: {
      name: 'Data center', short: 'Your whole design',
      nameOf: (n) => `${place(n)} DC`,
      subOf: (n, size) => `${n.size} · ${fmt(size.cap)} pages/s`,
      desc: 'A whole data center running the design you built in Levels 2 to 6: load balancers, autoscaled web servers, caches, databases and a session store. A page takes about 50 ms inside it. Its size is how many pages a second its databases and network take at peak; above that, pages fail.',
      sizeLabel: 'Size (pages/s at peak)',
      choices: [
        {
          key: 'region', label: 'Location',
          options: [
            { id: 'near', name: 'Frankfurt', sub: 'Europe', note: 'In Frankfurt: 40 ms from shoppers in Europe, 120 ms from shoppers in America.', log: 'Data center placed in Frankfurt.' },
            { id: 'far', name: 'Virginia', sub: 'America', note: 'In Virginia: 40 ms from shoppers in America, 120 ms from shoppers in Europe.', log: 'Data center placed in Virginia.' },
          ],
        },
      ],
    },
  },
  palette: ['dns', 'cdn', 'dc'],
  limits: { dns: 1, cdn: 1, dc: 2 },
  limitMsg: {
    dns: ONE_DNS,
    cdn: ONE_CDN,
    dc: 'Two data centers is the limit here: one for each region.',
  },
  // Level 6's design, now one data center in Frankfurt, sized to carry every page; and Level 5's CDN.
  startNodes: [
    { id: 'u', type: 'users', x: 380, y: 60 },
    { id: 'd', type: 'dns', x: 120, y: 60, routing: 'rr' },
    { id: 'k', type: 'cdn', x: 640, y: 60, ttl: '86400', onChange: 'version', fallback: 'origin' },
    { id: 'f', type: 'dc', x: 250, y: 250, size: 'L', region: 'near' },
  ],
  startEdges: [
    { id: 's1', from: 'u', to: 'd' }, { id: 's2', from: 'u', to: 'f' }, { id: 's3', from: 'u', to: 'k' }, { id: 's4', from: 'k', to: 'f' },
  ],
  slots: { dns: { x: 120, y: 60 }, cdn: { x: 640, y: 60 }, dc: [{ x: 510, y: 250 }, { x: 250, y: 250 }] },

  connections: {
    ok: {
      'dns|users': dnsLookup(),
      'cdn|users': usersToCdn(),
      'dc|users': { from: 'users', to: 'dc', label: 'pages', desc: 'Shoppers send page requests to the data center DNS gave them the address of. Each data center has its own public IP.' },
      'cdn|dc': { from: 'cdn', to: 'dc', label: 'misses', desc: 'The CDN\'s origin. When an edge does not have a file, it fetches it from this data center.' },
      'dc|dc': { from: 'dc', to: 'dc', label: 'replicates', desc: 'Copies this data center\'s data (accounts, carts and orders) to the other one, asynchronously: each change is sent after it is saved, so the copy runs about a second behind. Connect both ways so either one can take over.' },
    },
    bad: {
      'dc|dns': 'DNS answers name lookups off the request path. Connect Users to DNS, and Users to each data center.',
      'cdn|dns': CDN_DNS_BAD,
      'cdn|cdn': ONE_CDN,
    },
  },

  missions: [
    {
      title: 'Pages for America', ref: 'GeoDNS', ...LOAD, budget: BUDGET,
      story: 'Files reach America from the CDN in 42 ms, but every page still crosses the ocean: 120 ms there and back, plus 50 ms inside Frankfurt. Open a second data center in Virginia and send shoppers in America to it. Frankfurt then serves only Europe, so it can be smaller: keep the bill at $3,100.',
      goals: [farPageGoal, servedGoal(targets), latGoal(targets), costGoal(BUDGET)],
      hint: 'Add a data center, set its location to Virginia, and connect Users to it. Select DNS and switch it to GeoDNS. Frankfurt now carries only Europe\'s 1,400 pages a second, so size M is enough.',
      takeaway: 'Each shopper now reaches the nearest data center: 90 ms for a page in America instead of 170. Each data center is sized for its own region. Mission 2 asks what happens when one of them goes dark.',
    },
    {
      title: 'Virginia goes dark', ref: 'Failover', ...LOAD, budget: FAILOVER_BUDGET,
      gate: {
        hidesTraffic: false,
        lo: 1950, hi: 2050,
        prompt: '<b>Estimate before you build.</b> At the evening peak, shoppers open 2,000 pages a second: 70% in Europe and 30% in America. Files come from the CDN. If Virginia goes offline, how many pages a second must Frankfurt carry?',
        label: 'Pages per second',
        placeholder: 'e.g. 1,000',
        acceptedHtml: '<p><b>Estimate accepted.</b></p><div class="calc">Europe: 70% × 2,000 = 1,400 pages/s<br>America: 30% × 2,000 = 600 pages/s<br>Frankfurt alone: 1,400 + 600 = 2,000 pages/s</div>',
        acceptedLog: 'Estimate accepted: Frankfurt must carry all 2,000 pages a second. Play is unlocked.',
        notNumber: 'Type the estimate as pages per second, for example 1,000.',
        hints: [
          { test: (v) => v >= 1350 && v <= 1450, text: 'That is Europe alone. Shoppers in America move to Frankfurt too.' },
          { test: (v) => v >= 550 && v <= 650, text: 'That is America alone. Frankfurt keeps serving Europe as well.' },
          { test: (v) => v >= 3900 && v <= 4100, text: 'That counts files too. Files come from the CDN, not the data center.' },
        ],
        fallback: 'Not quite. Add Europe\'s share of the 2,000 pages a second to America\'s.',
      },
      story: 'A power failure takes the Virginia data center offline at the evening peak. American shoppers must keep shopping from Frankfurt. That only works if DNS stops sending them to Virginia, Frankfurt is big enough for everyone, and it already has their accounts, carts and orders.',
      goals: [
        servedGoal(targets), latGoal(targets), spofGoal(), costGoal(FAILOVER_BUDGET),
        { id: 'dc-offline', type: 'exp', text: 'Break it: take Virginia offline and still serve at least 99%' },
      ],
      hint: 'Use GeoDNS, so it stops handing out Virginia\'s address. Make Frankfurt big enough for both regions. Then connect Virginia to Frankfurt, so Virginia\'s data is copied there.',
      takeaway: 'Shoppers in America barely noticed: pages took 170 ms instead of 90, and their data was in Frankfurt, apart from the last second of changes that had not crossed the ocean yet. That gap is the price of asynchronous replication. Keep DNS answers short-lived too, so devices pick up the new address quickly. If Frankfurt failed instead, Virginia could not cover: Europe\'s data is not copied there, and an S data center is far too small for 2,000 pages a second. Real setups copy data both ways and size every data center for the full load, or keep a third.',
    },
  ],

  // Break-it experiments. A crash takes down the component `target` picks when it starts;
  // `expect` is the outcome that must hold for the whole run before it counts.
  experiments: [
    {
      id: 'dc-offline', kind: 'crash', target: (g) => g.onPath('dc').find((n) => n.region === 'far') || null,
      label: 'Take Virginia offline', labelOn: 'Bring Virginia back',
      needsDesign: 'Build the design first: add a data center in Virginia, then take it offline.',
      on: 'The Virginia data center is offline.', onTone: 'bad',
      off: 'Virginia is back online.',
      expect: (m) => served99(m) && m.noDataPct < NO_DATA_MAX,
      notMet: (m) => {
        if (m.g.dns && m.g.dns.routing !== 'geo') return `Only ${m.servedPct.toFixed(1)}% served: plain DNS still hands out Virginia's address, and requests sent there fail. Switch DNS to GeoDNS: it checks each data center's health.`;
        if (m.noDataPct >= NO_DATA_MAX) return `${fmtPct(m.noDataPct, PCT)} of requests reach Frankfurt for shoppers whose accounts, carts and orders are only in Virginia, so they fail. Connect Virginia to Frankfurt to copy its data there.`;
        return `Only ${m.servedPct.toFixed(1)}% served: Frankfurt now gets every page and is over capacity. Make it bigger.`;
      },
      observed: (m) => `Observed: Virginia offline, ${m.servedPct.toFixed(1)}% served. Shoppers in America got pages from Frankfurt in ${fmt(m.farPageMs || 0)} ms. Their data was there, except the last second of changes: about ${fmt(Math.round(m.lagWrites / 10) * 10)} writes had not arrived yet.`,
    },
  ],

  // Messages the engine shows for this level's design.
  text: {
    ...lbText(),
    ...replicaText(),
    noWeb: 'Users have no way in. Connect Users to a data center.',
    noDns: 'Browsers cannot find example.com. Connect Users to DNS.',
    noOrigin: 'The CDN has no origin: on a miss it has nowhere to fetch a file from, so it never holds any. Connect the CDN to a data center.',
    dnsAnswered: 'DNS answered with a data center\'s address. The device caches it until the answer expires.',
    ipTag: 'Address cached',
    levelComplete: levelComplete(7),
  },

  quiz: {
    passScore: 8,
    passText: passText(7, 'Message queue, workers and monitoring'),
    failText,
    questions: [
      { q: 'What does GeoDNS do?', o: ['Caches pages in cities near users', 'Answers by where the user is', 'Copies data between data centers', 'Balances load across web servers'], a: 1, e: 'GeoDNS returns a different address depending on the user\'s location, usually the nearest data center. Copying data is replication; caching near users is a CDN.', r: 'How does a shopper reach the nearest data center?' },
      { q: 'With GeoDNS, Virginia goes offline. Where does its traffic go?', o: ['Nowhere until Virginia is back online', 'To the CDN, which serves the pages itself', 'To Frankfurt, the healthy data center', 'To a standby DNS server'], a: 2, e: 'GeoDNS checks each data center\'s health and sends everyone to the healthy one. Users far from it get slower pages, but they keep working.', r: 'What must be true for a failover to work?' },
      { q: 'Why replicate data between data centers?', o: ['A user who fails over must find their data', 'So GeoDNS knows where each user is', 'So the CDN can pull files from both of them', 'So each data center can use a smaller database'], a: 0, e: 'After a failover, users land in a data center that did not serve them before. Their accounts, carts and orders must already be there.', r: 'What must be true for a failover to work?' },
      { q: 'Data centers replicate asynchronously. What is the risk on failover?', o: ['Every write waits for an ocean round trip first', 'The newest writes may not have arrived', 'GeoDNS stops answering', 'The CDN serves stale files'], a: 1, e: 'Asynchronous replication sends each change after it is saved, so the copy runs a little behind. Changes from the last moments before an outage may be missing on the other side.', r: 'Why can the newest changes be missing?' },
      { q: 'What does synchronous replication between data centers cost?', o: ['Every write waits for the far side to confirm', 'Reads must always go to the data center far away', 'The CDN must be turned off during writes', 'Each data center needs its own domain name'], a: 0, e: 'With synchronous replication, a write is done only when the other data center has it too, so every write adds a round trip across the ocean. That is why asynchronous replication is common between data centers.', r: 'Why can the newest changes be missing?' },
      { q: 'Virginia is offline, but some phones still send requests there for a while. Why?', o: ['Phones cannot read GeoDNS answers', 'The load balancer in Frankfurt sends them back there', 'GeoDNS needs a day to update its records', 'They cached the old DNS answer until it expired'], a: 3, e: 'Devices cache DNS answers for their TTL. Until it runs out, they keep using the old address, so failover by DNS takes as long as that TTL. Keep it short.', r: 'What must be true for a failover to work?' },
      { q: 'Why use automated deployment with several data centers?', o: ['It keeps every data center on the same version', 'It moves users to the nearest data center', 'It makes replication synchronous for each release', 'It removes the need for a CDN'], a: 0, e: 'Deploying by hand to several places invites drift: one data center runs different code from another. Automated deployment keeps them the same, and testing from different locations catches regional problems.', r: 'How to keep two data centers the same' },
      { q: 'Two data centers split 5,000 req/s at peak, 60% and 40%. The 60% one goes offline. What must the other carry?', o: ['2,000 req/s', '3,000 req/s', '5,000 req/s', '10,000 req/s'], a: 2, e: 'All the traffic moves to the survivor: 3,000 + 2,000 = 5,000 req/s. Size each data center for that, or failover overloads it.', r: 'How big must the surviving data center be?' },
      { q: 'Shoppers in Europe and America use one data center in Europe. What does a second one in America mainly improve for Americans?', o: ['Their cart size limit', 'The CDN\'s hit rate for their files', 'The number of products the catalog can hold for them', 'Their page load times, by a shorter round trip'], a: 3, e: 'Pages built for each shopper cannot come from a CDN, so they make the trip to a data center. A nearby one cuts that round trip from 120 ms to 40 ms in this game.', r: 'Why are pages still slow in America?' },
      { q: 'Each data center is sized only for its own region. What breaks?', o: ['GeoDNS cannot tell the regions apart', 'Failover: the survivor can\'t carry both regions', 'Replication between the two data centers stops at peak', 'The CDN must serve every page'], a: 1, e: 'When one data center goes down, the other gets all the traffic. If it was sized for its own region alone, it overloads exactly when you need it.', r: 'How big must the surviving data center be?' },
    ],
  },

  lesson,

  // Lesson diagrams. `f` provides the engine's drawing helpers. Each figure sets its own viewBox.
  drawFigures(f) {
    const { $, svgEl, figNode, figArrow, figLabel, figDash } = f;
    const f1 = $('figGeo');
    drawLookups(f, f1, 'Answers by location', 'Virginia');
    figArrow(f1, 530, 196, 530, 276, 'pages', null, 542, 242);
    figNode(f1, 'dc', 110, 306, 'Frankfurt DC', 'Serves Europe');
    figNode(f1, 'dc', 530, 306, 'Virginia DC', 'Serves America');

    // Failover: Virginia is down, so GeoDNS names Frankfurt to Boston too; Virginia's last second never arrived.
    const f2 = $('figFailover');
    drawLookups(f, f2, 'Virginia is down', 'Frankfurt');
    figNode(f2, 'dc', 110, 306, 'Frankfurt DC', 'Takes both regions');
    figNode(svgEl('g', { class: 'fig-down' }, f2), 'dc', 530, 306, 'Virginia DC', 'Offline');
    figArrow(f2, 450, 196, 204, 290, 'pages', null, 300, 238, 'middle');
    figDash(f2, 'M436 320 H300');
    figLabel(f2, 368, 342, 'last second not copied');

    drawBuilt(f, $('figBuilt'));
    drawBuilt(f, $('figBuiltEnd'));
  },
};
