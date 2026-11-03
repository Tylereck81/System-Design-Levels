// Playable levels. Each entry loads its level file only when that level is opened.
export const TOTAL_LEVELS = 21;

export const LEVELS = [
  { id: 1, title: 'One server to two tiers', load: () => import('./level-01.js') },
  { id: 2, title: 'Load balancer and horizontal scaling', load: () => import('./level-02.js') },
  { id: 3, title: 'Database replication', load: () => import('./level-03.js') },
  { id: 4, title: 'Cache tier', load: () => import('./level-04.js') },
  { id: 5, title: 'CDN for static content', load: () => import('./level-05.js') },
  { id: 6, title: 'Stateless web tier and autoscaling', load: () => import('./level-06.js') },
  { id: 7, title: 'Multiple data centers', load: () => import('./level-07.js') },
  { id: 8, title: 'Message queue, workers and monitoring', load: () => import('./level-08.js') },
  { id: 9, title: 'Scale the data tier with sharding', load: () => import('./level-09.js') },
  { id: 10, title: 'Rate limiter', load: () => import('./level-10.js') },
  { id: 11, title: 'Consistent hashing', load: () => import('./level-11.js') },
  { id: 12, title: 'Distributed key-value store', load: () => import('./level-12.js') },
  { id: 13, title: 'Unique ID generator', load: () => import('./level-13.js') },
  { id: 14, title: 'URL shortener', load: () => import('./level-14.js') },
  { id: 15, title: 'Web crawler', load: () => import('./level-15.js') },
  { id: 16, title: 'Notification system', load: () => import('./level-16.js') },
];
