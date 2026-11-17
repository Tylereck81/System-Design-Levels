// @ts-check
/** @import { Level, Goal, Lesson } from '../js/types.js' */
// Level 17: News feed.
// Everything specific to this level lives here: components, rules, missions, quiz and text.
import { fmt, ms } from '../js/format.js';
import { servedGoal, latGoal, costGoal, fmtPct } from './shared/goals.js';
import { FRIENDS, USERS, FEED_KEEP, ID_BYTES, POST_BYTES, WORKER_WRITES, INACTIVE, STAR, STARS_FOLLOWED, LOOKUPS_CAP } from '../js/engine/feed.js';
import { dns, lb, NO_DB_NOTE, autoscaleSubOf, scalingChoices } from './shared/components.js';
import { dnsLookup, usersToLb, lbToWeb, lbBad } from './shared/connections.js';
import { lbText, levelComplete } from './shared/text.js';
import { failText, passText } from './shared/quiz.js';
import { dayTraffic } from './shared/workload.js';
import { panel } from './shared/figures.js';
import { COMPONENTS } from '../js/engine/catalog.js';
import { STEPS } from './mock-steps.js';

const targets = { latencyMs: 150, servedPct: 99 };
// Skipping inactive friends fits, buying 8 workers does not: DNS $5 + LB $20 + 2 L web groups × $417 + feed cache
// 120 GB × $2 + feed service $300 + $100 per worker = $1,799 with 4 workers, $2,199 with 8.
const BUDGET = 2000;
const READS = 3000; // feed loads a second at the evening peak
const POSTS = 150; // new posts a second at the peak
const SURGE = 2; // posts on New Year's Eve
const RUSH = 1.4; // the dinner rush
const CACHE_LIMIT_GB = 200; // the feed cache must fit in this much memory
const DELIVER_S = 5; // seconds a post may take to reach friends' feeds
// The feed service's and feed cache's prices, as js/engine/kinds/feed.js charges them (tests/unit pins them).
const WORKER_COST = 100; // $ a month for each fanout worker
const GB_COST = 2; // $ a month for each GB the feed cache holds

const fits = (m) => !!m.feed && m.feed.cacheGB <= CACHE_LIMIT_GB;
/** @type {Goal} */
const cacheGoal = { id: 'cachegb', type: 'metric', text: `Feed cache under ${CACHE_LIMIT_GB} GB`, test: fits, val: (m) => (m.feed ? `${fmt(m.feed.cacheGB)} GB` : '—') };
const quick = (m) => !!m.feed && m.feed.lag <= DELIVER_S;
/** @type {Goal} */
const lagGoal = { id: 'lag', type: 'metric', text: `A post reaches friends' feeds within ${DELIVER_S} s`, test: quick, val: (m) => (m.feed ? (m.feed.lag === Infinity ? 'never' : `${fmt(m.feed.lag)} s`) : '—') };
const ok = (m) => m.servedPct >= targets.servedPct && m.latency != null && m.latency < targets.latencyMs;
const ON = (key, label, opts) => ({ key, label, options: opts });

// ---------------- Lesson ----------------
const [scope, sketch, deep, stress] = STEPS.map((step) => `<b>${step.name}</b>`);
const feedsvc = COMPONENTS.feedsvc;
const millions = (n) => `${fmt(n / 1e6)} million`;
const starFollowers = millions(STAR);
/** Feed loads for each new post at the peak: 3,000 ÷ 150 = 20. */
const LOADS_PER_POST = READS / POSTS;

// Scope example (ours): 20 million users, 300 entries each (the mission uses 15 million and 500).
// 20,000,000 × 300 × 16 bytes = 9.6 × 10¹⁰ bytes = 96 GB; × 1,000 bytes = 6 × 10¹² bytes = 6 TB.
const sc = { users: 20e6, entries: 300 };
sc.gb = (sc.users * sc.entries * ID_BYTES) / 1e9;
sc.wholeTb = (sc.users * sc.entries * POST_BYTES) / 1e12;

// Fanout example (ours): 200 posts a second × 250 friends = 50,000 feed writes a second.
const fo = { posts: 200, friends: 250 };
fo.writes = fo.posts * fo.friends;
// One star post to 2 million followers at 50,000 writes a second: 40 s.
const st = { followers: 2e6 };
st.secs = st.followers / fo.writes;

