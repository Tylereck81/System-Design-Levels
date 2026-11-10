// The component catalog: every component type's role, capacity, base time, cost and behaviour flags, the server sizes,
// the time constants, and pure lookups over them (choiceOf, sizesOf, countOf). It imports nothing but constants from
// the pure outcome modules, so any module can import it (js/state.js included) without an import cycle.
import { THREADS, PAGE_MS } from './crawl.js';
import { SEND_MS } from './notify.js';
import { API_CAP, SHARD_CAP } from './typeahead.js';
import { TRANSCODE_RATE } from './video.js';
import { BLOCK_MBPS, POLL_CONNS } from './sync.js';

export const SIZES = {
  S: { cpu: 2, cap: 200, cost: 40 },
  M: { cpu: 4, cap: 400, cost: 90 },
  L: { cpu: 8, cap: 800, cost: 200 },
  XL: { cpu: 16, cap: 1600, cost: 450 },
};
/** Times, rates and shares the simulation uses (and the DNS price). */
export const T = {
  rtt: 40, // ms, internet round trip for users near the data center
  web: 20, // ms, a web server's work for one request
  db: 10, // ms, one SQL query
  dc: 0.5, // ms, round trip between servers inside a data center
  dns: 5, // $ a month for DNS, a provider's service
  nosqlLookup: 3, // ms, one NoSQL lookup
  nosqlLookups: 3, // lookups a request needs when relational data sits in a NoSQL store (no joins)
  lb: 1, // ms, a load balancer's work for one request
  lag: 1, // seconds a replica runs behind its primary
  cache: 0.1, // ms for a lookup in memory
  far: 120, // ms, internet round trip for users far from the data center
  file: 2, // ms a web server takes to send a static file
  cdn: 1, // ms for an edge server to answer from its cache
  scaleAt: 0.6, // how busy the autoscaler lets each server get
  maxCopies: 10, // the most servers one autoscaled group runs
  dcPage: 50, // ms a page spends inside a data center
  dcLag: 1, // seconds data replicated to another data center runs behind
  job: 20000, // ms of one vCPU to process one uploaded file
  publish: 2, // ms to put a message on a queue
  drain: 60, // seconds an autoscaled worker group aims to clear its queue's backlog in
  bigCountry: 0.42, // share of queries from the largest country
  newest: 0.5, // share of queries on the newest accounts' range
  keyLimit: 1, // requests a second an API key may send on average (60 a minute)
  burst: 12, // requests a real user sends in burstSecs seconds while typing a search
  burstSecs: 2, // seconds of that burst
};
/** How many times its base time a request takes on a server that is `u` busy: 1 / (1 − u), and 25 from 96% busy. */
export const qmul = (u) => (u >= 0.96 ? 25 : 1 / (1 - u));

