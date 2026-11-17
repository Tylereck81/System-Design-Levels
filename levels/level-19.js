// @ts-check
/** @import { Level, Goal, Lesson } from '../js/types.js' */
// Level 19: Search autocomplete.
// Everything specific to this level lives here: components, rules, missions, quiz and text.
import { fmt, count, percent, ms } from '../js/format.js';
import { servedGoal, latGoal, costGoal, servedAtLeast, fmtPct } from './shared/goals.js';
import { BROWSER_HIT, API_CAP, SHARD_CAP, LOOKUP_MS, LETTER_TOP } from '../js/engine/typeahead.js';
import { lbText, levelComplete } from './shared/text.js';
import { failText, passText } from './shared/quiz.js';
import { panel } from './shared/figures.js';
import { COMPONENTS } from '../js/engine/catalog.js';
import { STEPS } from './mock-steps.js';

const targets = { latencyMs: 100, servedPct: 99 };
const QPS = 55600; // keystroke requests a second at the peak
const RUSH = 1.15; // a big match on TV
const PEAK = 1.6; // election night
const BUDGET = { under: 2400, uneven: 2400, trend: 2700 };
const TOP_K = 5; // suggestions shown for each prefix
const DAY_S = 86400;

const served99 = servedAtLeast(targets.servedPct);
const answeredGoal = servedGoal(targets, { text: `Answer ${targets.servedPct}% of keystrokes` });
const suggestGoal = latGoal(targets, { text: `Suggestions in under ${targets.latencyMs} ms` });
const ok = (m) => served99(m) && m.latency != null && m.latency < targets.latencyMs;
const fresh = (m) => !!m.typeahead && m.typeahead.staleH <= 1;
/** @type {Goal} */
const freshGoal = { id: 'fresh', type: 'metric', text: 'A new trending search shows up within an hour', test: fresh, val: (m) => (m.typeahead ? `${m.typeahead.staleH} h` : '—') };
const ON = (key, label, options) => ({ key, label, options });

// ---------- The lesson ----------
const [scope, sketch, deep, stress] = STEPS.map((step) => `<b>${step.name}</b>`);
const tapi = COMPONENTS.tapi;
const trie = COMPONENTS.trie;

// Scope example (ours): 8 million users, 6 searches a day, 20 characters each (the mission uses 12 million, 8, 25).
// 8,000,000 × 6 × 20 = 960,000,000 requests a day; ÷ 86,400 s = 11,111 a second; × 2 = 22,222 at the peak.
const sc = { users: 8e6, searches: 6, chars: 20 };
sc.day = sc.users * sc.searches * sc.chars;
sc.avg = Math.round(sc.day / DAY_S);
sc.peak = sc.avg * 2;

// The shard picture (ours): 60,000 lookups a second over three shards. Equal letter ranges give the busiest
// LETTER_TOP[3] = 45% (27,000, over a shard's 25,000); the other two shares (33% and 22%) are for the picture only.
// A shard map gives each a third (20,000).
const shardPic = { lookups: 60000, letterShares: [1 - LETTER_TOP[3] - 0.22, 0.22, LETTER_TOP[3]] };

