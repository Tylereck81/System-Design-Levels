// @ts-check
// Component definitions that several levels use: the shop's DNS, load balancer, databases, cache and CDN, the
// autoscaled web server and the sharded database. Each object is made by a function, so every level gets its own
// copy and a change in one level can never leak into another. Strings and pure functions are shared as they are.
// Pure: nothing here reads game state.

/** The shop's users once they log in: most requests read data, the rest write it. */
export const shopUsers = () => ({ name: 'Users', sub: 'Web + mobile app', desc: 'Your shoppers. They look up example.com in DNS, then send requests to the load balancer. Most requests read data, such as product pages and search; the rest write it, such as orders and reviews.' });

/** The shop's users split over two regions, with half of all requests for static files. */
export const regionUsers = () => ({
  name: 'Users', sub: 'Europe + America',
  desc: 'Your shoppers: 70% in Europe, near the data center in Frankfurt, and 30% in America. Every page they open also loads files: product photos, CSS and JavaScript. Half of all requests are for files.',
  regions: { near: 'Europe', far: 'America' },
});

/** DNS that points example.com at the load balancer. */
export const dns = () => ({ name: 'DNS', short: 'Domain → IP address', sub: 'Third-party · $5', desc: 'Turns example.com into the load balancer\'s public IP, 203.0.113.10. Costs $5/month in this game.' });

/** A load balancer with an active/standby pair and three routing methods. */
export const lb = () => ({
  name: 'Load balancer', short: 'Spreads traffic', sub: 'Active', standbySub: 'Standby',
  standbyNote: 'Standby: takes no traffic until the active one fails.',
  algosLabel: 'Routing method',
  algos: [
    { id: 'rr', short: 'round robin', name: 'Round robin', sub: 'same share for each', note: 'Each web server in turn, so each gets the same share. Fair when all servers are the same size; with mixed sizes the small one overloads first.', log: 'Load balancer set to round robin: every web server gets the same share.' },
    { id: 'wrr', short: 'weighted', name: 'Weighted', sub: 'shares follow server size', note: 'Round robin with weights: a server twice the size gets twice the requests. You set the weights; here they follow each server\'s capacity.', log: 'Load balancer set to weighted round robin: shares follow each server\'s capacity.' },
    { id: 'lc', short: 'least conn', name: 'Least connections', sub: 'to the least busy server', note: 'Sends each request to the server with the fewest requests in progress. Faster servers finish sooner, so they get more. In this game that works out the same as weighted; real systems also gain when some requests take much longer than others.', log: 'Load balancer set to least connections: each request goes to the server with the fewest in progress.' },
  ],
  desc: 'Users connect to its public IP, 203.0.113.10. It hands each request to a healthy web server over the private network, using the routing method you pick, and stops using a server that fails its health check. A second load balancer waits as a standby and takes over the same IP if the first one stops sending heartbeats. In this game it handles 5,000 req/s, adds 1 ms and costs $20/month.',
});

/** The web server's note when it has no database to use. */
export const NO_DB_NOTE = 'Not connected to the database, so this server keeps its own copy of the data and handles half its capacity. Connect it to the shared database.';

/** The label of an autoscaled web server: its size and how many copies run now. */
export const autoscaleSubOf = (n, size, st) => {
  if (n.scaling !== 'auto') return null;
  return st && st.copies ? `${n.size} · auto, ×${st.copies} now` : `${n.size} · autoscaled`;
};

/** The web server's choice between one fixed server and an autoscaled group. */
export const scalingChoices = () => [
  {
    key: 'scaling', label: 'Scaling',
    options: [
      { id: 'fixed', name: 'Fixed', sub: 'one server, all month', note: 'One server of this size runs all month, whatever the traffic.', log: 'Web server set to a fixed single server.' },
      { id: 'auto', name: 'Autoscale', sub: '1 to 10 servers, by the hour', note: 'This web server becomes a group of servers of its size. Each hour the autoscaler runs as many as keep them at most 60% busy, from 1 to 10, and you pay for the hours each one runs. The load balancer gives each group the same share.', log: 'Web server set to autoscale: a group of 1 to 10 servers of its size.' },
    ],
  },
];

/** One shared database, SQL or NoSQL. */
export const db = () => ({
  name: 'Database', short: 'Stores data on disk', desc: 'The one shared database every web server reads and writes. It is still a single machine.',
  unsetSub: 'Pick SQL or NoSQL',
  kindsLabel: 'Database type',
  unsetNote: 'Not chosen yet. The app\'s data is relational: users, products and orders.',
  kinds: [
    { id: 'sql', short: 'SQL', name: 'Relational', sub: 'SQL · joins', tone: 'ok', log: 'Database set to relational (SQL). One query fetches an order with its user and products.', note: 'Relational: tables and rows, joins with SQL. One query per request here.' },
    { id: 'nosql', short: 'NoSQL', name: 'NoSQL', sub: 'no joins', tone: 'warn', log: 'Database set to NoSQL. It cannot join, so each request needs 3 lookups.', note: 'NoSQL: no joins, so 3 lookups per request for this relational data.' },
  ],
});

