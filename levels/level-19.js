// Level 19: Search autocomplete.
// Everything specific to this level lives here: components, rules, missions, quiz and text.
import { fmt } from '../js/format.js';
import { BROWSER_HIT, API_CAP, SHARD_CAP, LOOKUP_MS, LETTER_TOP } from '../js/engine/typeahead.js';
import level2 from './level-02.js';
import level10 from './level-10.js';

const targets = { latencyMs: 100, servedPct: 99 };
const QPS = 55600; // keystroke requests a second at the peak
const RUSH = 1.15; // a big match on TV
const PEAK = 1.6; // election night

const pct = (x) => x.toFixed(1) + '%';
const costGoal = (max) => ({ id: 'cost', type: 'struct', text: `Spend at most $${fmt(max)} per month`, test: (g) => g.cost <= max, val: (m, g) => '$' + fmt(g.cost) });
const served99 = (m) => m.servedPct >= targets.servedPct;
const servedGoal = { id: 'served', type: 'metric', text: `Answer ${targets.servedPct}% of keystrokes`, test: served99, val: (m) => pct(m.servedPct) };
const latGoal = { id: 'lat', type: 'metric', text: `Suggestions in under ${targets.latencyMs} ms`, test: (m) => m.latency != null && m.latency < targets.latencyMs, val: (m) => (m.latency == null ? '—' : fmt(m.latency) + ' ms') };
const ok = (m) => served99(m) && m.latency != null && m.latency < targets.latencyMs;
const fresh = (m) => !!m.typeahead && m.typeahead.staleH <= 1;
const freshGoal = { id: 'fresh', type: 'metric', text: 'A new trending search shows up within an hour', test: fresh, val: (m) => (m.typeahead ? `${m.typeahead.staleH} h` : '—') };
const ON = (key, label, options) => ({ key, label, options });