/** @type {Lesson} */
const lesson = {
  intro: {
    kicker: 'Level 17 · Part 3: Design real systems',
    title: 'News feed',
    story: `A social app shows each user the latest posts from their friends, newest first. Each user has around ${FRIENDS} friends, feeds are opened all evening, and one singer just joined with ${starFollowers} followers.`,
    picture: 'figBuilt',
    alt: 'The finished design: a new post goes through the feed service to fanout workers, which add its ID to friends\' feeds in a feed cache. Reading a feed takes the IDs from the feed cache and fills in posts and authors from two more caches, with photos from a CDN.',
    outcomes: [
      'estimate the memory a feed cache needs',
      'choose between building feeds at post time or read time',
      'explain why a feed cache stores only IDs',
      'deal with accounts that have millions of followers',
      'avoid work for users who never come back',
    ],
  },
  last: 'Level 16 delivered one message to one user. A post must reach every friend of its author, and the number of friends decides the cost.',
  parts: [
    {
      title: 'Fast feeds',
      mission: 0,
      minutes: 10,
      lead: 'Opening the app is the moment users judge you. The feed has to be ready.',
      newParts: [
        { type: 'feedsvc', before: 1, what: 'The service that stores posts and builds feeds.', does: 'Stores each new post, puts its ID into friends\' feeds, and assembles a feed when someone opens the app.', game: `$${feedsvc.cost} a month, plus $${WORKER_COST} for each fanout worker.` },
        { type: 'feedcache', before: 1, what: 'A cache that holds each user\'s feed.', does: 'Keeps the latest entries of every user\'s feed in memory, ready to read.', game: `A managed cache, $${GB_COST} a month for each GB.` },
      ],
      sections: [
        {
          title: 'Scope it: how big is everyone\'s feed?',
          hook: `Ask what a feed shows, in what order, and for how many people. Say: friends' posts, newest first, ${millions(sc.users)} users, keep the latest ${sc.entries} entries of each feed in memory.`,
          body: [
            {
              calc: {
                formula: 'Feed cache = users × entries each × bytes an entry.',
                rows: [
                  { label: 'IDs only', work: `${millions(sc.users)} users × ${sc.entries} entries × ${ID_BYTES} bytes`, result: `${fmt(sc.gb)} GB` },
                  { label: 'Whole posts', work: `${millions(sc.users)} users × ${sc.entries} entries × ${fmt(POST_BYTES)} bytes`, result: `${fmt(sc.wholeTb)} TB` },
                ],
                result: `Storing a post ID and an author ID, ${ID_BYTES} bytes, fits in ${fmt(sc.gb)} GB of memory. Copying whole posts into every friend's feed would need ${fmt(sc.wholeTb)} TB.`,
              },
            },
            { p: 'So each feed is a list of IDs. A post is stored once, and a feed only points to it.' },
          ],
          takeaway: 'Store IDs in each feed, not posts, so the cache fits in memory.',
          quiz: [9, 2],
        },
        {
          title: 'Should a feed be built when you post or when you read?',
          hook: 'Every feed is made of friends\' posts. The question is when to gather them.',
          body: [
            {
              figure: 'figFanout',
              alt: 'With push, Ana\'s new post is written into the feeds of each of her friends when she posts, so reading a feed is a single lookup. With pull, the post stays in Ana\'s own list, and when Ben opens his feed the service gathers posts from every friend and sorts them.',
              caption: 'Do the work once at post time, or every time someone reads',
            },
            { ul: [
              '<b>Fanout on write (push):</b> the work happens when a post is made. Reading is one list, so it is fast, but feeds are built for users who may never open them.',
              '<b>Fanout on read (pull):</b> the work happens when a feed is opened. Nothing is wasted, but every read must gather and sort.',
            ] },
            { p: `The app makes only two calls: publish a post, and get my feed. Feed loads outnumber new posts ${LOADS_PER_POST} to 1 here, so doing the work once at post time pays.` },
          ],
          takeaway: 'Push when reads far outnumber posts, and pull for users who rarely read.',
          quiz: [0, 3],
        },
        {
          title: 'How does a post reach friends\' feeds?',
          hook: 'Delivering one post to every friend is called <b>fanout</b>.',
          body: [
            { ol: [
              'Get the author\'s friend list from a <b>graph database</b>, which is built for who-knows-whom.',
              'Drop friends whose settings hide it: someone who snoozed the author, or a post shared with only some friends.',
              'Put the post ID and the friend list on a queue.',
              'Fanout workers add the post ID to each friend\'s feed in the feed cache.',
            ] },
            {
              calc: {
                formula: 'Feed writes a second = posts a second × friends each.',
                rows: [
                  { label: 'Writes', work: `${fmt(fo.posts)} posts/s × ${fo.friends} friends`, result: `${fmt(fo.writes)} writes/s` },
                ],
                result: `${fmt(fo.posts)} posts a second become ${fmt(fo.writes)} feed writes a second.`,
              },
            },
          ],
          takeaway: 'Fanout multiplies each post by its author\'s friend count.',
          quiz: [5, 8],
        },
        {
          title: 'How does a list of IDs become a feed?',
          hook: 'A feed of IDs is not something you can show. It must be filled in.',
          body: [
            {
              figure: 'figHydrate',
              alt: 'The feed cache holds pairs of post ID and author ID. The user cache fills in each author\'s name and picture, the post cache fills in the text, and photos are linked from a CDN. The full feed is returned as JSON.',
              caption: 'IDs from the feed cache, details from two more caches',
            },
            { p: 'The feed service reads the list of IDs, then fetches each author from the <b>user cache</b> and each post from the <b>post cache</b>, and returns the result. Photos and videos come from a <b>CDN</b>, as in Level 5.' },
          ],
          takeaway: 'A feed is filled in from the user and post caches, with media from a CDN.',
          quiz: [6, 7],
        },
      ],
      checks: [
        {
          q: 'A feed cache keeps 1,000 entries for each of 10 million users, 16 bytes each. About how big is it?',
          options: [
            { t: '16 GB', why: 'Check the zeros: 10 million × 1,000 is 10 billion entries.' },
            { t: '160 GB', right: true, why: '10 million × 1,000 × 16 bytes = 1.6 × 10 to the 11 bytes.' },
            { t: '1.6 TB', why: 'That is ten times too much.' },
          ],
        },
      ],
      youWill: [
        'estimate the feed cache (Play stays locked until you do)',
        `make feeds fast with the feed cache under ${CACHE_LIMIT_GB} GB`,
        `survive the dinner rush with Response under ${ms(targets.latencyMs)}, for at most $${fmt(BUDGET)} a month`,
      ],
      debrief: {
        saw: 'A feed load read one list of IDs, and posts were filled in from caches where each is stored once.',
        number: [`${LOADS_PER_POST} to 1`, 'feed loads to new posts'],
        next: `A singer with ${starFollowers} followers is about to post.`,
      },
    },
    {
      title: 'A star posts',
      mission: 1,
      minutes: 6,
      lead: 'Pushing works because most people have a few hundred friends. Not everyone does.',
      sections: [
        {
          title: 'Why does one star\'s post slow everyone down?',
          hook: `Fanout writes one entry per follower. A star with ${millions(st.followers)} followers turns one post into ${millions(st.followers)} writes.`,
          body: [
            {
              calc: {
                formula: 'Time to fan out one post = followers ÷ feed writes the workers manage each second.',
                rows: [
                  { label: 'One star post', work: `${millions(st.followers)} writes ÷ ${fmt(fo.writes)} writes/s`, result: `${st.secs} s` },
                ],
                result: `${st.secs} seconds of all the workers' time, and every other post waits in the queue behind it.`,
              },
            },
            { p: 'One account sending a burst of work to one place is the <b>hot key</b> problem again, this time in fanout.' },
          ],
          takeaway: 'A star\'s post means millions of feed writes, and everyone else waits.',
          quiz: [1],
        },
        {
          title: 'How to handle accounts with millions of followers',
          hook: 'Use both models. Push for almost everyone. Pull for the few accounts with huge followings.',
          body: [
            { p: 'A star\'s posts are not fanned out. When a follower opens the feed, the service takes their pushed list and adds the latest posts of the few stars they follow, then sorts. That is a handful of extra lookups per feed load, instead of millions of writes at once. This is the <b>hybrid</b> model.' },
          ],
          takeaway: 'Push for ordinary accounts, and let followers pull the stars\' posts.',
          quiz: [4],
        },
      ],
      checks: [
        {
          q: 'With the hybrid model, where does a star\'s new post come from when a follower opens the app?',
          options: [
            { t: 'From the follower\'s pushed feed', why: 'A star\'s posts are not pushed. That is the point of the hybrid.' },
            { t: 'From the star\'s own posts, pulled when the feed is opened', right: true, why: 'The service merges the stars\' latest posts into the pushed list at read time.' },
          ],
        },
      ],
      youWill: [
        'press A star posts and see the fanout queue back up',
        `switch to the hybrid so every post reaches friends' feeds within ${DELIVER_S} seconds`,
        `stay within $${fmt(BUDGET)} a month`,
      ],
      debrief: {
        saw: 'Followers pulled the star\'s post when they opened the app, and the queue stayed short.',
        number: [`${DELIVER_S} s`, 'the most a post may take to reach friends\' feeds'],
        next: 'At midnight on New Year\'s Eve everyone posts at once.',
      },
    },
    {
      title: 'New Year\'s Eve',
      mission: 2,
      minutes: 5,
      lead: 'Pushing writes into every friend\'s feed, including friends who will never read it.',
      sections: [
        {
          title: 'How to stop paying for feeds nobody reads',
          hook: 'Many friends have not opened the app in months. Pushing to them is work thrown away.',
          body: [
            { p: 'Skip fanout to users who have not been active for a while, and build their feed by pulling when they come back. It is the same idea as the hybrid, applied to readers instead of authors: push where it will be read, pull where it probably will not.' },
            { p: 'At a peak this is cheaper than buying more workers, because the writes are never made at all.' },
          ],
          takeaway: 'Skip fanout to inactive users and build their feed when they return.',
          quiz: [],
        },
      ],
      checks: [
        {
          q: 'Posts triple at a big event. Half of all friends are inactive. If fanout skips them, how do total feed writes compare with a normal evening?',
          options: [
            { t: 'Triple', why: 'Only if every friend is written to. Skipping half removes those writes.' },
            { t: 'About 1.5 times', right: true, why: 'Three times the posts × 50% of the friends = 1.5 times the writes.' },
          ],
        },
      ],
      youWill: [
        'press Midnight to double the posts',
        `keep every post reaching friends' feeds within ${DELIVER_S} seconds`,
        `stay within $${fmt(BUDGET)} a month`,
      ],
    },
  ],
  wrap: {
    picture: 'figBuiltEnd',
    alt: 'The finished design: new posts are fanned out as IDs into friends\' feeds in a feed cache, except for stars, whose posts are pulled. Reading fills in posts and authors from caches, with photos from a CDN.',
    say: [
      '"Feeds are read far more than posts are written, so I push each post ID into friends\' feeds."',
      '"The feed cache holds only IDs, filled in from the post and user caches."',
      '"Stars\' posts are pulled at read time, and inactive users get no fanout."',
    ],
    numbers: [
      [`${ID_BYTES} bytes`, 'for one feed entry: a post ID and an author ID'],
      [`${LOADS_PER_POST} to 1`, 'feed loads to new posts'],
    ],
    loop: `The interview steps: ${scope} (the feed cache), ${sketch} (publish and read flows), ${deep} (push, pull and the hybrid), ${stress} (a dinner rush, a star, New Year's Eve).`,
    broken: 'A feed can be a few seconds late. In Level 18 a chat message cannot, and the server must reach the phone without waiting to be asked.',
  },
};