/** A SQL database that is either the primary or a read replica. */
export const replicaDb = () => ({
  name: 'Database', short: 'Primary or replica',
  desc: 'A relational (SQL) database server.',
  roles: {
    primary: { name: 'Primary DB', lower: 'primary database', desc: 'Takes every write: each insert, update and delete. It sends each change on to the replicas. There is one primary; the first database you add is it, and every one after it is a replica.' },
    replica: { name: 'Read replica', lower: 'read replica', desc: 'A copy of the primary that serves reads. It also applies every write the primary sends it, about 1 second behind in this game, and refuses writes of its own.' },
  },
  promoteNote: 'Promoting makes this replica the primary, and the current primary becomes a replica. Do it when the primary fails.',
  downNote: 'This replica is down, so it cannot take over. Promote a healthy one.',
});

const cacheTtls = () => [
  { id: '10', short: '10 s', name: '10 seconds', sub: 'fresh, but many misses', note: 'A changed price shows within 10 seconds. With a read every 10 seconds or so, about half of reads find the item expired.', log: 'Cache TTL set to 10 seconds.' },
  { id: '60', short: '1 min', name: '1 minute', sub: 'about 1 read in 7 expired', note: 'A changed price can show for up to 1 minute. About 1 read in 7 finds the item expired and goes to the database.', log: 'Cache TTL set to 1 minute.' },
  { id: '600', short: '10 min', name: '10 minutes', sub: 'about 1 read in 60 expired', note: 'A changed price can show for up to 10 minutes. About 1 read in 60 finds the item expired.', log: 'Cache TTL set to 10 minutes.' },
  { id: '3600', short: '1 h', name: '1 hour', sub: 'about 1 read in 360 expired', note: 'A changed price can show for up to an hour. Almost every read of a cached item is a hit.', log: 'Cache TTL set to 1 hour.' },
];

/** A cache server (cache-aside) with a TTL and a choice of what happens when a product changes. */
export const cache = () => {
  const ttls = cacheTtls();
  return {
    name: 'Cache', short: 'Hot data in memory',
    desc: 'An in-memory key-value store, such as Redis or Memcached. Web servers check it before the database. Its data lives in memory, so a restart empties it. In this game it handles 10,000 lookups/s.',
    subOf: (n, size) => `${size.mem} GB · TTL ${(ttls.find((o) => o.id === n.ttl) || ttls[1]).short}`,
    choices: [
      { key: 'ttl', label: 'Time to live (TTL)', options: ttls },
      {
        key: 'onWrite', label: 'When a product changes',
        options: [
          { id: 'ttl', name: 'Wait for the TTL', sub: 'old copy until it expires', note: 'The database changes, but the cached copy stays until its TTL runs out. Shoppers can see the old price for up to one TTL.', log: 'Changed products now stay cached until their TTL ends.' },
          { id: 'delete', name: 'Delete the cached copy', sub: 'the next read loads the new one', note: 'After writing the database, the web server deletes the key from the cache, and the next read loads the new data. Products change rarely here, so the extra misses are too few to matter.', log: 'Changed products are now deleted from the cache right after the database write.' },
        ],
      },
    ],
  };
};

const cdnTtls = () => [
  { id: '60', short: '1 min', name: '1 minute', sub: 'about 1 request in 3 misses', note: 'Edges and browsers keep a file for 1 minute. With a request for each file about every 30 seconds, about 1 request in 3 finds it expired and goes to the origin.', log: 'CDN TTL set to 1 minute.' },
  { id: '600', short: '10 min', name: '10 minutes', sub: 'about 1 in 21 misses', note: 'Edges and browsers keep a file for 10 minutes. About 1 request in 21 goes to the origin. A changed file can show for up to 10 minutes.', log: 'CDN TTL set to 10 minutes.' },
  { id: '3600', short: '1 h', name: '1 hour', sub: 'about 1 in 121 misses', note: 'Edges and browsers keep a file for an hour. About 1 request in 121 goes to the origin. A changed file can show for up to an hour.', log: 'CDN TTL set to 1 hour.' },
  { id: '86400', short: '1 day', name: '1 day', sub: 'almost every request hits', note: 'Edges and browsers keep a file for a day, so almost every request is a hit. A changed file can show for up to a day, unless it gets a new name.', log: 'CDN TTL set to 1 day.' },
];