export default {
  id: 19,
  saveKey: 'sdl-level19-v1',
  saveVersion: 1,
  targets,
  workload: { typeahead: true },

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
      title: 'Under 100 ms', ref: 'Trie data structure', qps: QPS, budget: 2400,
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
        servedGoal, latGoal, costGoal(2400),
        { id: 'rush', type: 'exp', text: `Break it: a big match on TV (${RUSH}×); still answered in time` },
      ],
      hint: `Keep each node's top 5 in the trie: one read. And let browsers cache suggestions for an hour: ${Math.round(100 * BROWSER_HIT)}% of keystrokes never reach you.`,
      takeaway: 'Storing the top 5 at every node trades memory for speed: no sorting at request time. Browser caching removed repeat prefixes before they reached the servers, so the same servers handled the rush.',
    },
    {
      title: 'Uneven letters', ref: 'Scale the storage', qps: QPS, budget: 2400,
      story: `Election night: ${PEAK}× the usual traffic. The trie is split into equal letter ranges, but searches don't start evenly: far more begin with c or s than with x or z. Keep every keystroke answered in time.`,
      goals: [
        servedGoal, latGoal, costGoal(2400),
        { id: 'peak', type: 'exp', text: `Break it: election night (${PEAK}×); still answered in time` },
      ],
      hint: `Add API servers for the peak, and split the trie by a shard map sized from past traffic instead of equal letter ranges: each shard then gets a third, not ${Math.round(100 * LETTER_TOP[3])}%.`,
      takeaway: 'The shard map gave each shard an equal share of lookups, so three shards carried what equal letter ranges couldn\'t. Split by measured load, not by how the keys look.',
    },
    {
      title: 'What\'s trending', ref: 'Data gathering', qps: QPS, budget: 2700,
      story: 'A storm is named, and everyone starts searching for it. A weekly rebuild won\'t suggest it for days. New trending searches must show up within an hour.',
      goals: [
        freshGoal, servedGoal, latGoal, costGoal(2700),
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
      notMet: (m) => `Only ${pct(m.servedPct)} answered in ${m.latency == null ? '—' : fmt(m.latency)} ms. Keep the top 5 at each node, and let browsers cache suggestions.`,
      observed: (m) => `Observed: the match came, and ${pct(m.servedPct)} of keystrokes were answered in ${fmt(m.latency)} ms.`,
    },
    {
      id: 'peak', kind: 'event', factor: PEAK,
      label: 'Election night', labelOn: 'Results are in',
      needsDesign: 'Build the design first: API servers and the trie cache.',
      on: `Election night: ${PEAK}× the keystrokes.`, onTone: 'bad',
      off: 'The results are in; traffic calms down.',
      expect: ok,
      notMet: (m) => (m.typeahead && m.typeahead.shardLoad > SHARD_CAP
        ? `Only ${pct(m.servedPct)} answered: the busiest shard gets ${Math.round(100 * m.typeahead.topShare)}% of lookups, ${fmt(m.typeahead.shardLoad)} a second, more than its ${fmt(SHARD_CAP)}. Split the trie by a shard map.`
        : `Only ${pct(m.servedPct)} answered: the API servers can't keep up. Add servers.`),
      observed: (m) => `Observed: election night came, and ${pct(m.servedPct)} of keystrokes were answered.`,
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
    ...level2.text,
    noWeb: 'Connect the users to the API servers.',
    levelComplete: 'Level 19 complete. Take the quiz.',
  },

  quiz: {
    passScore: 8,
    passText: 'Level 19 is done. Level 20, Video platform, is next: open it from the level menu at the top.',
    failText: level10.quiz.failText,
    questions: [
      { q: 'What does each trie node store to make suggestions fast?', o: ['The whole search log', 'The user\'s history', 'A full copy of its parent node', 'Its own top 5 queries'], a: 3, e: 'Keeping the top k at every node means a lookup only finds the prefix node and reads its list: O(1) with a capped prefix length.', r: 'Trie data structure' },
      { q: 'Why not update the trie on every search?', o: ['Tries can\'t be updated', 'Billions of updates would slow the query service', 'Every update needs a brand new shard to be added first', 'It breaks browser caching'], a: 1, e: 'Updating a node also updates its ancestors\' top 5. Doing that for billions of searches a day would slow everything; rebuild from aggregated logs instead.', r: 'Data gathering service' },
      { q: 'What does Cache-Control: private, max-age=3600 mean for suggestions?', o: ['Only the user\'s browser keeps them, for an hour', 'Shared caches keep them for a day', 'They are never cached', 'The server caches them for the next 3,600 users who ask'], a: 0, e: '"private": only that user\'s browser may store them, not a shared cache. "max-age=3600": valid for 3,600 seconds.', r: 'Query service' },
      { q: 'Why can splitting the trie by equal letter ranges overload a shard?', o: ['Letters are hashed unevenly', 'Shards can\'t hold 26 letters', 'Far more queries start with some letters than others', 'Browsers prefer letters early in the alphabet over later ones'], a: 2, e: 'More searches start with c or s than with x or z. A shard map sized from past traffic evens out the load.', r: 'Scale the storage' },
      { q: 'How do you keep logging every search from becoming too expensive?', o: ['Log nothing', 'Log only errors', 'Sample: log 1 in N queries', 'Log every query in the browser, then upload them all'], a: 2, e: 'At billions of searches a day, a sample keeps the popularity ranking close while cutting processing and storage.', r: 'Query service' },
      { q: 'How are offensive suggestions kept out?', o: ['By the browser', 'By rebuilding the whole trie every second from scratch', 'By sharding on the first letter', 'A filter layer in front of the trie cache'], a: 3, e: 'A filter layer drops unwanted suggestions at once; they are also removed from the data so the next rebuild leaves them out.', r: 'Trie operations' },
      { q: 'A prefix is 2 characters. Why is walking the trie slow without the stored top 5?', o: ['Short prefixes have huge subtrees to visit and sort', 'Short prefixes aren\'t in the trie', 'The root is locked', 'Two-letter words are rare, so they are stored on disk'], a: 0, e: 'Finding the node is fast, but everything under a short prefix must be visited and sorted to get the top 5.', r: 'Trie data structure' },
      { q: 'Where does the trie\'s data come from?', o: ['The users\' browsers', 'Aggregated search logs', 'The API servers\' memory', 'A dictionary'], a: 1, e: 'Analytics logs record searches; aggregators count them per period; workers build the trie and store it in the trie DB, and the trie cache loads it.', r: 'Data gathering service' },
      { q: 'Which can store a trie in a key-value store?', o: ['Each prefix as a key, its node data as the value', 'One key per character', 'One key for the whole trie, rebuilt again on every query', 'It can\'t be done'], a: 0, e: 'Map every prefix to a key and the node\'s data (its top 5) to the value. A document store with a serialized weekly snapshot also works.', r: 'Trie DB' },
      { q: '12 million users × 8 searches × 25 characters. About how many requests a second at a 2× peak?', o: ['27,800', '1,100', '556,000', '55,600'], a: 3, e: '12 × 10⁶ × 8 × 25 = 2.4 × 10⁹ a day ÷ 86,400 ≈ 27,800 a second; × 2 ≈ 55,600.', r: 'Back of the envelope' },
    ],
  },

  // Lesson tab content (HTML). The diagram below draws into figTrie.
  lessonHtml: `
    <p class="label">Level 19 · Search autocomplete</p>
    <h1>Search autocomplete</h1>
    <p class="lede">As someone types "weather" into a search box, suggestions appear under it after every letter. Every keystroke is a request, and each answer must arrive in under 100 ms. In this level you build the trie that answers them, spread it over servers, and keep it fresh.</p>
    <div class="goals-box">
      <div><b>You will learn</b>The trie with stored top 5, the query and data-gathering paths, browser caching, sharding by load.</div>
      <div><b>You will decide</b>How the top 5 are found, browser caching, shards and how they split, and how often to rebuild.</div>
      <div><b>You will estimate</b>Requests a second.</div>
    </div>

    <section>
      <h2>Scope it</h2>
      <p class="src">Requirements</p>
      <p>Ask: match only at the start of a query (yes); how many suggestions (5); ranked by what (how often each query was searched); spell check (no); language (English, lowercase). Then: fast (under 100 ms), relevant, sorted, scalable, highly available.</p>
      <ul>
        <li>12 million × 8 searches × 25 characters = 2.4 billion requests a day ≈ 27,800 a second, about 55,600 at a 2× peak.</li>
        <li>20% of searches are new: 96 million × 20% × 25 bytes ≈ 0.48 GB of new data a day.</li>
      </ul>
    </section>

    <section>
      <h2>The trie</h2>
      <p class="src">Trie data structure</p>
      <p>A <b>trie</b> (prefix tree) has one node per prefix: the root is the empty string, and each child adds a letter. Store each query's frequency on its node. To answer "ca": find the node (O(p) for prefix length p), visit every query under it, sort, take 5. Two changes make it O(1): <b>cap the prefix length</b> (people rarely type 50 characters), and <b>store the top 5 at every node</b>.</p>
      <figure class="fig"><svg id="figTrie" viewBox="0 0 660 220" role="img" aria-label="A trie: the root, then c, then ca, which stores its top 5: car, cat, cart, care, cab. Its children car and cat store their own top 5."></svg><figcaption>Each node keeps its own top 5: answering "ca" is one read</figcaption></figure>
    </section>

    <section>
      <h2>Two paths: gathering and querying</h2>
      <p class="src">Data gathering · Query service</p>
      <p><b>Gathering:</b> updating the trie on every search would be far too slow. Searches go to <b>analytics logs</b> (sampled: 1 in N); <b>aggregators</b> count them per week (or faster for real-time use); <b>workers</b> rebuild the trie and store it in a <b>trie DB</b> (a document store snapshot, or a key-value store with each prefix as a key); the <b>trie cache</b> keeps it in memory.</p>
      <p><b>Querying:</b> the browser sends an AJAX request per keystroke; API servers read the top 5 from the trie cache (refilling it from the DB on a miss). Browsers cache answers (<code>Cache-Control: private, max-age=3600</code>). A <b>filter layer</b> drops offensive suggestions.</p>
    </section>

    <section>
      <h2>Scale the storage</h2>
      <p class="src">Sharding</p>
      <p>Split the trie by first letter: a–m and n–z, or a–i, j–r, s–z, then second letters beyond 26 shards. But many more queries start with c or s than with x: the shards are uneven. A <b>shard map manager</b> sets ranges from past traffic, for example one shard just for s and one for u to z.</p>
    </section>

    <section>
      <h2>How this level is simulated</h2>
      <p class="src">Game assumptions</p>
      <p>${fmt(QPS)} keystroke requests a second at the peak. An API server handles ${fmt(API_CAP)} a second; a trie shard ${fmt(SHARD_CAP)} lookups. A table query takes ${LOOKUP_MS.table} ms, a trie walk ${LOOKUP_MS.trie} ms, a stored top 5 ${LOOKUP_MS.topk} ms, plus the 40 ms trip, 5 ms in the API server and 0.5 ms between servers. ${Math.round(100 * BROWSER_HIT)}% of keystrokes hit the browser's cache. With equal letter ranges the busiest of 2, 3 or 4 shards gets ${LETTER_TOP[2] * 100}%, ${LETTER_TOP[3] * 100}% or ${LETTER_TOP[4] * 100}% of lookups.</p>
      <p class="assume">Game assumptions: API servers $200 a month, trie shards $300; rebuilding weekly $100, daily $200, hourly $500.</p>
    </section>

    <section>
      <h2>Numbers to carry into the interview</h2>
      <p class="src">Capacity estimates</p>
      <p><b>Requests a second</b> = users × searches × characters ÷ 86,400. 12 million × 8 × 25 ≈ 27,800, 55,600 at the peak.</p>
      <p><b>New data a day</b> = searches × new share × bytes. 96 million × 20% × 25 B ≈ 0.48 GB.</p>
    </section>

    <section>
      <h2>How each mission maps to the interview</h2>
      <p class="src">Interview loop · times for a 45-minute interview (formats vary by company)</p>
      <div class="steps4">
        <div><span>Step 1 · 5–8 min</span><b>Scope it</b>Prefix only, 5 suggestions, ranked by frequency, 100 ms.</div>
        <div><span>Step 2 · 10–12 min</span><b>Sketch it</b>The gathering path and the query path.</div>
        <div><span>Step 3 · 15–20 min</span><b>Go deep</b>The trie with stored top 5, trie DB, browser caching, sharding.</div>
        <div><span>Step 4 · 5 min</span><b>Stress it</b>A traffic spike, uneven letters, a new trending search.</div>
      </div>
    </section>
`,

  // Lesson diagram. `f` provides the engine's drawing helpers.
  drawFigures(f) {
    const { $, figDefs, svgEl } = f;
    const f1 = $('figTrie'); f1.textContent = ''; figDefs(f1);
    const box = (x, y, w, title, sub) => {
      svgEl('rect', { x: x - w / 2, y: y - 22, width: w, height: 44, rx: 6, class: 'ic-stroke' }, f1);
      const t = svgEl('text', { x, y: y - 3, class: 'd-label', 'text-anchor': 'middle' }, f1); t.textContent = title;
      if (sub) { const s = svgEl('text', { x, y: y + 14, class: 'd-label', 'text-anchor': 'middle' }, f1); s.textContent = sub; }
    };
    const line = (x1, y1, x2, y2) => svgEl('line', { x1, y1, x2, y2, class: 'd-line' }, f1);
    box(80, 110, 90, 'root', '');
    box(220, 110, 90, 'c', '');
    box(400, 110, 210, 'ca', 'car, cat, cart, care, cab');
    box(590, 50, 120, 'car', 'car, cart, care');
    box(590, 170, 120, 'cat', 'cat');
    line(125, 110, 175, 110); line(265, 110, 295, 110); line(505, 95, 530, 60); line(505, 125, 530, 160);
  },
};