/** @type {Lesson} */
const lesson = {
  intro: {
    kicker: 'Level 19 · Part 3: Design real systems',
    title: 'Search autocomplete',
    story: `As people type in a search box, the ${TOP_K} most popular searches starting with those letters appear below it. Every keystroke is a request, and the answer must arrive in under ${ms(targets.latencyMs)}, before the next key is pressed.`,
    picture: 'figBuilt',
    alt: 'The finished design: each keystroke goes from the browser, which keeps its own cache, through API servers and a filter to a trie held in memory and split into shards. Separately, sampled search logs are aggregated and the trie is rebuilt on a schedule.',
    outcomes: [
      'estimate requests from keystrokes',
      `explain how a trie with stored top ${TOP_K} answers in one lookup`,
      'cut requests with browser caching',
      'split the trie by measured load',
      'choose how often to rebuild suggestions',
    ],
  },
  last: 'Level 18 pushed messages the moment they arrived. Now the deadline is tighter still: the answer must arrive while the user is still typing.',
  parts: [
    {
      title: 'Under 100 ms',
      mission: 0,
      minutes: 10,
      lead: 'A query over a whole table for every keystroke is far too slow. The answer must already be waiting.',
      newParts: [
        { type: 'tapi', before: 1, what: 'Servers that answer each keystroke.', does: 'Take the letters typed so far and return the top suggestions from the trie cache.', game: `$${tapi.cost} a month each. Handle ${fmt(tapi.cap)} requests/s.` },
        { type: 'trie', before: 1, what: 'A tree of letters held in memory, rebuilt from past searches.', does: 'For any start of a word, returns the most popular searches that begin with it.', game: `$${trie.cost} a month for each shard. ${fmt(trie.cap)} lookups/s each.` },
      ],
      sections: [
        {
          title: 'Scope it: how many requests does typing make?',
          hook: `Ask: match only the start of the query? How many suggestions? Ranked how? Say: start only, top ${TOP_K}, by how often they were searched, ${count(sc.users)} users who search ${sc.searches} times a day and type ${sc.chars} characters each time.`,
          body: [
            {
              calc: {
                formula: `Requests = users × searches each × characters each, ÷ ${fmt(DAY_S)}, × 2 for the peak.`,
                rows: [
                  { label: 'A day', work: `${count(sc.users)} × ${sc.searches} searches × ${sc.chars} characters`, result: `${count(sc.day)} requests` },
                  { label: 'Average', work: `${count(sc.day)} requests ÷ ${fmt(DAY_S)} s`, result: `${fmt(sc.avg)} req/s`, approx: true },
                  { label: 'Peak', work: `${fmt(sc.avg)} req/s × 2`, result: `${fmt(sc.peak)} req/s` },
                ],
                result: `About ${fmt(sc.peak)} requests a second at peak: every character typed is a request.`,
              },
            },
          ],
          takeaway: 'Each keystroke is a request, so multiply searches by characters.',
          quiz: [9],
        },
        {
          title: 'How can suggestions be ready in one lookup?',
          hook: 'Store searches in a <b>trie</b>: a tree where each step down adds one letter, so every node stands for the start of a word.',
          body: [
            {
              figure: 'figTrie',
              alt: 'A small tree of letters: from c to ca and co, then to cat, car, cart, cod and cow. Each node keeps a list of its most popular searches with their counts. The node for "ca" is highlighted, and its list is the answer.',
              caption: 'Every node already holds its top searches',
            },
            { p: 'Without help, answering "ca" means visiting every search below that node and sorting them. A short prefix has a huge set below it, which is far too slow.' },
            { p: `So each node <b>stores its own top ${TOP_K}</b>, worked out in advance. Answering is one lookup: find the node, return its list. It costs memory, since every node holds a list, and it buys speed.` },
          ],
          takeaway: `Store the top ${TOP_K} at every node, trading memory for one-lookup answers.`,
          quiz: [0, 6],
        },
        {
          title: 'How to cut the requests that reach you',
          hook: 'Suggestions for "ca" barely change within an hour. So why ask again?',
          body: [
            { ul: [
              '<b>Browser caching.</b> The answer carries <code>Cache-Control: private, max-age=3600</code>: only this user\'s browser keeps it, for an hour. Repeated prefixes never leave the browser.',
              '<b>Requests in the background.</b> The page sends each request without reloading (AJAX), so typing is not interrupted.',
              '<b>Sampling.</b> Log only 1 search in N for building suggestions. The ranking stays about the same, at a fraction of the cost.',
            ] },
            { p: `In the game, browser caching saves about ${percent(BROWSER_HIT)} of keystrokes.` },
          ],
          takeaway: 'Let browsers cache suggestions and log only a sample of searches.',
          quiz: [2, 4],
        },
      ],
      checks: [
        {
          q: '5 million users search 10 times a day, typing 20 characters each time. About how many requests a second on average?',
          options: [
            { t: 'About 580', why: 'That counts searches, not keystrokes. Multiply by 20 characters.' },
            { t: 'About 11,600', right: true, why: '5 million × 10 × 20 = 1 billion a day, ÷ 86,400 ≈ 11,600.' },
            { t: 'About 1 billion', why: 'That is the daily total. Divide by the seconds in a day.' },
          ],
        },
      ],
      youWill: [
        'estimate requests a second (Play stays locked until you do)',
        `get suggestions out in under ${ms(targets.latencyMs)}`,
        'survive a big match on TV with the Break it button',
        `stay within $${fmt(BUDGET.under)} a month`,
      ],
      debrief: {
        saw: 'Each keystroke was one lookup in a trie node, and the browser answered repeated prefixes itself.',
        number: [percent(BROWSER_HIT), 'of keystrokes answered by the browser'],
        next: `Election night brings ${PEAK} times the traffic, and far more searches start with some letters than others.`,
      },
    },
    {
      title: 'Uneven letters',
      mission: 1,
      minutes: 6,
      lead: 'The trie no longer fits on one machine. How you split it decides whether it holds.',
      sections: [
        {
          title: 'Why is one shard busier when the letters are split evenly?',
          hook: 'Split the alphabet into equal ranges, a to i, j to r, s to z, and give each range a shard. Searches do not start evenly.',
          body: [
            {
              figure: 'figShards',
              alt: 'With equal letter ranges, three shards have very different loads and one is over its limit. With a shard map based on past traffic, the ranges are different sizes but each shard gets the same load.',
              caption: 'Equal letters, unequal load. Measured ranges, equal load',
            },
            { p: 'Far more searches start with c or s than with x or z, so one shard is swamped while another idles. Instead, a <b>shard map</b> sets the ranges from past traffic: s alone may get a shard, and u to z together another.' },
            { p: 'Stored as key-value pairs, each prefix is a key and its node\'s list the value, so a shard is simply a range of keys.' },
          ],
          takeaway: 'Split by measured load, not by how the keys look.',
          quiz: [3, 8],
        },
      ],
      checks: [
        {
          q: 'A trie is split by first letter into 26 shards. Which one is likely the busiest?',
          options: [
            { t: 'The x shard', why: 'Few searches start with x.' },
            { t: 'A shard for a common first letter, such as s', right: true, why: 'Common first letters carry far more searches, so equal letter ranges give unequal load.' },
          ],
        },
      ],
      youWill: [
        'add API servers for the peak',
        'split the trie with a shard map instead of equal letter ranges',
        `survive election night for at most $${fmt(BUDGET.uneven)} a month`,
      ],
      debrief: {
        saw: 'The shard map gave each shard an equal share of lookups, so three shards carried what equal ranges could not.',
        number: [`${PEAK}×`, 'the traffic on election night'],
        next: 'A storm is named and everyone searches for it. The trie will not know the name for days.',
      },
    },
    {
      title: 'What\'s trending',
      mission: 2,
      minutes: 6,
      lead: 'Suggestions are only as fresh as the last time the trie was built.',
      sections: [
        {
          title: 'Where do the suggestions come from?',
          hook: 'Not from each search as it happens. Updating the trie on every search, billions a day, would slow down every answer.',
          body: [
            { ol: [
              'Every search is written to a <b>log</b>: append-only, cheap.',
              'Aggregators count how often each search appeared in a period.',
              'Workers rebuild the trie from those counts, on a schedule.',
              'The new trie replaces the old one in the trie cache.',
            ] },
            { p: 'How often to rebuild depends on how fresh suggestions must be. Weekly suits most searches. A news-driven search box needs hours, or less.' },
          ],
          takeaway: 'The trie is rebuilt from counted logs, as often as freshness demands.',
          quiz: [1, 7],
        },
        {
          title: 'How to keep new searches and bad suggestions under control',
          hook: 'Two problems need fixing faster than the next rebuild.',
          body: [
            { p: '<b>Something new trends.</b> Rebuild more often from recent, sampled logs, so a new search appears within the hour. Real-time products go further and count searches as a stream.' },
            { p: '<b>Something offensive appears.</b> Put a <b>filter layer</b> between the API servers and the trie cache. It removes unwanted suggestions at once; they are then deleted from the data so the next build leaves them out.' },
          ],
          takeaway: 'Rebuild more often for trends, and filter bad suggestions before they are served.',
          quiz: [5],
        },
      ],
      checks: [
        {
          q: 'The trie is rebuilt once a week. A new search goes viral on Tuesday. When does it first appear as a suggestion?',
          options: [
            { t: 'Within seconds', why: 'Nothing updates the trie between builds.' },
            { t: 'After the next weekly rebuild', right: true, why: 'Suggestions are only as fresh as the last build, so rebuild more often if trends matter.' },
          ],
        },
      ],
      youWill: [
        'rebuild the trie often enough that a new trending search shows up within an hour',
        'press A new search trends to check',
        `stay within $${fmt(BUDGET.trend)} a month`,
      ],
    },
  ],
  wrap: {
    picture: 'figBuiltEnd',
    alt: 'The finished design: keystrokes go through API servers and a filter to a sharded trie in memory, and browsers cache answers. Sampled logs are aggregated and the trie is rebuilt on a schedule.',
    say: [
      '"Every keystroke is a request, so the answer must be one lookup in memory."',
      `"Each trie node stores its top ${TOP_K}, rebuilt from sampled logs on a schedule."`,
      '"I shard by a map from past traffic and let browsers cache suggestions for an hour."',
    ],
    numbers: [
      [`top ${TOP_K}`, 'searches stored at every node'],
      [percent(BROWSER_HIT), 'of keystrokes answered by the browser, in the game'],
    ],
    loop: `The interview steps: ${scope} (requests from keystrokes), ${sketch} (query path and rebuild path), ${deep} (top ${TOP_K} per node, shard map), ${stress} (a match, election night, a trend).`,
    broken: 'Level 20 moves from tiny answers to huge files: videos that must be uploaded, converted and streamed worldwide.',
  },
};