// ---------------- Lesson pictures ----------------
/**
 * The finished design, drawn for the intro and again for the wrap-up. Down the middle, users reach the feed service
 * through the web servers. Publishing (left): friend lists from a graph database, fanout workers write post IDs into
 * the feed cache. Reading (right and down): IDs from the feed cache, authors and posts from two caches, media from a CDN.
 * @param {Record<string, Function>} f the drawing helpers `drawFigures` is given
 * @param {SVGSVGElement} svg
 */
function drawBuilt(f, svg) {
  const { figNode, figArrow, figSvg } = f;
  figSvg(svg, 560);
  figNode(svg, 'users', 110, 45, 'Users', 'Post, open feeds');
  figNode(svg, 'cdn', 530, 45, 'CDN', 'Photos, videos');
  figArrow(svg, 436, 45, 204, 45, 'media', null, 320, 37, 'middle');
  figNode(svg, 'web', 320, 165, 'Web servers', 'Auth, rate limits');
  figArrow(svg, 150, 75, 270, 135, 'requests', null, 222, 98);
  figNode(svg, 'db', 110, 165, 'Graph database', 'Friend lists');
  figNode(svg, 'cache', 530, 165, 'User cache', 'Names, pictures');
  figNode(svg, 'feedsvc', 320, 285, 'Feed service', 'Publish, fill in');
  figArrow(svg, 320, 195, 320, 255, '', null, 0, 0);
  figArrow(svg, 260, 255, 160, 195, 'friends', null, 196, 240, 'end');
  figArrow(svg, 380, 255, 480, 195, 'authors', null, 444, 240);
  figNode(svg, 'worker', 110, 405, 'Fanout workers', 'Queue, then write');
  figArrow(svg, 260, 315, 160, 375, 'new post', null, 196, 330, 'end');
  figNode(svg, 'cache', 530, 405, 'Post cache', 'Each post once');
  figArrow(svg, 380, 315, 480, 375, 'posts', null, 444, 330);
  figNode(svg, 'feedcache', 320, 525, 'Feed cache', 'Post and user IDs');
  figArrow(svg, 150, 435, 250, 495, 'post IDs', null, 186, 490, 'end');
  figArrow(svg, 320, 315, 320, 495, 'read IDs', null, 332, 410);
}