/** A CDN for the shop's static files: TTL, what happens when a file changes, and what happens when it is down. */
export const cdn = () => {
  const ttls = cdnTtls();
  return {
    name: 'CDN', short: 'Files near users',
    desc: 'A content delivery network: a provider\'s servers (edges) in cities around the world, each keeping copies of your static files. Pages link to cdn.example.com, so each shopper gets files from the nearest edge, about 40 ms away. It costs $0.02 per GB sent in this game.',
    subOf: (n) => `TTL ${(ttls.find((o) => o.id === n.ttl) || ttls[0]).short}`,
    live: { arriving: 'files arriving, per second', misses: 'misses/s pulled from the origin', per: 'per file at the edge' },
    choices: [
      { key: 'ttl', label: 'Time to live (TTL)', options: ttls },
      {
        key: 'onChange', label: 'When a file changes',
        options: [
          { id: 'ttl', name: 'Wait for the TTL', sub: 'old file until it expires', note: 'Edges and browsers keep the old file until its TTL runs out.', log: 'Changed files now stay cached until their TTL ends.' },
          { id: 'purge', name: 'Invalidate it', sub: 'clears edges, not browsers', note: 'You call the CDN\'s API to remove the file from every edge, so the next request fetches the new one. Browsers that already have the old file keep it until their own copy expires, up to one TTL.', log: 'Changed files are now invalidated on the CDN.' },
          { id: 'version', name: 'Give it a new name', sub: 'logo.svg?v=3', note: 'Pages link to logo.svg?v=3, a URL no edge or browser has seen, so everyone fetches the new file at once. The old one just expires. A long TTL is safe, because a file never changes under the same name.', log: 'Changed files now get a new name, such as logo.svg?v=3.' },
        ],
      },
      {
        key: 'fallback', label: 'If the CDN is down',
        options: [
          { id: 'none', name: 'Files fail', sub: 'pages lose photos and styles', note: 'Pages link straight to the CDN. If it is down, every file fails: no photos, no styles, no scripts.', log: 'If the CDN is down, files now fail.' },
          { id: 'origin', name: 'Load from the origin', sub: 'slower, but it works', note: 'When a file fails to load from the CDN, the page fetches it from example.com instead. The load balancers and web servers then carry every file again.', log: 'If the CDN is down, pages now load files from the origin.' },
        ],
      },
    ],
  };
};

const keyName = { account: 'account', country: 'country', date: 'sign-up date' };

/** A database split into shards by a key, with a choice of shard count, shard key and shards for popular accounts. */
export const shards = () => ({
  name: 'Sharded database', short: 'Data split by a key',
  desc: 'Several database servers, each holding part of the data: the shards. Every shard has the same tables; a shard key decides which shard holds each row. The web servers work out the shard from the key on every query.',
  sizeLabel: 'Shard size (each shard)',
  subOf: (n) => `${n.count}${n.hot === 'own' ? '+3' : ''} × ${n.size} · ${keyName[n.key] || 'account'}`,
  choices: [
    {
      key: 'count', label: 'Shards (N in key % N)',
      options: [
        { id: '2', name: '2 shards', sub: 'key % 2', note: 'Two shards: each holds about half the data.', log: 'Sharded database set to 2 shards.' },
        { id: '3', name: '3 shards', sub: 'key % 3', note: 'Three shards: each holds about a third of the data.', log: 'Sharded database set to 3 shards.' },
        { id: '4', name: '4 shards', sub: 'key % 4', note: 'Four shards: each holds about a quarter of the data.', log: 'Sharded database set to 4 shards.' },
        { id: '8', name: '8 shards', sub: 'key % 8', note: 'Eight shards: each holds about an eighth of the data.', log: 'Sharded database set to 8 shards.' },
      ],
    },
    {
      key: 'key', label: 'Shard key',
      options: [
        { id: 'account', name: 'account_id % N', sub: 'spreads evenly', note: 'Millions of accounts, so the remainder spreads them, and their queries, evenly over the shards. Account 1006 goes to shard 1006 % 4 = 2.', log: 'Shard key set to account_id.' },
        { id: 'country', name: 'Listener country', sub: 'one country, one shard', note: 'Each country\'s accounts live on one shard. 42% of queries come from one country, and a country can\'t be split, so its shard is far busier than the others.', log: 'Shard key set to country.' },
        { id: 'date', name: 'Sign-up date ranges', sub: 'newest range is busiest', note: 'Each shard holds a range of sign-up dates. New accounts are the most active, so the newest range gets half of all queries.', log: 'Shard key set to sign-up date ranges.' },
      ],
    },
    {
      key: 'hot', label: 'Very popular accounts',
      options: [
        { id: 'stay', name: 'Where the key puts them', sub: 'no extra shards', note: 'Hot accounts stay on the shard their key gives them, with everyone else\'s data.', log: 'Popular accounts stay on their usual shard.' },
        { id: 'own', name: 'A shard for each', sub: '+3 shards', note: 'Each of the three hot accounts gets a shard of its own, the same size as the others. The web servers look these accounts up in a short list before using the key.', log: 'Each popular account now has its own shard.' },
      ],
    },
  ],
});