/**
 * The finished design, drawn for the intro and again for the wrap-up. On the left, the query path: browsers (with
 * their own cache), the load balancer, API servers, the filter and the sharded trie cache. On the right, the rebuild
 * path: sampled logs, aggregators and workers that load a new trie.
 * @param {Record<string, Function>} f the drawing helpers `drawFigures` is given
 * @param {SVGSVGElement} svg
 */
function drawBuilt(f, svg) {
  const { figNode, figArrow, figSvg } = f;
  figSvg(svg, 500);
  const path = [['users', 'Users', 'Browser caches'], ['lb', 'Load balancer', 'Spreads requests'], ['tapi', 'API servers', 'Answer keystrokes'], ['limiter', 'Filter layer', 'Drops bad ones'], ['trie', 'Trie cache', 'Shards by a map']];
  const labels = ['keystroke', '', `top ${TOP_K}?`, ''];
  path.forEach(([type, name, sub], i) => {
    const y = 50 + i * 100;
    figNode(svg, type, 140, y, name, sub);
    if (i < labels.length) figArrow(svg, 140, y + 30, 140, y + 70, labels[i], null, 152, y + 55);
  });
  figNode(svg, 'queue', 500, 250, 'Search logs', 'Sampled 1 in N');
  figArrow(svg, 234, 250, 406, 250, 'log search', null, 320, 242, 'middle');
  figNode(svg, 'worker', 500, 350, 'Aggregators', 'Count searches');
  figArrow(svg, 500, 280, 500, 320, '', null, 0, 0);
  figNode(svg, 'worker', 500, 450, 'Workers', 'Rebuild the trie');
  figArrow(svg, 500, 380, 500, 420, '', null, 0, 0);
  figArrow(svg, 406, 450, 234, 450, 'new trie', null, 320, 442, 'middle');
}

