// Connection rows that several levels use. `ok` rows (one function per wire) describe a wire the player may draw;
// `bad` tables explain why a wire is refused. Each is made by a function, so every level gets its own copy.
// The bad tables build on each other the way the shop does: load balancer, then replicas, cache and CDN. A level
// spreads the ones it needs, in that order: `{ ...lbBad(), ...replicaBad(), ...cacheBad() }`.
// Pure: nothing here reads game state.
import { ONE_CDN } from './text.js';

export const dnsLookup = () => ({ from: 'users', to: 'dns', label: 'DNS lookup', desc: 'The device asks DNS for the IP of example.com and gets the load balancer\'s public IP, 203.0.113.10. It happens once, then the answer is cached.' });
export const usersToLb = () => ({ from: 'users', to: 'lb', label: 'HTTP requests', desc: 'Users send every request to the load balancer\'s public IP. They never see the web servers.' });
export const lbToWeb = () => ({ from: 'lb', to: 'web', label: 'private IP', desc: 'The load balancer forwards each request to a web server over the private network (10.0.0.x), inside the same data center (about 0.5 ms).' });
export const webToDb = () => ({ from: 'web', to: 'db', label: 'queries', desc: 'The web server reads and writes data in the shared database, inside the same data center (about 0.5 ms round trip).' });

/** Web server to a primary or a replica: writes go to the primary, reads to the replicas. */
export const webToReplicas = () => ({
  from: 'web', to: 'db', label: 'queries', desc: 'The web server queries the database inside the data center (about 0.5 ms round trip).',
  byRole: {
    primary: { label: 'writes', desc: 'The web server sends every write here: new orders, reviews, cart changes. Inside the data center, about 0.5 ms round trip.' },
    replica: { label: 'reads', desc: 'The web server sends reads here, such as product pages and search, shared evenly over the healthy replicas it is connected to. With none healthy, reads go to the primary.' },
  },
});

export const webToCache = () => ({ from: 'web', to: 'cache', label: 'lookups', desc: 'For each read the web server asks the cache first, inside the data center (about 0.5 ms round trip). On a miss it reads the database, then stores the answer in the cache.' });
export const usersToCdn = () => ({ from: 'users', to: 'cdn', label: 'files', desc: 'Pages link their photos, CSS and JavaScript to cdn.example.com, so browsers fetch them from the nearest edge, about 40 ms away. Pages themselves still go to the load balancer.' });
export const cdnToLb = () => ({ from: 'cdn', to: 'lb', label: 'misses', desc: 'The CDN\'s origin. When an edge does not have a file, it fetches it through the load balancer, keeps it for the TTL, then sends it on. The trip to Frankfurt is as long as the shopper\'s own would be.' });
export const webToShards = () => ({ from: 'web', to: 'shards', label: 'queries', desc: 'For each query the web server works out the shard from the shard key, then queries only that shard (about 0.5 ms round trip).' });

/** Refused wires around a load balancer, web servers and one database. */
export const lbBad = () => ({
  'users|web': 'Web servers have private IPs now, so users cannot reach them. Connect Users to the load balancer; it forwards each request to a web server.',
  'dns|lb': 'DNS does not forward traffic. It only tells devices the load balancer\'s IP; then they connect to the load balancer themselves.',
  'dns|web': 'DNS does not forward traffic, and web servers are on private IPs. DNS points devices at the load balancer.',
  'db|users': 'Users never talk to the database. Requests go through the load balancer and a web server.',
  'db|dns': 'The database does not need DNS. DNS is used by your users\' devices to find the load balancer.',
  'db|lb': 'The load balancer only spreads requests over web servers. The web servers talk to the database.',
  'lb|lb': 'Connect both load balancers to Users instead. The first is active; the second waits as a standby and takes over the same IP if the heartbeats stop.',
  'web|web': 'Web servers do not send requests to each other here. Put them all behind the load balancer.',
});

/** Added to `lbBad()` once there are a primary and replicas. */
export const replicaBad = () => ({
  'db|db': 'Replicas copy from the primary by themselves; databases are not connected to each other here. Connect each web server to the primary and to every replica.',
  'db|lb': 'The load balancer only spreads requests over web servers. The web servers decide which database gets each query.',
});

/** Added once there is a cache tier. */
export const cacheBad = () => ({
  'cache|db': 'In cache-aside the cache never talks to the database: the web server reads the database on a miss and fills the cache. Connect each web server to the cache and to the databases.',
  'cache|users': 'Users never reach the cache. Their requests go through the load balancer to a web server, which checks the cache.',
  'cache|lb': 'The load balancer only spreads requests over web servers. The web servers check the cache.',
  'cache|dns': 'The cache does not need DNS. DNS is used by your users\' devices to find the load balancer.',
  'cache|cache': 'Cache servers are not connected to each other. Connect each web server to every cache; it splits the keys over them.',
});

/** Added once there is a CDN. */
export const cdnBad = () => ({
  'cdn|web': 'The web servers have private IPs, so the CDN cannot reach them. Connect the CDN to the load balancers: together they are its origin.',
  'cdn|db': 'The CDN only holds static files, which come from the web servers. Connect it to the load balancers.',
  'cache|cdn': 'The cache holds product data for the web servers. The CDN holds files and fetches them through the load balancers.',
  'cdn|dns': 'The CDN needs no connection to DNS here. Shoppers\' devices look up cdn.example.com the same way they look up example.com.',
  'cdn|cdn': ONE_CDN,
});
