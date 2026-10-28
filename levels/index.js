// Playable levels. Each entry loads its level file only when that level is opened.
export const TOTAL_LEVELS = 21;

export const LEVELS = [
  { id: 1, title: 'One server to two tiers', load: () => import('./level-01.js') },
  { id: 2, title: 'Load balancer and horizontal scaling', load: () => import('./level-02.js') },
  { id: 3, title: 'Database replication', load: () => import('./level-03.js') },
];