/**
 * A small trie: each node is a box with its letters, and each prefix node keeps its top searches with their counts.
 * The path to "ca" is drawn thick, and its node and list, the answer, sit on a shaded ground.
 * @param {Record<string, Function>} f the drawing helpers `drawFigures` is given
 * @param {SVGSVGElement} svg
 */
function drawTrie(f, svg) {
  const { svgEl, figLabel, figSvg } = f;
  figSvg(svg, 390);
  svgEl('rect', { x: 60, y: 176, width: 200, height: 72, rx: 10, class: 'ch-area' }, svg);
  svgEl('line', { x1: 320, y1: 50, x2: 320, y2: 86, class: 'd-arc' }, svg);
  svgEl('line', { x1: 290, y1: 146, x2: 180, y2: 184, class: 'd-arc' }, svg);
  // Edges leave a node below its list, so no line crosses the text.
  const edge = (x1, y1, x2, y2) => svgEl('line', { x1, y1, x2, y2, class: 'd-line' }, svg);
  edge(350, 146, 460, 184); edge(130, 248, 80, 294); edge(180, 248, 170, 294); edge(460, 244, 430, 294); edge(500, 244, 570, 294); edge(170, 326, 170, 344);
  const node = (x, y, text, list) => {
    svgEl('rect', { x: x - 36, y: y - 16, width: 72, height: 32, rx: 8, class: 'node-box' }, svg);
    figLabel(svg, x, y + 4, text);
    if (list) figLabel(svg, x, y + 34, list, 'middle', 'ch-t');
  };
  node(320, 34, 'root');
  node(320, 102, 'c', 'car 40 · cow 35 · cart 31');
  node(160, 200, 'ca', 'car 40 · cart 31 · cat 22');
  node(480, 200, 'co', 'cow 35 · cod 9');
  node(70, 310, 'cat 22');
  node(170, 310, 'car 40');
  node(170, 360, 'cart 31');
  node(430, 310, 'cod 9');
  node(570, 310, 'cow 35');
  figLabel(svg, 270, 206, 'answer for "ca"', 'start', 'tier-label');
}

/**
 * Two rows of bars: three shards' lookups a second with equal letter ranges (the busiest over a shard's limit),
 * then with a shard map from past traffic (all equal, under the limit).
 * @param {Record<string, Function>} f the drawing helpers `drawFigures` is given
 * @param {SVGSVGElement} svg
 */
