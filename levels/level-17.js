// Level 17: News feed.
// Everything specific to this level lives here: components, rules, missions, quiz and text.
import { fmt } from '../js/format.js';
import { servedGoal, latGoal, costGoal, fmtPct } from './shared/goals.js';
import { FRIENDS, USERS, FEED_KEEP, ID_BYTES, POST_BYTES, WORKER_WRITES, INACTIVE, STAR, STARS_FOLLOWED, CACHE_MS, LOOKUP_MS, LOOKUPS_CAP } from '../js/engine/feed.js';
import level2 from './level-02.js';
import level6 from './level-06.js';
import level10 from './level-10.js';

const targets = { latencyMs: 150, servedPct: 99 };
const BUDGET = 2600;
const READS = 3000; // feed loads a second at the evening peak
const POSTS = 150; // new posts a second at the peak
const SURGE = 2; // posts on New Year's Eve
const RUSH = 1.4; // the dinner rush

const fits = (m) => !!m.feed && m.feed.cacheGB <= 200;
const cacheGoal = { id: 'cachegb', type: 'metric', text: 'Feed cache under 200 GB', test: fits, val: (m) => (m.feed ? `${fmt(m.feed.cacheGB)} GB` : '—') };
const quick = (m) => !!m.feed && m.feed.lag <= 5;
const lagGoal = { id: 'lag', type: 'metric', text: 'A post reaches friends\' feeds within 5 s', test: quick, val: (m) => (m.feed ? (m.feed.lag === Infinity ? 'never' : `${fmt(m.feed.lag)} s`) : '—') };
const ok = (m) => m.servedPct >= targets.servedPct && m.latency != null && m.latency < targets.latencyMs;
const ON = (key, label, opts) => ({ key, label, options: opts });