/**
 * Push against pull. Push: Ana's post is written into three friends' feeds when she posts. Pull: her post stays in her
 * own list, and when Ben opens his feed the service gathers every friend's list and sorts.
 * @param {Record<string, Function>} f the drawing helpers `drawFigures` is given
 * @param {SVGSVGElement} svg
 */
function drawFanout(f, svg) {
  const { figNode, figArrow, figLabel, figSvg } = f;
  figSvg(svg, 520);
  /** One panel: `who` on the left, an arrow to each of three boxes on the right. */
  const fan = (top, who, boxes, note) => {
    figNode(svg, 'users', 120, top + 120, ...who);
    boxes.forEach(([type, name, sub], i) => {
      const y = top + 50 + 70 * i;
      figNode(svg, type, 520, y, name, sub);
      figArrow(svg, 214, top + 120, 426, y, '', null, 0, 0);
    });
    figLabel(svg, 120, top + 180, note);
  };
  panel(f, svg, 10, 240, 'Push: the work happens when Ana posts');
  fan(10, ['Ana posts', 'One new post'], [['feedcache', 'Ben\'s feed', '+ Ana\'s post ID'], ['feedcache', 'Cy\'s feed', '+ Ana\'s post ID'], ['feedcache', 'Dee\'s feed', '+ Ana\'s post ID']], 'Ben\'s read: one list');
  panel(f, svg, 270, 240, 'Pull: the work happens when Ben opens his feed');
  fan(270, ['Ben opens his feed', 'Asks every friend'], [['feedsvc', 'Ana\'s posts', 'Her own list'], ['feedsvc', 'Cy\'s posts', 'Their own list'], ['feedsvc', 'Dee\'s posts', 'Their own list']], 'gathers, then sorts');
}