function drawShards(f, svg) {
  const { svgEl, figLabel, figSvg } = f;
  figSvg(svg, 428);
  const third = 1 / 3;
  const rows = [
    { y: 10, label: 'Equal letter ranges', bars: ['a–i', 'j–r', 's–z'].map((name, i) => ({ name, share: shardPic.letterShares[i] })) },
    { y: 222, label: 'Shard map from past traffic', bars: ['a–l', 'm–s', 't–z'].map((name) => ({ name, share: third })) },
  ];
  const top = shardPic.lookups * LETTER_TOP[3];
  for (const { y, label, bars } of rows) {
    panel(f, svg, y, 196, label);
    const base = y + 170, Y = (load) => base - (load / top) * 120;
    bars.forEach(({ name, share }, i) => {
      const load = share * shardPic.lookups, x = 90 + i * 130, over = load > SHARD_CAP;
      svgEl('rect', { x, y: Y(load), width: 80, height: base - Y(load), class: over ? 'ch-cap' : 'ch-area' }, svg);
      figLabel(svg, x + 40, base + 18, name, 'middle', 'ch-t');
      if (over) figLabel(svg, x + 90, (Y(load) + base) / 2, 'over the limit', 'start', 'ch-cap-t');
    });
    svgEl('line', { x1: 56, y1: base, x2: 610, y2: base, class: 'ch-axis' }, svg);
    svgEl('line', { x1: 56, y1: Y(SHARD_CAP), x2: 610, y2: Y(SHARD_CAP), class: 'ch-axis d-dash' }, svg);
    figLabel(svg, 610, Y(SHARD_CAP) - 6, `${fmt(SHARD_CAP)} lookups/s limit`, 'end', 'ch-t');
  }
}