export default {
  id: 17,
  saveKey: 'sdl-level17-v1',
  saveVersion: 1,
  targets,
  // The day's traffic curve (for the autoscaled web servers). feed: this level's news feed; surge: posts on New Year's Eve.
  workload: { day: level6.workload.day, feed: true, surge: SURGE },

  // The mock interview's brief and self-check list for this problem (see mock.js).
  mock: {
    title: 'News feed',
    brief: 'Design a news feed: people post text, photos and short videos, and see their friends\' posts, newest first. 15 million daily users, up to 3,000 friends each.',
    checklist: [
      'Separated publishing a post from building a feed, with an API for each',
      'Compared fanout on write with fanout on read',
      'Handled accounts with huge followings (the hybrid)',
      'Kept only IDs in the feed cache, and estimated its size',
      'Used a graph database for friends, and caches for posts and users',
      'Served photos and videos from a CDN',
    ],
  },

  components: {
    users: {
      name: 'Users', sub: 'Post, scroll feeds',
      desc: `People on a photo-sharing app. They open their feed (GET /v1/me/feed) about 9 times a day and post (POST /v1/me/feed) now and then. Each has ${FRIENDS} friends on average.`,
    },
    dns: level2.components.dns,
    lb: level2.components.lb,
    web: {
      name: 'Web server', short: 'Auth, rate limits',
      desc: 'Checks each request\'s auth token and rate limits, then calls the feed service. These are autoscaled groups of L servers, as in Level 6.',
      noDbNote: level2.components.web.noDbNote,
      subOf: level6.components.web.subOf,
      choices: level6.components.web.choices,
    },
    feedsvc: {
      name: 'Feed service', short: 'Publishes and builds feeds',
      desc: 'Stores each new post and fans it out: puts its ID in friends\' feeds, using the friend list from a graph database. Builds a feed from the feed cache, then fills in the posts and authors from the post and user caches. $300 a month, plus $100 per fanout worker.',
      subOf: (n) => `${{ read: 'fanout on read', write: 'fanout on write', hybrid: 'hybrid' }[n.fanout] || 'fanout on read'} · ${Number(n.workers) || 2} workers${n.inactive === 'skip' ? ' · skips inactive' : ''}`,
      choices: [
        ON('fanout', 'Fanout', [
          { id: 'read', name: 'On read (pull)', sub: 'build the feed at load time', note: `Each feed load looks up the recent posts of all ${FRIENDS} friends. Nothing is precomputed, so no work is wasted, but loads are slow and heavy.`, log: 'Feeds are now built when they load (fanout on read).' },
          { id: 'write', name: 'On write (push)', sub: 'put each post in friends\' feeds', note: 'When someone posts, workers add its ID to every friend\'s cached feed. A load reads one list: fast. But one post is as many writes as its author has friends.', log: 'Posts now fan out to friends\' feeds when written (fanout on write).' },
          { id: 'hybrid', name: 'Hybrid', sub: 'push, but pull stars\' posts', note: `Push everyone's posts except accounts with huge followings; their followers pull those at load time (${STARS_FOLLOWED} stars each, on average).`, log: 'Feeds now use the hybrid: push for most, pull for stars.' },
        ]),
        ON('workers', 'Fanout workers', [1, 2, 4, 8].map((k) => ({ id: String(k), name: `${k} ${k === 1 ? 'worker' : 'workers'}`, sub: `${fmt(k * WORKER_WRITES)} writes a second`, note: `${k} fanout ${k === 1 ? 'worker takes' : 'workers take'} friend lists from a queue and write post IDs into feeds, ${fmt(WORKER_WRITES)} a second each. $${fmt(k * 100)} a month.`, log: `Fanout workers set to ${k}.` }))),
        ON('inactive', 'Inactive users', [
          { id: 'all', name: 'Fan out to everyone', sub: 'every friend\'s feed', note: 'Every friend gets the post in their cached feed, even those who haven\'t opened the app in months.', log: 'Fanout now reaches every friend.' },
          { id: 'skip', name: 'Skip inactive users', sub: 'build theirs when they return', note: `${Math.round(100 * INACTIVE)}% of friends haven't opened the app in a month. Skip their feeds; build one by pulling when they come back.`, log: 'Fanout now skips inactive users.' },
        ]),
      ],
    },
    feedcache: {
      name: 'Feed cache', short: 'Each user\'s feed',
      desc: `Keeps the latest ${FEED_KEEP} posts of each user's feed in memory, for ${fmt(USERS / 1e6)} million users. A managed cache, $2 a month per GB.`,
      subOf: (n) => (n.store === 'ids' ? 'post and user IDs' : 'whole posts'),
      choices: [
        ON('store', 'Each entry holds', [
          { id: 'posts', name: 'The whole post', sub: `about ${fmt(POST_BYTES)} bytes`, note: 'Text, author, counts: everything to show it. No second lookup, but a post shared with 300 friends is copied 300 times.', log: 'The feed cache now stores whole posts.' },
          { id: 'ids', name: 'Post and user IDs', sub: `${ID_BYTES} bytes`, note: 'Only <post_id, user_id>. The feed service fills in each post from the post cache, where it is stored once.', log: 'The feed cache now stores only IDs.' },
        ]),
      ],
    },
  },
  palette: ['dns', 'lb', 'web', 'feedsvc', 'feedcache'],
  limits: { dns: 1, lb: 1, web: 2, feedsvc: 1, feedcache: 1 },
  limitMsg: {
    dns: 'You only need one DNS service.',
    lb: 'One load balancer is enough in this level.',
    web: 'Two autoscaled groups of web servers are enough: they grow on their own.',
    feedsvc: 'One feed service box is enough: set its fanout in the inspector.',
    feedcache: 'One feed cache is enough.',
  },
  // One data center: autoscaled web servers, a feed service that builds feeds at read time, and a feed cache.
  startNodes: [
    { id: 'u', type: 'users', x: 380, y: 60 },
    { id: 'd', type: 'dns', x: 120, y: 60 },
    { id: 'l', type: 'lb', x: 380, y: 168, algo: 'rr' },
    { id: 'w1', type: 'web', x: 250, y: 276, size: 'L', scaling: 'auto' },
    { id: 'w2', type: 'web', x: 510, y: 276, size: 'L', scaling: 'auto' },
    { id: 'f', type: 'feedsvc', x: 380, y: 384, fanout: 'read', workers: '2', inactive: 'all' },
    { id: 'c', type: 'feedcache', x: 380, y: 492, store: 'posts' },
  ],
  startEdges: [
    { id: 's1', from: 'u', to: 'd' }, { id: 's2', from: 'u', to: 'l' },
    { id: 's3', from: 'l', to: 'w1' }, { id: 's4', from: 'l', to: 'w2' },
    { id: 's5', from: 'w1', to: 'f' }, { id: 's6', from: 'w2', to: 'f' }, { id: 's7', from: 'f', to: 'c' },
  ],
  slots: { dns: { x: 120, y: 60 }, lb: { x: 380, y: 168 }, web: { x: 510, y: 276 }, feedsvc: { x: 380, y: 384 }, feedcache: { x: 380, y: 492 } },

  connections: {
    ok: {
      'dns|users': level2.connections.ok['dns|users'],
      'lb|users': level2.connections.ok['lb|users'],
      'lb|web': level2.connections.ok['lb|web'],
      'feedsvc|web': { from: 'web', to: 'feedsvc', label: 'posts, feeds', desc: 'The web server passes posts and feed loads to the feed service.' },
      'feedcache|feedsvc': { from: 'feedsvc', to: 'feedcache', label: 'feeds', desc: 'The feed service writes post IDs into feeds and reads them back.' },
    },
    bad: {
      ...level2.connections.bad,
      'feedsvc|users': 'Users go through the load balancer and web servers, which check their auth token.',
      'feedcache|web': 'The web servers call the feed service, which owns the feed cache.',
      'feedsvc|lb': 'The load balancer spreads requests over web servers, which call the feed service.',
    },
  },

  missions: [
    {
      title: 'Fast feeds', ref: 'Fanout', qps: READS + POSTS, writes: POSTS / (READS + POSTS), budget: BUDGET,
      gate: {
        hidesTraffic: false,
        lo: 120, hi: 120,
        prompt: `<b>Estimate before you build.</b> The feed cache keeps the latest ${FEED_KEEP} posts of each of ${fmt(USERS / 1e6)} million users' feeds, as a post ID and a user ID: ${ID_BYTES} bytes an entry. How many GB?`,
        label: 'GB',
        placeholder: 'e.g. 50',
        acceptedHtml: `<p><b>Estimate accepted.</b></p><div class="calc">15 million × ${FEED_KEEP} × ${ID_BYTES} bytes = 1.2 × 10¹¹ bytes = 120 GB<br>Whole posts (${fmt(POST_BYTES)} bytes): 7.5 TB, too much for memory</div>`,
        acceptedLog: 'Estimate accepted: 120 GB. Play is unlocked.',
        notNumber: 'Type the GB as a number, for example 50.',
        hints: [
          { test: (v) => v === 7500 || v === 7.5, text: 'That is whole posts. The question is IDs only: 16 bytes an entry.' },
          { test: (v) => v === 12 || v === 1200, text: 'Check the powers of ten: 1.5 × 10⁷ × 500 × 16 = 1.2 × 10¹¹ bytes.' },
        ],
        fallback: 'Not quite. Users × entries × bytes, divided by 10⁹ bytes per GB.',
      },
      story: `${fmt(READS)} feed loads and ${fmt(POSTS)} posts a second at the evening peak. Every load builds the feed from ${FRIENDS} friends' recent posts, and the post store can't keep up. Make feeds fast, keep the feed cache under 200 GB, and survive the dinner rush.`,
      goals: [
        { id: 'est', type: 'gate', text: 'Estimate the feed cache' },
        servedGoal(targets), latGoal(targets), cacheGoal, costGoal(BUDGET),
        { id: 'rush', type: 'exp', text: `Break it: the dinner rush (${RUSH}×); still 99% served under 150 ms` },
      ],
      hint: 'Fan out on write: put each post\'s ID in friends\' feeds when it is posted, so a load reads one list. Store only IDs in the feed cache. Four workers keep up with the posts.',
      takeaway: 'Fanout on write moved the work from reads to writes: a feed load reads one list of IDs, and the posts are filled in from caches where each is stored once. Reads outnumber posts 20 to 1, so that trade pays.',
    },
    {
      title: 'A star posts', ref: 'Hotkey problem', qps: READS + POSTS, writes: POSTS / (READS + POSTS), budget: BUDGET,
      story: `A singer with ${fmt(STAR / 1e6)} million followers joins. With fanout on write, one of her posts is ${fmt(STAR / 1e6)} million feed writes, and everyone else's posts queue behind them. Every post must reach friends' feeds within 5 seconds.`,
      goals: [
        lagGoal, servedGoal(targets), latGoal(targets), cacheGoal, costGoal(BUDGET),
        { id: 'star', type: 'exp', text: 'Break it: the star posts; posts still reach feeds within 5 s' },
      ],
      hint: 'Use the hybrid: push most posts, but let followers pull stars\' posts when they load their feed.',
      takeaway: 'The hybrid kept the push model for almost everyone, and followers pulled the star\'s post at load time: a few extra lookups per load instead of millions of writes at once.',
    },
    {
      title: 'New Year\'s Eve', ref: 'Fanout cost', qps: READS + POSTS, writes: POSTS / (READS + POSTS), budget: BUDGET,
      story: `At midnight everyone posts: ${SURGE}× the posts. The fanout workers write each into every friend's feed, including friends who haven't opened the app in months. Keep posts reaching feeds within 5 seconds, within the budget.`,
      goals: [
        lagGoal, servedGoal(targets), latGoal(targets), cacheGoal, costGoal(BUDGET),
        { id: 'nye', type: 'exp', text: `Break it: midnight (${SURGE}× posts); posts still reach feeds within 5 s` },
      ],
      hint: `${Math.round(100 * INACTIVE)}% of friends are inactive: skip their feeds and build them when they return. That's fewer writes than buying more workers.`,
      takeaway: 'Skipping inactive users cut the fanout writes enough to absorb midnight, without paying for more workers. Push for the active, pull for the rest: the same idea as the hybrid.',
    },
  ],

  // Break-it experiments. An event only checks its outcome; `factor` multiplies traffic, star and postSurge change fanout.
  experiments: [
    {
      id: 'rush', kind: 'event', factor: RUSH,
      label: 'Dinner rush', labelOn: 'Rush over',
      needsDesign: 'Build the design first: web servers, feed service and feed cache.',
      on: `The dinner rush: ${RUSH}× the traffic.`, onTone: 'bad',
      off: 'The rush is over.',
      expect: ok,
      notMet: (m) => (m.feed && m.feed.served < 1
        ? `Only ${fmtPct(m.servedPct)} served: building every feed at load time is ${fmt(m.feed.readMs)} ms and ${FRIENDS} lookups each, more than the post store's ${fmt(LOOKUPS_CAP)} a second. Fan out on write.`
        : `Only ${fmtPct(m.servedPct)} served in ${m.latency == null ? '—' : fmt(m.latency)} ms. Look for the busiest part.`),
      observed: (m) => `Observed: the rush came, and ${fmtPct(m.servedPct)} of requests were served in ${fmt(m.latency)} ms.`,
    },
    {
      id: 'star', kind: 'event', star: true,
      label: 'A star posts', labelOn: 'Stop',
      needsDesign: 'Build the design first: web servers, feed service and feed cache.',
      on: `The singer posts: ${fmt(STAR / 1e6)} million followers.`, onTone: 'bad',
      off: 'Her post has reached every feed.',
      expect: (m) => quick(m) && ok(m),
      notMet: (m) => `Posts take ${m.feed.lag === Infinity ? 'forever' : fmt(m.feed.lag) + ' s'} to reach feeds: her post is millions of feed writes, and everyone else's wait behind them. Let followers pull stars' posts (hybrid).`,
      observed: () => 'Observed: the star posted, and posts still reached feeds within 5 s.',
    },
    {
      id: 'nye', kind: 'event', postSurge: true,
      label: 'Midnight', labelOn: 'Party over',
      needsDesign: 'Build the design first: web servers, feed service and feed cache.',
      on: `Midnight: ${SURGE}× the posts.`, onTone: 'bad',
      off: 'The posting calms down.',
      expect: (m) => quick(m) && ok(m),
      notMet: (m) => `The fanout workers can't keep up: ${fmt(m.feed.writes)} feed writes a second. Skip inactive users, or add workers.`,
      observed: () => 'Observed: midnight came, and posts still reached feeds within 5 s.',
    },
  ],

  // Messages the engine shows for this level's design.
  text: {
    ...level2.text,
    levelComplete: 'Level 17 complete. Take the quiz.',
  },

  quiz: {
    passScore: 8,
    passText: 'Level 17 is done. Level 18, Chat system, is next: open it from the level menu at the top.',
    failText: level10.quiz.failText,
    questions: [
      { q: 'What does fanout on write do when someone posts?', o: ['Puts the post ID in each friend\'s feed', 'Waits until each friend asks for the feed again', 'Emails every friend', 'Deletes old posts'], a: 0, e: 'Fanout on write (push) precomputes feeds: each friend\'s cached feed gets the new post ID right away, so loading a feed is one read.', r: 'Fanout on write' },
      { q: 'What is the hotkey problem in fanout on write?', o: ['A post with too many likes', 'One account\'s post means millions of writes', 'A friend list that never changes after sign-up day', 'A feed that is never loaded'], a: 1, e: 'An account with millions of followers turns one post into millions of feed writes, holding up everyone else\'s posts.', r: 'Fanout on write' },
      { q: 'Why does the feed cache store only post and user IDs?', o: ['IDs load faster from disk', 'IDs are encrypted', 'Each post changes every minute, so copies go stale fast', 'Whole posts would be copied to every friend\'s feed'], a: 3, e: 'A post shared with 300 friends would be stored 300 times. IDs keep each feed small; posts are kept once in the post cache.', r: 'Fanout service' },
      { q: 'When is fanout on read the better choice?', o: ['For the most active users of the whole app', 'For every feed load', 'Never', 'For users who rarely log in'], a: 3, e: 'Nothing is precomputed for users who rarely open the app; their feed is built only when they do.', r: 'Fanout on read' },
      { q: 'How does the hybrid handle a star\'s posts?', o: ['It pushes them twice', 'It drops them', 'Followers pull them when they load the feed', 'It sends them to every follower by email instead'], a: 2, e: 'Most posts are pushed; posts from accounts with huge followings are pulled at load time, so they never become millions of writes.', r: 'Hybrid approach' },
      { q: 'Where do friend relationships usually live?', o: ['A graph database', 'The feed cache', 'The CDN', 'The load balancer'], a: 0, e: 'Friend lists and friend-of-friend queries suit a graph database; the fanout service reads friend IDs from it.', r: 'Fanout service' },
      { q: 'What fills in a feed of IDs before it is returned?', o: ['The web server\'s disk', 'The user and post caches', 'The graph database, one friend at a time', 'The client'], a: 1, e: 'The feed service reads IDs from the feed cache, then fetches posts and authors from the post and user caches to build the full feed.', r: 'Newsfeed retrieval' },
      { q: 'Where should a feed\'s photos and videos come from?', o: ['The feed cache', 'The web servers', 'A CDN', 'The graph database'], a: 2, e: 'Media is large and read everywhere: serve it from a CDN close to users.', r: 'Newsfeed retrieval' },
      { q: 'You snooze a friend for 30 days. Where are their posts left out?', o: ['In the CDN', 'In fanout, using your settings', 'In the load balancer, before the web servers', 'On the friend\'s phone'], a: 1, e: 'The fanout service reads each friend\'s settings from the user cache and skips feeds that shouldn\'t get the post.', r: 'Fanout service' },
      { q: '15 million users, 500 feed entries each, 16 bytes an entry. About how big is the feed cache?', o: ['12 GB', '1.2 TB', '120 GB', '7.5 TB'], a: 2, e: '1.5 × 10⁷ × 500 × 16 = 1.2 × 10¹¹ bytes ≈ 120 GB. Whole posts at 1,000 bytes would be 7.5 TB.', r: 'Numbers to carry into the interview' },
    ],
  },

  // Lesson tab content (HTML). The diagram below draws into figFanout.
  lessonHtml: `
    <p class="label">Level 17 · News feed</p>
    <h1>News feed</h1>
    <p class="lede">On a photo-sharing app, every user's home page is a feed: their friends' posts, newest first. Posting and reading happen at very different rates, and a few accounts have millions of followers. In this level you decide when feeds are built: when someone posts, or when someone looks.</p>
    <div class="goals-box">
      <div><b>You will learn</b>Publishing vs building, fanout on write vs on read, the hybrid, and the feed cache.</div>
      <div><b>You will decide</b>Fanout, fanout workers, inactive users, and what the feed cache holds.</div>
      <div><b>You will estimate</b>The size of the feed cache.</div>
    </div>

    <section>
      <h2>Scope it</h2>
      <p class="src">Requirements</p>
      <p>Ask: mobile, web or both (both); which features (post, and see friends' posts); what order (newest first); how many friends (up to 3,000); how many users (15 million a day); media (photos and short videos).</p>
      <p>Two APIs: <code>POST /v1/me/feed</code> with the post's content, and <code>GET /v1/me/feed</code>. Both carry an auth token; the web servers check it and rate-limit posting.</p>
    </section>

    <section>
      <h2>Fanout: when is the feed built?</h2>
      <p class="src">Fanout on write · Fanout on read</p>
      <figure class="fig"><svg id="figFanout" viewBox="0 0 660 220" role="img" aria-label="Fanout on write: a post's ID is written into each friend's feed when posted. Fanout on read: the feed is assembled from friends' posts when it is loaded."></svg><figcaption>Push does the work when a post is made; pull does it when a feed is opened</figcaption></figure>
      <ul>
        <li><b>On write (push):</b> when someone posts, put its ID in every friend's cached feed. Loading is one read and posts appear at once. But one post is as many writes as friends, a huge burst for an account with millions of followers (the <b>hotkey problem</b>), and feeds of users who never come back are computed for nothing.</li>
        <li><b>On read (pull):</b> build the feed when it is opened, from friends' recent posts. No wasted work, no hotkey; but every load is slow and heavy.</li>
        <li><b>Hybrid:</b> push for almost everyone; for accounts with huge followings, followers pull their posts at load time. Consistent hashing (Level 11) also spreads the load.</li>
      </ul>
    </section>

    <section>
      <h2>Publishing a post</h2>
      <p class="src">Feed publishing deep dive</p>
      <ol>
        <li>The post service stores the post in the database and post cache.</li>
        <li>The fanout service gets friend IDs from a <b>graph database</b>, and their settings from the user cache: someone who snoozed the author for 30 days is skipped.</li>
        <li>It puts the friend list and post ID on a queue; <b>fanout workers</b> append <code>&lt;post_id, user_id&gt;</code> to each friend's feed in the <b>feed cache</b>.</li>
        <li>The notification service tells friends (Level 16).</li>
      </ol>
      <p>The feed cache holds <b>only IDs</b>, and only the latest few hundred per user: few people scroll further, so misses are rare.</p>
    </section>

    <section>
      <h2>Loading a feed</h2>
      <p class="src">Newsfeed retrieval deep dive</p>
      <p>The feed service reads the list of IDs, then fills in each post and its author from the post and user caches, and returns JSON. Photos and videos come from a <b>CDN</b>. Caches come in layers: feeds (IDs), content (posts; hot ones kept closest), the social graph, actions (likes, replies) and counters.</p>
    </section>

    <section>
      <h2>How this level is simulated</h2>
      <p class="src">Game assumptions</p>
      <p>${fmt(READS)} feed loads and ${fmt(POSTS)} posts a second at the peak; ${FRIENDS} friends each. A feed read from the cache takes ${CACHE_MS} ms; each post pulled at load time adds ${LOOKUP_MS} ms, and the post store answers ${fmt(LOOKUPS_CAP)} lookups a second. A fanout worker makes ${fmt(WORKER_WRITES)} feed writes a second. ${Math.round(100 * INACTIVE)}% of friends are inactive; a user follows ${STARS_FOLLOWED} stars.</p>
      <p class="assume">Game assumptions: the feed service costs $300 a month plus $100 per worker; the feed cache $2 a month per GB; posts reach feeds in 1 s while the workers keep up.</p>
    </section>

    <section>
      <h2>Numbers to carry into the interview</h2>
      <p class="src">Capacity estimates</p>
      <p><b>Feed cache</b> = users × entries × bytes. 15 million × 500 × 16 B = 120 GB with IDs; 7.5 TB with whole posts.</p>
      <p><b>Fanout writes</b> = posts a second × friends. 150 × 300 = 45,000 a second.</p>
    </section>

    <section>
      <h2>How each mission maps to the interview</h2>
      <p class="src">Interview loop · times for a 45-minute interview (formats vary by company)</p>
      <div class="steps4">
        <div><span>Step 1 · 5–8 min</span><b>Scope it</b>Features, order, friends, users, media.</div>
        <div><span>Step 2 · 10–12 min</span><b>Sketch it</b>Publishing and building flows, the two APIs.</div>
        <div><span>Step 3 · 15–20 min</span><b>Go deep</b>Fanout on write vs read, the hybrid, the feed cache, cache layers.</div>
        <div><span>Step 4 · 5 min</span><b>Stress it</b>A star posts, midnight, scaling the database.</div>
      </div>
    </section>
`,

  // Lesson diagram. `f` provides the engine's drawing helpers.
  drawFigures(f) {
    const { $, figNode, figArrow, figDefs, svgEl } = f;
    const label = (svg, x, y, t, anchor = 'middle') => { const e = svgEl('text', { x, y, class: 'd-label', 'text-anchor': anchor }, svg); e.textContent = t; };
    const f1 = $('figFanout'); f1.textContent = ''; figDefs(f1);
    label(f1, 165, 18, 'On write (push)');
    figNode(f1, 'users', 165, 60, 'Ana posts', '300 friends');
    figNode(f1, 'feedcache', 165, 175, 'Friends\' feeds', '+ post ID, each');
    figArrow(f1, 165, 86, 165, 149, '', null, 0, 0);
    label(f1, 175, 122, '300 writes', 'start');
    label(f1, 495, 18, 'On read (pull)');
    figNode(f1, 'users', 495, 60, 'Ben opens his feed', 'Asks 300 friends');
    figNode(f1, 'feedsvc', 495, 175, 'Friends\' posts', 'Looked up now');
    figArrow(f1, 495, 86, 495, 149, '', null, 0, 0);
    label(f1, 505, 122, '300 lookups', 'start');
  },
};