/**
 * Filling in a feed: the feed service takes IDs from the feed cache, authors from the user cache and posts from the
 * post cache, and returns JSON to the app, which loads photos from a CDN.
 * @param {Record<string, Function>} f the drawing helpers `drawFigures` is given
 * @param {SVGSVGElement} svg
 */
function drawHydrate(f, svg) {
  const { figNode, figArrow, figSvg } = f;
  figSvg(svg, 330);
  figNode(svg, 'feedcache', 120, 45, 'Feed cache', 'Post 81 by user 7');
  figNode(svg, 'feedsvc', 120, 165, 'Feed service', 'Fills in each ID');
  figArrow(svg, 120, 75, 120, 135, 'IDs', null, 132, 110);
  figNode(svg, 'cache', 520, 45, 'User cache', 'Names, pictures');
  figArrow(svg, 214, 150, 426, 60, 'user 7', null, 310, 96, 'end');
  figNode(svg, 'cache', 520, 165, 'Post cache', 'Text of post 81');
  figArrow(svg, 214, 165, 426, 165, 'post 81', null, 320, 157, 'middle');
  figNode(svg, 'users', 120, 285, 'The app', 'Full feed, JSON');
  figArrow(svg, 120, 195, 120, 255, 'JSON', null, 132, 230);
  figNode(svg, 'cdn', 520, 285, 'CDN', 'Photos, videos');
  figArrow(svg, 426, 285, 214, 285, 'photos', null, 320, 277, 'middle');
}

