// @ts-check
// The engine's design messages (`text`) that several levels show.
// Strings are shared as they are; objects are made by functions, so every level gets its own copy.
// Pure: it imports only the formatting helper.
import { fmt } from '../../js/format.js';

/** The message shown when a level's design is finished. */
export const levelComplete = (n) => `Level ${n} complete. Take the quiz.`;

/** The engine's messages for a site behind a load balancer, with web servers and a shared database. */
export const lbText = () => ({
  noWeb: 'Users have no way in. Add a load balancer, connect Users to it, and connect it to the web servers.',
  noDns: 'Browsers cannot find example.com. Connect Users to DNS so the name resolves to the load balancer\'s IP.',
  noBackend: 'The load balancer has no web servers to send requests to, so every request fails. Connect it to the web servers.',
  combinedOver: ' It is not connected to the database, so it keeps its own data and only gets half its capacity.',
  nosqlOver: ' NoSQL cannot join, so each request costs 3 lookups.',
  dnsAnswered: 'DNS answered: example.com is at 203.0.113.10, the load balancer\'s public IP. The device caches it.',
  ipTag: 'IP 203.0.113.10 cached',
});

/** Added to `lbText()` once there are a primary database and replicas. */
export const replicaText = () => ({
  noPrimary: 'Writes have nowhere to go: a web server is connected only to replicas, and replicas refuse writes. Connect it to the primary, or promote a replica.',
  oldPrimarySmall: ' It was the primary and is smaller than the other replicas. Keep every database big enough to take over, or promote it back.',
  copiedWrites: (st) => ` ${fmt(st.copied)} of its ${fmt(st.load)} queries/s are writes copied from the primary.`,
  promoted: ({ oldDown, missing, lagSecs }) => (oldDown
    ? `Replica promoted: it is the primary now and takes the writes. The old primary failed before sending its newest writes, and replicas run about ${lagSecs} second behind, so roughly ${fmt(missing)} writes are missing. Teams recover them from the old primary's log with a recovery script.`
    : 'Replica promoted: it is the primary now, and the old primary copies from it as a replica. In a planned switch like this you let the replica catch up first, so nothing is lost.'),
});

/** The engine's message when the CDN has no origin behind it. */
export const NO_ORIGIN = 'The CDN has no origin: on a miss it has nowhere to fetch a file from, so it never holds any. Connect the CDN to the load balancers.';
