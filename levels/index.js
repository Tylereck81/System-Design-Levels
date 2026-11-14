// Playable levels. Each entry loads its level file only when that level is opened.
// `line` is the home page's one-line description. `minutes` is the level's time, given only once its lesson is written
// on one page (it is the lesson's time, `lessonMinutes` in js/level.js; tests/unit/levels.test.mjs checks it).
export const TOTAL_LEVELS = 21;

export const LEVELS = [
  { id: 1, title: 'One server to two tiers', line: 'One server runs the whole shop, until traffic grows nine times.', minutes: 30, load: () => import('./level-01.js') },
  { id: 2, title: 'Load balancer and horizontal scaling', line: 'One crash took the shop down, and no single machine was big enough.', minutes: 24, load: () => import('./level-02.js') },
  { id: 3, title: 'Database replication', line: 'The web tier scales now. The one database does not.', minutes: 25, load: () => import('./level-03.js') },
  { id: 4, title: 'Cache tier', line: 'The same product pages are fetched from disk again and again.', minutes: 24, load: () => import('./level-04.js') },
  { id: 5, title: 'CDN for static content', line: 'The shop gets customers on another continent.', minutes: 22, load: () => import('./level-05.js') },
  { id: 6, title: 'Stateless web tier and autoscaling', line: 'Customers lose their carts when servers change.', load: () => import('./level-06.js') },
  { id: 7, title: 'Multiple data centers', line: 'One building holds the whole shop.', load: () => import('./level-07.js') },
  { id: 8, title: 'Message queue, workers and monitoring', line: 'Photo uploads take seconds and block everything else.', load: () => import('./level-08.js') },
  { id: 9, title: 'Scale the data tier with sharding', line: 'Writes outgrow the biggest database.', load: () => import('./level-09.js') },
  { id: 10, title: 'Rate limiter', line: 'A bot hammers the shop\'s API.', load: () => import('./level-10.js') },
  { id: 11, title: 'Consistent hashing', line: 'Losing one cache server empties all of them.', load: () => import('./level-11.js') },
  { id: 12, title: 'Distributed key-value store', line: 'Concert tickets go on sale in the shop.', load: () => import('./level-12.js') },
  { id: 13, title: 'Unique ID generator', line: 'Orders are created on many servers at once.', load: () => import('./level-13.js') },
  { id: 14, title: 'URL shortener', line: 'Short links that redirect fast, count every click, and can be private.', load: () => import('./level-14.js') },
  { id: 15, title: 'Web crawler', line: 'Fetch pages at full speed, politely, without wasting work.', load: () => import('./level-15.js') },
  { id: 16, title: 'Notification system', line: 'Send push, SMS and email without spamming users or losing one.', load: () => import('./level-16.js') },
  { id: 17, title: 'News feed', line: 'Fast feeds, even when a star posts or everyone posts at once.', load: () => import('./level-17.js') },
  { id: 18, title: 'Chat system', line: 'Real-time messages, delivery to offline friends, and online status.', load: () => import('./level-18.js') },
  { id: 19, title: 'Search autocomplete', line: 'Suggestions in under 100 ms as people type, including what\'s trending.', load: () => import('./level-19.js') },
  { id: 20, title: 'Video platform', line: 'Take uploads in, transcode every video, and keep the CDN bill down.', load: () => import('./level-20.js') },
  { id: 21, title: 'Cloud file sync', line: 'Send less data, tell every device, and keep the storage bill down.', load: () => import('./level-21.js') },
];

/** The course's three parts, each a run of levels in order. */
export const PARTS = [
  { title: 'Grow one app', first: 1, last: 9 },
  { title: 'Building blocks', first: 10, last: 13 },
  { title: 'Design real systems', first: 14, last: 21 },
];

/** Where a level keeps its saved progress. */
export const saveKeyOf = (id) => `sdl-level${id}-v1`;

// The mock interview: a timed problem from one of the real-system levels, on a blank canvas (see mock.js).
export const MOCK = { id: 'mock', title: 'Mock interview', load: () => import('./mock.js') };
/** The levels a mock interview can pick its problem from. */
export const MOCK_LEVELS = [14, 15, 16, 17, 18, 19, 20, 21];