// role: 'client' sends traffic, 'resolver' answers name lookups off the request path,
//       'server' sits on the request path and has a capacity.
// sized: capacity and cost come from the server size (S–XL); `sizes` replaces the default table (e.g. memory sizes).
// kinds: variants that change the work per request (per = operations per request, base = ms per request).
// alone: what happens when the server sends to nothing that holdsData: it keeps the data and does that work
//   itself.
// holdsData: the component keeps the application's data (a database, shards, a NoSQL store, a key-value store,
//   a feed service).
// cap, cost: fixed capacity (req/s) and monthly cost for servers that have no sizes.
// routing 'standby': peers of this type don't share traffic; the first healthy one takes it all
//   and the others wait as standbys (default: healthy peers split traffic evenly).
// forwards: the server only passes requests on; with no server behind it, every request it gets fails.
// algos: routing methods the player can pick for the servers behind it. split 'even' gives each the same share;
//   'capacity' shares in proportion to each server's capacity. defaultAlgo is used when none is chosen.
// replicated: each server is the primary or a replica (n.role), when the level gives roles. A sender whose group
//   holds replicas sends writes (the mission's write share) to the primary and reads to the healthy replicas,
//   or to the primary when none is healthy. Every replica also applies each write the primary serves.
// aside: a cache the sender checks first (cache-aside). Reads it holds are answered there (hit rate from its
//   memory and TTL, see hitRate); misses and writes go on to the sender's other servers. Keys are split evenly
//   over the sender's cache servers; a down cache's keys go straight to the database.
// files: the server sends static files itself (they end there; only pages go on). per = a file's work, as a share of a page's.
// edge: a CDN. Users send it their file requests (pages still go to the load balancer); it answers what its edges hold
//   (see edgeHit) and pulls misses from its origin, the servers it connects to. With no origin it holds nothing.
//   perGB: price of the data it sends, billed on the mission's average file traffic (see costOf).
// stateful: in a mission with sessions, the server keeps each user's session (login, cart) in its own memory, unless it
//   connects to a session store (see holdsSessions). A page that lands on a server without its session fails.
// store: a session store. Every page its sender serves reads the session there first (one lookup), then goes on.
// managed: run by a provider on several machines, so it never counts as a single point of failure.
// flat: the time inside stays at its base up to full capacity (the servers inside scale out to keep it there).
// located: a server in one of the users' regions (its region choice: 'near' or 'far'). DNS with geo: true sends each
//   region to its own healthy servers; plain DNS hands out every address, so each region spreads over all of them.
// syncs: a connection to a server of the same type copies data to it (replication), not requests.
// jobs: in a mission with uploads, the server processes an upload itself (per = its work, as a share of a page's;
//   base = ms) unless it connects to a queue. Then it only publishes a message there, and the request ends.
// queue: a message queue. It answers at once; the servers it connects to (consumers) take its jobs later.
// consumes: a worker. It takes jobs from its queue as fast as its capacity allows; jobs it can't take yet wait
//   in the queue (the backlog, kept by the simulation loop) instead of failing.
// role 'monitor': off the request path; it watches the queues it connects to and alerts when one grows.
// An option with count: n runs n servers of the chosen size (see countOf).
// sharded: one box for a database split into shards (see shardShares): each holds part of the data, by a shard key.
// offload: a store that takes the mission's non-relational share of a server's queries (nonRel) off its database.
// clustered: one box for a cache cluster of `count` servers. Keys are placed by its hashing choice (see clusterLayout);
//   each server's memory holds part of its own keys (see clusterHit). Read like a cache (aside), it is a single point
//   of failure only with one server: a lost server's keys move to the others.
// quorum: a replicated key-value store, one box for its nodes and coordinator. Each key is kept on N replicas; a write
//   waits for W of them and a read for R (see quorumOutcome). Its cost is per replica (cost × N).
// ids: a unique ID generator, one box for its servers. Each request asks it for WORKLOAD.idsPerRequest new IDs; its
//   method sets what they look like and how many it makes (see idOutcome). Its cost is per server, none for UUIDs (they
//   are made in the web servers). A single point of failure only with one server.
// limits: a rate limiter. It checks each request against its API key's quota (see limiterRule), answers the excess with
//   429, and forwards the rest. Connected to a store, it keeps its counters there, shared with the other limiters.
// algos with sticky: true keep each user on the server they started on, so sessions held in memory are always found.
// choices: settings the player picks per server, stored as n[key]; each lists its options and a default.
//   staleBy names the choice whose option says (stale: true) that a changed item is served until its TTL ends.
//   An option with auto: true makes the server an autoscaled group (see copiesFor).
// Failure mode for every server: when down it serves nothing; its share moves to healthy peers,
// and with no healthy peer every request sent to it fails.
export const COMPONENTS = {
  // queues: a web crawler's URL frontier (see crawl.js): one FIFO queue, or a queue per host. Other levels ignore it.
  users: { role: 'client', choices: { queues: { options: { fifo: {}, host: { perHost: true } }, default: 'fifo' } } },
  dns: { role: 'resolver', cost: T.dns, choices: { routing: { options: { rr: {}, geo: { geo: true } }, default: 'rr' } } },
  lb: { role: 'server', cap: 5000, base: T.lb, cost: 20, unit: 'req/s', routing: 'standby', forwards: true,
    algos: { rr: { split: 'even' }, wrr: { split: 'capacity' }, lc: { split: 'capacity' }, sticky: { split: 'even', sticky: true } }, defaultAlgo: 'rr' },
  web: {
    role: 'server', sized: true, base: T.web, unit: 'req/s', alone: { capFactor: 0.5, base: T.web + T.db }, files: { per: T.file / T.web, base: T.file },
    jobs: { per: 2000, base: T.job }, // a web server of a size does as many jobs as a worker of that size
    stateful: true,
    links: true, // it carries a URL shortener's settings (see links.js), read by the link workload
    choices: {
      scaling: { options: { fixed: {}, auto: { auto: true } }, default: 'fixed' },
      // A URL shortener's settings (see links.js); levels that don't list them keep the defaults, which change nothing.
      redirect: { options: { 301: { permanent: true }, 302: {} }, default: '302' },
      code: { options: { base62: {}, hash: {}, bloom: {} }, default: 'base62' },
      limit: { options: { none: {}, account: { limit: true } }, default: 'none' },
    },
  },
  session: { role: 'server', cap: 10000, base: T.nosqlLookup, cost: 150, unit: 'lookups/s', store: true, managed: true },
  queue: { role: 'server', cap: 10000, base: T.publish, cost: 50, unit: 'messages/s', queue: true, managed: true },
  worker: {
    role: 'server', sized: true, base: T.job, unit: 'jobs/s', consumes: true,
    sizes: { S: { cpu: 2, cap: 2000 / T.job, cost: 40 }, M: { cpu: 4, cap: 4000 / T.job, cost: 90 }, L: { cpu: 8, cap: 8000 / T.job, cost: 200 }, XL: { cpu: 16, cap: 16000 / T.job, cost: 450 } },
    choices: { scaling: { options: { 1: { count: 1 }, 2: { count: 2 }, 4: { count: 4 }, 8: { count: 8 }, auto: { auto: true } }, default: '1' } },
  },
  monitor: { role: 'monitor', cost: 30 },
  shards: {
    role: 'server', sized: true, base: T.db, unit: 'queries/s', sharded: true, holdsData: true,
    choices: {
      count: { options: { 2: { count: 2 }, 3: { count: 3 }, 4: { count: 4 }, 8: { count: 8 } }, default: '2' },
      key: { options: { account: {}, country: {}, date: {} }, default: 'account' },
      hot: { options: { stay: {}, own: { own: 3 } }, default: 'stay' },
    },
  },
  limiter: {
    role: 'server', cap: 6000, base: T.lb, cost: 100, unit: 'req/s', forwards: true, limits: true,
    choices: {
      algo: { options: { token: {}, leaky: {}, fixed: {}, slog: {}, scount: {} }, default: 'token' },
      bucket: { options: { 4: { size: 4 }, 12: { size: 12 }, 60: { size: 60 } }, default: '4' },
      refill: { options: { 1: { rate: 1 }, 5: { rate: 5 } }, default: '1' },
    },
  },
  ring: {
    role: 'server', sized: true, base: T.cache, unit: 'lookups/s', aside: true, clustered: true,
    sizes: {
      S: { mem: 2, cap: 10000, cost: 20 },
      M: { mem: 4, cap: 10000, cost: 40 },
      L: { mem: 8, cap: 10000, cost: 80 },
      XL: { mem: 16, cap: 10000, cost: 160 },
    },
    choices: {
      count: { options: { 3: { count: 3 }, 5: { count: 5 }, 6: { count: 6 }, 8: { count: 8 }, 10: { count: 10 } }, default: '5' },
      hashing: { options: { mod: { mod: true }, ring: { vnodes: 1 }, v10: { vnodes: 10 }, v100: { vnodes: 100 }, v500: { vnodes: 500 } }, default: 'mod' },
    },
  },
  kv: {
    role: 'server', cap: 20000, base: 2, cost: 150, unit: 'requests/s', quorum: true, holdsData: true,
    choices: {
      n: { options: { 1: { n: 1 }, 3: { n: 3 }, 5: { n: 5 } }, default: '3' },
      w: { options: { 1: { q: 1 }, 2: { q: 2 }, 3: { q: 3 }, 4: { q: 4 }, 5: { q: 5 } }, default: '1' },
      r: { options: { 1: { q: 1 }, 2: { q: 2 }, 3: { q: 3 }, 4: { q: 4 }, 5: { q: 5 } }, default: '1' },
      mode: { options: { strict: {}, sloppy: { sloppy: true } }, default: 'strict' },
    },
  },
  idgen: {
    role: 'server', cost: 100, unit: 'IDs/s', ids: true,
    choices: {
      method: { options: { step: {}, uuid: {}, ticket: {}, snow: {} }, default: 'uuid' },
      servers: { options: { 1: { count: 1 }, 2: { count: 2 }, 3: { count: 3 }, 4: { count: 4 }, 5: { count: 5 } }, default: '1' },
      clock: { options: { keep: {}, wait: { wait: true } }, default: 'keep' },
    },
  },
  // A web crawler (see crawl.js). download: fetches pages, `count` machines; its DNS lookups go one at a time unless
  //   it keeps a DNS cache. parse: checks each page and extracts its links; with dedup it stores only new content, and
  //   with a URL filter it drops links deeper or longer than a limit. The content storage keeps the pages.
  downloader: {
    role: 'server', cap: THREADS * 1000 / PAGE_MS, base: PAGE_MS, cost: 200, unit: 'pages/s', crawl: 'download',
    choices: {
      count: { options: { 1: { count: 1 }, 2: { count: 2 }, 4: { count: 4 }, 5: { count: 5 }, 6: { count: 6 }, 8: { count: 8 } }, default: '4' },
      dns: { options: { lookup: {}, cache: { cache: true } }, default: 'lookup' },
    },
  },
  parser: {
    role: 'server', cap: 2000, base: 5, cost: 150, unit: 'pages/s', crawl: 'parse',
    choices: {
      dedup: { options: { off: {}, on: { on: true } }, default: 'off' },
      filter: { options: { off: {}, on: { on: true } }, default: 'off' },
    },
  },
  // A notification system (see notify.js). The notification server can check opt-outs and limit each user's
  //   notifications; the message queues are one shared queue or one per channel; the workers send to the providers,
  //   with a notification log to retry from and a duplicate check. notify: which of the three a type is.
  notifier: {
    role: 'server', cap: 2000, base: 5, cost: 150, unit: 'requests/s', notify: 'server',
    choices: { check: { options: { off: {}, on: { on: true } }, default: 'off' }, limit: { options: { off: {}, on: { on: true } }, default: 'off' } },
  },
  nqueue: { role: 'server', cap: 100000, base: 2, cost: 50, unit: 'messages/s', managed: true, notify: 'queue', choices: { layout: { options: { one: {}, channel: { perChannel: true } }, default: 'one' } } },
  nworker: {
    role: 'server', cap: 1000 / SEND_MS, base: SEND_MS, cost: 90, unit: 'notifications/s', notify: 'worker',
    choices: {
      count: { options: { 2: { count: 2 }, 3: { count: 3 }, 4: { count: 4 }, 5: { count: 5 }, 6: { count: 6 }, 8: { count: 8 } }, default: '4' },
      log: { options: { off: {}, on: { on: true } }, default: 'off' },
      dedupe: { options: { off: {}, on: { on: true } }, default: 'off' },
    },
  },
  // A news feed (see feed.js). The feed service fans posts out (on write, on read, or a hybrid for stars) with its
  //   fanout workers, optionally skipping inactive users; the feed cache keeps each feed as IDs or as whole posts, and
  //   costs $2 a month per GB it holds.
  feedsvc: {
    role: 'server', cap: 20000, base: 5, cost: 300, unit: 'requests/s', feed: true, holdsData: true,
    choices: {
      fanout: { options: { read: {}, write: {}, hybrid: {} }, default: 'read' },
      workers: { options: { 1: { count: 1 }, 2: { count: 2 }, 4: { count: 4 }, 8: { count: 8 } }, default: '2' },
      inactive: { options: { all: {}, skip: { skip: true } }, default: 'all' },
    },
  },
  feedcache: { role: 'server', cap: 1000000, base: 1, cost: 0, unit: 'lookups/s', managed: true, feedCache: true, choices: { store: { options: { posts: {}, ids: { ids: true } }, default: 'posts' } } },
  // A chat system (see chat.js). The chat servers hold users' connections (polling, long polling or WebSocket),
  //   find a new server through service discovery when one dies, and track presence; the message store keeps every
  //   message and can push a notification to offline recipients. chat: which of the two a type is.
  chatsrv: {
    role: 'server', cap: 20000, base: 5, cost: 300, unit: 'messages/s', chat: 'server',
    choices: {
      count: { options: { 2: { count: 2 }, 3: { count: 3 }, 4: { count: 4 }, 5: { count: 5 }, 6: { count: 6 } }, default: '3' },
      protocol: { options: { poll: {}, long: {}, ws: {} }, default: 'poll' },
      reconnect: { options: { fixed: {}, discovery: { on: true } }, default: 'fixed' },
      presence: { options: { disconnect: {}, heartbeat: { on: true } }, default: 'disconnect' },
    },
  },
  msgstore: { role: 'server', cap: 1000000, base: 3, cost: 500, unit: 'messages/s', managed: true, chat: 'store', choices: { offline: { options: { wait: {}, push: { on: true } }, default: 'wait' } } },
  // Search autocomplete (see typeahead.js). API servers answer keystroke requests and can let browsers cache them;
  //   the trie cache finds the top 5 for a prefix (a table query, a trie walk, or the 5 kept per node), split into
  //   shards by letter range or by a shard map, rebuilt from the logs weekly, daily or hourly.
  tapi: {
    role: 'server', cap: API_CAP, base: 5, cost: 200, unit: 'requests/s', typeahead: 'api',
    choices: {
      count: { options: { 2: { count: 2 }, 3: { count: 3 }, 4: { count: 4 }, 5: { count: 5 }, 6: { count: 6 }, 8: { count: 8 } }, default: '4' },
      browser: { options: { off: {}, on: { on: true } }, default: 'off' },
    },
  },
  trie: {
    role: 'server', cap: SHARD_CAP, base: 1, cost: 300, unit: 'lookups/s', typeahead: 'trie',
    choices: {
      method: { options: { table: {}, trie: {}, topk: {} }, default: 'table' },
      shards: { options: { 1: { count: 1 }, 2: { count: 2 }, 3: { count: 3 }, 4: { count: 4 } }, default: '3' },
      split: { options: { letter: {}, map: { on: true } }, default: 'letter' },
      rebuild: { options: { weekly: { cost: 100 }, daily: { cost: 200 }, hourly: { cost: 500 } }, default: 'weekly' },
    },
  },
  // A video platform (see video.js). The upload service takes videos through the API servers or by pre-signed URL,
  //   whole or in resumable chunks; transcoding servers encode them, retrying a dead worker's tasks or not; delivery
  //   streams them from the CDN, or only the popular ones (the rest from your own storage servers). Its cost is the
  //   month's streaming bill.
  vupload: {
    role: 'server', cap: 1000, base: 50, cost: 800, unit: 'videos/s', video: 'upload',
    choices: { url: { options: { api: {}, presigned: { on: true } }, default: 'api' }, chunks: { options: { whole: {}, chunked: { on: true } }, default: 'whole' } },
  },
  transcoder: {
    role: 'server', cap: TRANSCODE_RATE, base: 50, cost: 500, unit: 'videos/s', video: 'transcode',
    choices: {
      workers: { options: { 6: { count: 6 }, 8: { count: 8 }, 10: { count: 10 }, 11: { count: 11 }, 12: { count: 12 } }, default: '10' },
      retry: { options: { off: {}, on: { on: true } }, default: 'off' },
    },
  },
  vserve: { role: 'server', cap: 1000, base: 20, cost: 0, unit: 'videos/s', managed: true, video: 'serve', choices: { deliver: { options: { cdn: {}, popular: { on: true } }, default: 'cdn' } } },
  // Cloud file sync (see sync.js). Block servers move file blocks (whole files or only changed blocks, maybe
  //   compressed); notification servers hold clients' long-poll connections; cloud storage keeps the blocks in two
  //   regions, with a version limit, cold storage and dedupe as choices. Its cost is the month's storage bill.
  blocksrv: {
    role: 'server', cap: BLOCK_MBPS, base: 10, cost: 300, unit: 'MB/s', sync: 'block',
    choices: {
      count: { options: { 2: { count: 2 }, 3: { count: 3 }, 4: { count: 4 }, 6: { count: 6 } }, default: '2' },
      delta: { options: { whole: {}, delta: { on: true } }, default: 'whole' },
      compress: { options: { off: {}, on: { on: true } }, default: 'off' },
    },
  },
  pollsrv: {
    role: 'server', cap: POLL_CONNS, base: 1, cost: 400, unit: 'connections', sync: 'poll',
    choices: { count: { options: { 4: { count: 4 }, 5: { count: 5 }, 6: { count: 6 }, 7: { count: 7 }, 8: { count: 8 } }, default: '4' } },
  },
  blobstore: {
    role: 'server', cap: 1e9, base: 5, cost: 0, unit: 'uploads/s', managed: true, sync: 'store',
    choices: {
      versions: { options: { all: {}, ten: { on: true } }, default: 'all' },
      cold: { options: { off: {}, on: { on: true } }, default: 'off' },
      dedupe: { options: { off: {}, on: { on: true } }, default: 'off' },
    },
  },
  provider: { role: 'server', cap: 100000, base: 50, cost: 0, unit: 'notifications/s', managed: true },
  contentstore: { role: 'server', cap: 5000, base: 10, cost: 300, unit: 'pages/s', managed: true },
  counter: { role: 'server', cap: 50000, base: T.cache, cost: 60, unit: 'ops/s', store: true, managed: true },
  nosql: { role: 'server', cap: 20000, base: T.nosqlLookup, cost: 200, unit: 'lookups/s', offload: true, managed: true, holdsData: true },
  // A whole data center: load balancers, autoscaled web servers, caches, databases and a session store.
  dc: {
    role: 'server', sized: true, base: T.dcPage, unit: 'pages/s', flat: true, located: true, syncs: true, files: { per: T.file / T.web, base: T.file },
    sizes: { S: { cap: 800, cost: 700 }, M: { cap: 1600, cost: 1200 }, L: { cap: 2400, cost: 1700 } },
    choices: { region: { options: { near: {}, far: {} }, default: 'near' } },
  },
  cache: {
    role: 'server', sized: true, base: T.cache, unit: 'lookups/s', aside: true,
    sizes: {
      S: { mem: 2, cap: 10000, cost: 20 },
      M: { mem: 4, cap: 10000, cost: 40 },
      L: { mem: 8, cap: 10000, cost: 80 },
      XL: { mem: 16, cap: 10000, cost: 160 },
    },
    choices: {
      ttl: { options: { 10: { secs: 10 }, 60: { secs: 60 }, 600: { secs: 600 }, 3600: { secs: 3600 } }, default: '60' },
      onWrite: { options: { ttl: { stale: true }, delete: {} }, default: 'ttl' },
    },
    staleBy: 'onWrite',
  },
  cdn: {
    role: 'server', cap: 100000, base: T.cdn, unit: 'files/s', edge: true, perGB: 0.02,
    choices: {
      ttl: { options: { 60: { secs: 60 }, 600: { secs: 600 }, 3600: { secs: 3600 }, 86400: { secs: 86400 } }, default: '60' },
      // purge clears the edges, but browsers keep their own copy until its TTL ends, so it still counts as stale.
      onChange: { options: { ttl: { stale: true }, purge: { stale: true }, version: {} }, default: 'ttl' },
      fallback: { options: { none: {}, origin: { fallback: true } }, default: 'none' },
    },
    staleBy: 'onChange',
  },
  db: {
    role: 'server', sized: true, replicated: true, holdsData: true,
    kinds: {
      sql: { per: 1, base: T.db, unit: 'queries/s' },
      nosql: { per: T.nosqlLookups, base: T.nosqlLookup * T.nosqlLookups, unit: 'lookups/s' },
    },
  },
};