/** @type {Level} */
export default {
  id: 19,
  saveKey: 'sdl-level19-v1',
  saveVersion: 2, // 2: which missions were opened from the lesson (`opened`)
  targets,
  workload: { typeahead: true },

  // The mock interview's brief and self-check list for this problem (see mock.js).
  mock: {
    title: 'Search autocomplete',
    brief: 'Design search autocomplete: as someone types, show the 5 most popular searches that start with what they\'ve typed, within 100 ms. 12 million daily users, English only.',
    checklist: [
      'Estimated requests a second: every keystroke is one (about 27,800, 55,600 at the peak)',
      'Used a trie with the top 5 kept at every node',
      'Split a query path from a data-gathering path: logs, aggregation, rebuilds',
      'Let browsers cache suggestions',
      'Sharded the trie by measured traffic, not equal letter ranges',
      'Said how fresh suggestions must be, and filtered unwanted ones',
    ],
  },

  components: {
    users: {
      name: 'Users', sub: 'Type in a search box',
      desc: `People typing searches. Every keystroke asks for the top 5 suggestions for what they've typed so far: "w", "we", "wea"… ${fmt(QPS)} requests a second at the peak.`,
    },
    tapi: {
      name: 'API servers', short: 'Answer each keystroke',
      desc: `Take each keystroke request (sent with AJAX, so the page doesn't reload) and ask the trie cache for the top 5. ${fmt(API_CAP)} requests a second each, $200 a month.`,
      subOf: (n) => `${Number(n.count) || 4} servers${n.browser === 'on' ? ' · browser cache' : ''}`,
      choices: [
        ON('count', 'Servers', [2, 3, 4, 5, 6, 8].map((k) => ({ id: String(k), name: `${k} servers`, sub: `$${fmt(k * 200)} a month`, note: `${k} API servers: ${fmt(k * API_CAP)} requests a second in all.`, log: `API servers set to ${k}.` }))),
        ON('browser', 'Browser caching', [
          { id: 'off', name: 'No caching', sub: 'every keystroke asks', note: 'Every keystroke goes to the servers, even a prefix the browser asked a minute ago.', log: 'Browsers no longer cache suggestions.' },
          { id: 'on', name: 'Cache for an hour', sub: 'Cache-Control: private, max-age=3600', note: `Suggestions rarely change within an hour, so let the browser keep them: "private" (only this user's browser), max-age 3600 s. ${Math.round(100 * BROWSER_HIT)}% of keystrokes repeat a prefix the browser already has.`, log: 'Browsers now cache suggestions for an hour.' },
        ]),
      ],
    },
    trie: {
      name: 'Trie cache', short: 'Prefix → top 5',
      desc: `Holds the trie in memory, rebuilt from the search logs. ${fmt(SHARD_CAP)} lookups a second per shard, $300 a month each, plus the rebuild.`,
      subOf: (n) => `${{ table: 'table', trie: 'trie walk', topk: 'top 5' }[n.method] || 'table'} · ${Number(n.shards) || 3} shards · ${n.split === 'map' ? 'shard map' : 'by letter'}`,
      choices: [
        ON('method', 'Finding the top 5', [
          { id: 'table', name: 'Query the table', sub: 'LIKE "prefix%" ORDER BY frequency', note: `Search the frequency table for queries starting with the prefix, sort, take 5: about ${LOOKUP_MS.table} ms on a big table.`, log: 'The top 5 now come from a table query.' },
          { id: 'trie', name: 'Walk the trie', sub: 'find the node, then search below it', note: `Find the prefix's node in the trie, then visit everything under it and sort: about ${LOOKUP_MS.trie} ms for a short prefix with a huge subtree.`, log: 'The top 5 now come from walking the trie.' },
          { id: 'topk', name: 'Keep the top 5 at every node', sub: 'read them directly', note: `Store each node's top 5 in the node itself (and cap prefix length): finding them is O(1), about ${LOOKUP_MS.topk} ms. More memory, much less time.`, log: 'Each trie node now keeps its own top 5.' },
        ]),
        ON('shards', 'Shards', [1, 2, 3, 4].map((k) => ({ id: String(k), name: `${k} ${k === 1 ? 'shard' : 'shards'}`, sub: `$${fmt(k * 300)} a month`, note: `${k} trie cache ${k === 1 ? 'server' : 'servers'}, ${fmt(k * SHARD_CAP)} lookups a second in all, if evenly spread.`, log: `Trie cache set to ${k} ${k === 1 ? 'shard' : 'shards'}.` }))),
        ON('split', 'Splitting the keys', [
          { id: 'letter', name: 'By first letter', sub: 'a–i, j–r, s–z', note: `Equal letter ranges. But far more searches start with c or s than with x or z: with 3 shards, the busiest gets ${Math.round(100 * LETTER_TOP[3])}% of lookups.`, log: 'The trie is now split by letter ranges.' },
          { id: 'map', name: 'Shard map', sub: 'ranges sized by past traffic', note: 'A shard map manager sets each shard\'s range from past traffic (one shard for s alone, one for u to z), so each gets an equal share.', log: 'The trie is now split by a shard map.' },
        ]),
        ON('rebuild', 'Rebuild from the logs', [
          { id: 'weekly', name: 'Weekly', sub: '$100 a month', note: 'Aggregate a week of logs and rebuild the trie once a week. Fine for searches that change slowly.', log: 'The trie is now rebuilt weekly.' },
          { id: 'daily', name: 'Daily', sub: '$200 a month', note: 'Aggregate and rebuild every day.', log: 'The trie is now rebuilt daily.' },
          { id: 'hourly', name: 'Hourly', sub: '$500 a month', note: 'Aggregate the last hour (sampling 1 in N queries keeps it cheap) and rebuild every hour: trending searches show up fast.', log: 'The trie is now rebuilt hourly.' },
        ]),
      ],
    },
  },
  palette: ['tapi', 'trie'],
  limits: { tapi: 1, trie: 1 },
  limitMsg: {
    tapi: 'One API server box is enough: set its servers in the inspector.',
    trie: 'One trie cache box is enough: set its shards in the inspector.',
  },
  // Users → 4 API servers → a trie cache answered by table queries, 3 letter shards, rebuilt weekly.
  startNodes: [
    { id: 'u', type: 'users', x: 380, y: 70 },
    { id: 'a', type: 'tapi', x: 380, y: 230, count: '4', browser: 'off' },
    { id: 't', type: 'trie', x: 380, y: 390, method: 'table', shards: '3', split: 'letter', rebuild: 'weekly' },
  ],
  startEdges: [{ id: 's1', from: 'u', to: 'a' }, { id: 's2', from: 'a', to: 't' }],
  slots: { tapi: { x: 380, y: 230 }, trie: { x: 380, y: 390 } },

  connections: {
    ok: {
      'tapi|users': { from: 'users', to: 'tapi', label: 'keystrokes', desc: 'Each keystroke sends the prefix so far.' },
      'tapi|trie': { from: 'tapi', to: 'trie', label: 'top 5?', desc: 'The API server asks the trie cache for the prefix\'s top 5.' },
    },
    bad: { 'trie|users': 'Browsers call the API servers, which ask the trie cache.' },
  },

  missions: [
    {
      title: 'Under 100 ms', ref: 'Trie data structure', qps: QPS, budget: BUDGET.under,
      gate: {
        hidesTraffic: false,
        lo: 27000, hi: 28500,
        prompt: '<b>Estimate before you build.</b> 12 million people search 8 times a day, typing 25 characters each search, and every character sends a request. How many requests a second on average?',
        label: 'Requests a second',
        placeholder: 'e.g. 10000',
        acceptedHtml: '<p><b>Estimate accepted.</b></p><div class="calc">12,000,000 × 8 × 25 = 2.4 billion requests a day<br>2.4 billion ÷ 86,400 ≈ 27,800 a second<br>About 55,600 at a 2× peak</div>',
        acceptedLog: 'Estimate accepted: about 27,800 a second. Play is unlocked.',
        notNumber: 'Type the requests a second as a number, for example 10000.',
        hints: [
          { test: (v) => v >= 1100 && v <= 1150, text: 'That counts searches. Every character typed is a request: multiply by 25.' },
          { test: (v) => v >= 55000 && v <= 56000, text: 'That is the peak. The question is the average.' },
        ],
        fallback: 'Not quite. Users × searches × characters, divided by 86,400 seconds.',
      },
      story: `As people type, suggestions must appear in under 100 ms or the box stutters. Right now each keystroke runs a query over the whole frequency table. Get under 100 ms, and survive a big match on TV (${RUSH}× the traffic).`,
      goals: [
        { id: 'est', type: 'gate', text: 'Estimate requests a second' },
        answeredGoal, suggestGoal, costGoal(BUDGET.under),
        { id: 'rush', type: 'exp', text: `Break it: a big match on TV (${RUSH}×); still answered in time` },
      ],
      hint: `Keep each node's top 5 in the trie: one read. And let browsers cache suggestions for an hour: ${Math.round(100 * BROWSER_HIT)}% of keystrokes never reach you.`,
      takeaway: 'Storing the top 5 at every node trades memory for speed: no sorting at request time. Browser caching removed repeat prefixes before they reached the servers, so the same servers handled the rush.',
    },
    {
      title: 'Uneven letters', ref: 'Scale the storage', qps: QPS, budget: BUDGET.uneven,
      story: `Election night: ${PEAK}× the usual traffic. The trie is split into equal letter ranges, but searches don't start evenly: far more begin with c or s than with x or z. Keep every keystroke answered in time.`,
      goals: [
        answeredGoal, suggestGoal, costGoal(BUDGET.uneven),
        { id: 'peak', type: 'exp', text: `Break it: election night (${PEAK}×); still answered in time` },
      ],
      hint: `Add API servers for the peak, and split the trie by a shard map sized from past traffic instead of equal letter ranges: each shard then gets a third, not ${Math.round(100 * LETTER_TOP[3])}%.`,
      takeaway: 'The shard map gave each shard an equal share of lookups, so three shards carried what equal letter ranges couldn\'t. Split by measured load, not by how the keys look.',
    },
    {
      title: 'What\'s trending', ref: 'Data gathering', qps: QPS, budget: BUDGET.trend,
      story: 'A storm is named, and everyone starts searching for it. A weekly rebuild won\'t suggest it for days. New trending searches must show up within an hour.',
      goals: [
        freshGoal, answeredGoal, suggestGoal, costGoal(BUDGET.trend),
        { id: 'trend', type: 'exp', text: 'Break it: a new search trends; suggested within the hour' },
      ],
      hint: 'Rebuild the trie every hour from the latest logs. Sampling keeps the logs small.',
      takeaway: 'Rebuilding hourly from sampled logs put the new search into the trie within the hour. How fresh suggestions must be decides how often you aggregate: weekly for most searches, much faster for a real-time feed.',
    },
  ],

  // Break-it experiments. An event only checks its outcome; `factor` multiplies the traffic.
  experiments: [
    {
      id: 'rush', kind: 'event', factor: RUSH,
      label: 'A big match on TV', labelOn: 'Match over',
      needsDesign: 'Build the design first: API servers and the trie cache.',
      on: `A big match: ${RUSH}× the keystrokes.`, onTone: 'bad',
      off: 'The match is over.',
      expect: ok,
      notMet: (m) => `Only ${fmtPct(m.servedPct)} answered in ${m.latency == null ? '—' : fmt(m.latency)} ms. Keep the top 5 at each node, and let browsers cache suggestions.`,
      observed: (m) => `Observed: the match came, and ${fmtPct(m.servedPct)} of keystrokes were answered in ${fmt(m.latency)} ms.`,
    },
    {
      id: 'peak', kind: 'event', factor: PEAK,
      label: 'Election night', labelOn: 'Results are in',
      needsDesign: 'Build the design first: API servers and the trie cache.',
      on: `Election night: ${PEAK}× the keystrokes.`, onTone: 'bad',
      off: 'The results are in; traffic calms down.',
      expect: ok,
      notMet: (m) => (m.typeahead && m.typeahead.shardLoad > SHARD_CAP
        ? `Only ${fmtPct(m.servedPct)} answered: the busiest shard gets ${Math.round(100 * m.typeahead.topShare)}% of lookups, ${fmt(m.typeahead.shardLoad)} a second, more than its ${fmt(SHARD_CAP)}. Split the trie by a shard map.`
        : `Only ${fmtPct(m.servedPct)} answered: the API servers can't keep up. Add servers.`),
      observed: (m) => `Observed: election night came, and ${fmtPct(m.servedPct)} of keystrokes were answered.`,
    },
    {
      id: 'trend', kind: 'event',
      label: 'A new search trends', labelOn: 'It fades',
      needsDesign: 'Build the design first: API servers and the trie cache.',
      on: 'A new storm is named, and everyone searches for it.', onTone: 'bad',
      off: 'The trend fades.',
      expect: (m) => fresh(m) && ok(m),
      notMet: (m) => `The storm won't be suggested for up to ${m.typeahead.staleH} hours, until the next rebuild. Rebuild hourly.`,
      observed: () => 'Observed: the new search showed up in suggestions within the hour.',
    },
  ],

  // Messages the engine shows for this level's design.
  text: {
    ...lbText(),
    noWeb: 'Connect the users to the API servers.',
    levelComplete: levelComplete(19),
  },

  quiz: {
    passScore: 8,
    passText: passText(19, 'Video platform'),
    failText,
    questions: [
      { q: 'What does each trie node store to make suggestions fast?', o: ['The whole search log', 'The user\'s history', 'A full copy of its parent node', 'Its own top 5 queries'], a: 3, e: 'Keeping the top k at every node means a lookup only finds the prefix node and reads its list: O(1) with a capped prefix length.', r: 'How can suggestions be ready in one lookup?' },
      { q: 'Why not update the trie on every search?', o: ['Tries can\'t be updated', 'Billions of updates would slow the query service', 'Every update needs a brand new shard to be added first', 'It breaks browser caching'], a: 1, e: 'Updating a node also updates its ancestors\' top 5. Doing that for billions of searches a day would slow everything; rebuild from aggregated logs instead.', r: 'Where do the suggestions come from?' },
      { q: 'What does Cache-Control: private, max-age=3600 mean for suggestions?', o: ['Only the user\'s browser keeps them, for an hour', 'Shared caches keep them for a day', 'They are never cached', 'The server caches them for the next 3,600 users who ask'], a: 0, e: '"private": only that user\'s browser may store them, not a shared cache. "max-age=3600": valid for 3,600 seconds.', r: 'How to cut the requests that reach you' },
      { q: 'Why can splitting the trie by equal letter ranges overload a shard?', o: ['Letters are hashed unevenly', 'Shards can\'t hold 26 letters', 'Far more queries start with some letters than others', 'Browsers prefer letters early in the alphabet over later ones'], a: 2, e: 'More searches start with c or s than with x or z. A shard map sized from past traffic evens out the load.', r: 'Why is one shard busier when the letters are split evenly?' },
      { q: 'How do you keep logging every search from becoming too expensive?', o: ['Log nothing', 'Log only errors', 'Sample: log 1 in N queries', 'Log every query in the browser, then upload them all'], a: 2, e: 'At billions of searches a day, a sample keeps the popularity ranking close while cutting processing and storage.', r: 'How to cut the requests that reach you' },
      { q: 'How are offensive suggestions kept out?', o: ['By the browser', 'By rebuilding the whole trie every second from scratch', 'By sharding on the first letter', 'A filter layer in front of the trie cache'], a: 3, e: 'A filter layer drops unwanted suggestions at once; they are also removed from the data so the next rebuild leaves them out.', r: 'How to keep new searches and bad suggestions under control' },
      { q: 'A prefix is 2 characters. Why is walking the trie slow without the stored top 5?', o: ['Short prefixes have huge subtrees to visit and sort', 'Short prefixes aren\'t in the trie', 'The root is locked', 'Two-letter words are rare, so they are stored on disk'], a: 0, e: 'Finding the node is fast, but everything under a short prefix must be visited and sorted to get the top 5.', r: 'How can suggestions be ready in one lookup?' },
      { q: 'Where does the trie\'s data come from?', o: ['The users\' browsers', 'Aggregated search logs', 'The API servers\' memory', 'A dictionary'], a: 1, e: 'Analytics logs record searches; aggregators count them per period; workers build the trie and store it in the trie DB, and the trie cache loads it.', r: 'Where do the suggestions come from?' },
      { q: 'Which can store a trie in a key-value store?', o: ['Each prefix as a key, its node data as the value', 'One key per character', 'One key for the whole trie, rebuilt again on every query', 'It can\'t be done'], a: 0, e: 'Map every prefix to a key and the node\'s data (its top 5) to the value. A document store with a serialized weekly snapshot also works.', r: 'Why is one shard busier when the letters are split evenly?' },
      { q: '12 million users × 8 searches × 25 characters. About how many requests a second at a 2× peak?', o: ['27,800', '1,100', '556,000', '55,600'], a: 3, e: '12 × 10⁶ × 8 × 25 = 2.4 × 10⁹ a day ÷ 86,400 ≈ 27,800 a second; × 2 ≈ 55,600.', r: 'Scope it: how many requests does typing make?' },
    ],
  },

  lesson,

  // Lesson diagrams. `f` provides the engine's drawing helpers. Each figure sets its own viewBox.
  drawFigures(f) {
    const { $ } = f;
    drawTrie(f, $('figTrie'));
    drawShards(f, $('figShards'));
    drawBuilt(f, $('figBuilt'));
    drawBuilt(f, $('figBuiltEnd'));
  },
};