/** @type {Level} */
export default {
  id: 17,
  saveKey: 'sdl-level17-v1',
  saveVersion: 2, // 2: which missions were opened from the lesson (`opened`)
  targets,
  // The day's traffic curve (for the autoscaled web servers). feed: this level's news feed; surge: posts on New Year's Eve.
  workload: { day: dayTraffic(), feed: true, surge: SURGE },

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
    dns: dns(),
    lb: lb(),
    web: {
      name: 'Web server', short: 'Auth, rate limits',
      desc: 'Checks each request\'s auth token and rate limits, then calls the feed service. These are autoscaled groups of L servers, as in Level 6.',
      noDbNote: NO_DB_NOTE,
      subOf: autoscaleSubOf,
      choices: scalingChoices(),
    },
    feedsvc: {
      name: 'Feed service', short: 'Publishes and builds feeds',
      desc: `Stores each new post and fans it out: puts its ID in friends' feeds, using the friend list from a graph database. Builds a feed from the feed cache, then fills in the posts and authors from the post and user caches. $${COMPONENTS.feedsvc.cost} a month, plus $${WORKER_COST} per fanout worker.`,
      subOf: (n) => `${{ read: 'fanout on read', write: 'fanout on write', hybrid: 'hybrid' }[n.fanout] || 'fanout on read'} · ${Number(n.workers) || 2} workers${n.inactive === 'skip' ? ' · skips inactive' : ''}`,
      choices: [
        ON('fanout', 'Fanout', [
          { id: 'read', name: 'On read (pull)', sub: 'build the feed at load time', note: `Each feed load looks up the recent posts of all ${FRIENDS} friends. Nothing is precomputed, so no work is wasted, but loads are slow and heavy.`, log: 'Feeds are now built when they load (fanout on read).' },
          { id: 'write', name: 'On write (push)', sub: 'put each post in friends\' feeds', note: 'When someone posts, workers add its ID to every friend\'s cached feed. A load reads one list: fast. But one post is as many writes as its author has friends.', log: 'Posts now fan out to friends\' feeds when written (fanout on write).' },
          { id: 'hybrid', name: 'Hybrid', sub: 'push, but pull stars\' posts', note: `Push everyone's posts except accounts with huge followings; their followers pull those at load time (${STARS_FOLLOWED} stars each, on average).`, log: 'Feeds now use the hybrid: push for most, pull for stars.' },
        ]),
        ON('workers', 'Fanout workers', [1, 2, 4, 8].map((k) => ({ id: String(k), name: `${k} ${k === 1 ? 'worker' : 'workers'}`, sub: `${fmt(k * WORKER_WRITES)} writes a second`, note: `${k} fanout ${k === 1 ? 'worker takes' : 'workers take'} friend lists from a queue and write post IDs into feeds, ${fmt(WORKER_WRITES)} a second each. $${fmt(k * WORKER_COST)} a month.`, log: `Fanout workers set to ${k}.` }))),
        ON('inactive', 'Inactive users', [
          { id: 'all', name: 'Fan out to everyone', sub: 'every friend\'s feed', note: 'Every friend gets the post in their cached feed, even those who haven\'t opened the app in months.', log: 'Fanout now reaches every friend.' },
          { id: 'skip', name: 'Skip inactive users', sub: 'build theirs when they return', note: `${Math.round(100 * INACTIVE)}% of friends haven't opened the app in a month. Skip their feeds; build one by pulling when they come back.`, log: 'Fanout now skips inactive users.' },
        ]),
      ],
    },
    feedcache: {
      name: 'Feed cache', short: 'Each user\'s feed',
      desc: `Keeps the latest ${FEED_KEEP} posts of each user's feed in memory, for ${fmt(USERS / 1e6)} million users. A managed cache, $${GB_COST} a month per GB.`,
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
      'dns|users': dnsLookup(),
      'lb|users': usersToLb(),
      'lb|web': lbToWeb(),
      'feedsvc|web': { from: 'web', to: 'feedsvc', label: 'posts, feeds', desc: 'The web server passes posts and feed loads to the feed service.' },
      'feedcache|feedsvc': { from: 'feedsvc', to: 'feedcache', label: 'feeds', desc: 'The feed service writes post IDs into feeds and reads them back.' },
    },
    bad: {
      ...lbBad(),
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
      story: `${fmt(READS)} feed loads and ${fmt(POSTS)} posts a second at the evening peak. Every load builds the feed from ${FRIENDS} friends' recent posts, and the post store can't keep up. Make feeds fast, keep the feed cache under ${CACHE_LIMIT_GB} GB, and survive the dinner rush.`,
      goals: [
        { id: 'est', type: 'gate', text: 'Estimate the feed cache' },
        servedGoal(targets), latGoal(targets), cacheGoal, costGoal(BUDGET),
        { id: 'rush', type: 'exp', text: `Break it: the dinner rush (${RUSH}×); still ${targets.servedPct}% served under ${ms(targets.latencyMs)}` },
      ],
      hint: 'Fan out on write: put each post\'s ID in friends\' feeds when it is posted, so a load reads one list. Store only IDs in the feed cache. Four workers keep up with the posts.',
      takeaway: 'Fanout on write moved the work from reads to writes: a feed load reads one list of IDs, and the posts are filled in from caches where each is stored once. Reads outnumber posts 20 to 1, so that trade pays.',
    },
    {
      title: 'A star posts', ref: 'Hotkey problem', qps: READS + POSTS, writes: POSTS / (READS + POSTS), budget: BUDGET,
      story: `A singer with ${fmt(STAR / 1e6)} million followers joins. With fanout on write, one of her posts is ${fmt(STAR / 1e6)} million feed writes, and everyone else's posts queue behind them. Every post must reach friends' feeds within ${DELIVER_S} seconds.`,
      goals: [
        lagGoal, servedGoal(targets), latGoal(targets), cacheGoal, costGoal(BUDGET),
        { id: 'star', type: 'exp', text: `Break it: the star posts; posts still reach feeds within ${DELIVER_S} s` },
      ],
      hint: 'Use the hybrid: push most posts, but let followers pull stars\' posts when they load their feed.',
      takeaway: 'The hybrid kept the push model for almost everyone, and followers pulled the star\'s post at load time: a few extra lookups per load instead of millions of writes at once.',
    },
    {
      title: 'New Year\'s Eve', ref: 'Fanout cost', qps: READS + POSTS, writes: POSTS / (READS + POSTS), budget: BUDGET,
      story: `At midnight everyone posts: ${SURGE}× the posts. The fanout workers write each into every friend's feed, including friends who haven't opened the app in months. Keep posts reaching feeds within ${DELIVER_S} seconds, within the budget.`,
      goals: [
        lagGoal, servedGoal(targets), latGoal(targets), cacheGoal, costGoal(BUDGET),
        { id: 'nye', type: 'exp', text: `Break it: midnight (${SURGE}× posts); posts still reach feeds within ${DELIVER_S} s` },
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
      observed: () => `Observed: the star posted, and posts still reached feeds within ${DELIVER_S} s.`,
    },
    {
      id: 'nye', kind: 'event', postSurge: true,
      label: 'Midnight', labelOn: 'Party over',
      needsDesign: 'Build the design first: web servers, feed service and feed cache.',
      on: `Midnight: ${SURGE}× the posts.`, onTone: 'bad',
      off: 'The posting calms down.',
      expect: (m) => quick(m) && ok(m),
      notMet: (m) => `The fanout workers can't keep up: ${fmt(m.feed.writes)} feed writes a second. Skip inactive users, or add workers.`,
      observed: () => `Observed: midnight came, and posts still reached feeds within ${DELIVER_S} s.`,
    },
  ],

  // Messages the engine shows for this level's design.
  text: {
    ...lbText(),
    levelComplete: levelComplete(17),
  },

  quiz: {
    passScore: 8,
    passText: passText(17, 'Chat system'),
    failText,
    questions: [
      { q: 'What does fanout on write do when someone posts?', o: ['Puts the post ID in each friend\'s feed', 'Waits until each friend asks for the feed again', 'Emails every friend', 'Deletes old posts'], a: 0, e: 'Fanout on write (push) precomputes feeds: each friend\'s cached feed gets the new post ID right away, so loading a feed is one read.', r: 'Should a feed be built when you post or when you read?' },
      { q: 'What is the hotkey problem in fanout on write?', o: ['A post with too many likes', 'One account\'s post means millions of writes', 'A friend list that never changes after sign-up day', 'A feed that is never loaded'], a: 1, e: 'An account with millions of followers turns one post into millions of feed writes, holding up everyone else\'s posts.', r: 'Why does one star\'s post slow everyone down?' },
      { q: 'Why does the feed cache store only post and user IDs?', o: ['IDs load faster from disk', 'IDs are encrypted', 'Each post changes every minute, so copies go stale fast', 'Whole posts would be copied to every friend\'s feed'], a: 3, e: 'A post shared with 300 friends would be stored 300 times. IDs keep each feed small; posts are kept once in the post cache.', r: 'Scope it: how big is everyone\'s feed?' },
      { q: 'When is fanout on read the better choice?', o: ['For the most active users of the whole app', 'For every feed load', 'Never', 'For users who rarely log in'], a: 3, e: 'Nothing is precomputed for users who rarely open the app; their feed is built only when they do.', r: 'Should a feed be built when you post or when you read?' },
      { q: 'How does the hybrid handle a star\'s posts?', o: ['It pushes them twice', 'It drops them', 'Followers pull them when they load the feed', 'It sends them to every follower by email instead'], a: 2, e: 'Most posts are pushed; posts from accounts with huge followings are pulled at load time, so they never become millions of writes.', r: 'How to handle accounts with millions of followers' },
      { q: 'Where do friend relationships usually live?', o: ['A graph database', 'The feed cache', 'The CDN', 'The load balancer'], a: 0, e: 'Friend lists and friend-of-friend queries suit a graph database; the fanout service reads friend IDs from it.', r: 'How does a post reach friends\' feeds?' },
      { q: 'What fills in a feed of IDs before it is returned?', o: ['The web server\'s disk', 'The user and post caches', 'The graph database, one friend at a time', 'The client'], a: 1, e: 'The feed service reads IDs from the feed cache, then fetches posts and authors from the post and user caches to build the full feed.', r: 'How does a list of IDs become a feed?' },
      { q: 'Where should a feed\'s photos and videos come from?', o: ['The feed cache', 'The web servers', 'A CDN', 'The graph database'], a: 2, e: 'Media is large and read everywhere: serve it from a CDN close to users.', r: 'How does a list of IDs become a feed?' },
      { q: 'You snooze a friend for 30 days. Where are their posts left out?', o: ['In the CDN', 'In fanout, using your settings', 'In the load balancer, before the web servers', 'On the friend\'s phone'], a: 1, e: 'The fanout service reads each friend\'s settings from the user cache and skips feeds that shouldn\'t get the post.', r: 'How does a post reach friends\' feeds?' },
      { q: '15 million users, 500 feed entries each, 16 bytes an entry. About how big is the feed cache?', o: ['12 GB', '1.2 TB', '120 GB', '7.5 TB'], a: 2, e: '1.5 × 10⁷ × 500 × 16 = 1.2 × 10¹¹ bytes ≈ 120 GB. Whole posts at 1,000 bytes would be 7.5 TB.', r: 'Scope it: how big is everyone\'s feed?' },
    ],
  },

  lesson,

  drawFigures(f) {
    const { $ } = f;
    drawBuilt(f, $('figBuilt'));
    drawFanout(f, $('figFanout'));
    drawHydrate(f, $('figHydrate'));
    drawBuilt(f, $('figBuiltEnd'));
  },
};