/** The option a server has picked for one of its choices (its default when none is picked). */
export function choiceOf(n, key) {
  const ch = COMPONENTS[n.type].choices[key];
  return ch.options[n[key]] ? n[key] : ch.default;
}
/** The option object behind choiceOf: what the picked option sets (a count, `on`, a cost…). */
export const optionOf = (n, key) => COMPONENTS[n.type].choices[key].options[choiceOf(n, key)];
/** True when `n` exists and its picked option for `key` turns that choice on. */
export const isOn = (n, key) => !!n && !!optionOf(n, key).on;
/** The catalog entry for node `n`'s type; an empty entry when `n` is missing or its type is unknown. */
export const componentOf = (n) => COMPONENTS[n?.type] ?? {};
/** A predicate: true for a node whose catalog entry has flag `key` set. */
export const hasFlag = (key) => (n) => !!componentOf(n)[key];
export const sizesOf = (type) => COMPONENTS[type]?.sizes ?? SIZES;
/** How many servers a fixed choice runs (1 unless its scaling option gives a count). */
export const countOf = (n) => componentOf(n).choices?.scaling?.options[choiceOf(n, 'scaling')].count || 1;
/** The first node whose type has catalog flag `key` (equal to `value`, when given); null when there is none. */
export function byFlag(nodes, key, value) {
  return nodes.find((n) => {
    const flag = componentOf(n)[key];
    return value === undefined ? !!flag : flag === value;
  }) || null;
}
