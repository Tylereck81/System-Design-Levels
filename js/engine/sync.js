// Cloud file sync: bytes the block servers move, how fast clients get back after a notification server dies, and the
// monthly storage bill.

/** A new file's average size (MB); share of uploads that edit an existing big file, its size, and the bytes a typical
 * edit changes (MB). */
export const NEW_MB = 0.4;
export const EDIT_SHARE = 0.3;
export const BIG_MB = 20;
export const CHANGED_MB = 1;
/** Compression's saving on the blocks sent (mostly text files here). */
export const COMPRESS = 0.5;
/** MB a second one block server moves (1 Gbps). */
export const BLOCK_MBPS = 125;
/** Clients holding a long-poll connection at the peak; connections one notification server holds; clients a second each
 * surviving server takes back after a failure. */
export const ONLINE = 4e6;
export const POLL_CONNS = 1e6;
export const RECONNECT_RATE = 2000;
/** Data stored (GB) before copies: 10% of the 600 PB allocated. Copies kept per version; versions kept with no limit
 * and with a limit of 10; dedupe's saving; share of data cold; $ per GB-month hot and cold. */
export const STORED_GB = 60e6;
export const REGIONS = 2;
export const ALL_VERSIONS = 2.5;
export const TEN_VERSIONS = 1.3;
export const DEDUPE = 0.15;
export const COLD_SHARE = 0.7;
export const HOT_GB = 0.02;
export const COLD_GB = 0.004;

/** MB the block servers move per upload: new files, plus edits sent whole or as changed blocks, maybe compressed. */
export const mbPerUpload = ({ delta, compress }) => ((1 - EDIT_SHARE) * NEW_MB + EDIT_SHARE * (delta ? CHANGED_MB : BIG_MB)) * (compress ? 1 - COMPRESS : 1);

/** The month's storage bill: data × versions kept × regions, less dedupe, at hot or partly cold prices, × `growth`. */
export function storageBill({ tenVersions, cold, dedupe }, growth = 1) {
  const gb = STORED_GB * growth * (tenVersions ? TEN_VERSIONS : ALL_VERSIONS) * (dedupe ? 1 - DEDUPE : 1) * REGIONS;
  return gb * (cold ? (1 - COLD_SHARE) * HOT_GB + COLD_SHARE * COLD_GB : HOT_GB);
}

/**
 * When one of `servers` notification servers dies, its clients reconnect to the others, each taking RECONNECT_RATE a
 * second: the seconds until every client is back. Also whether the servers hold every connection at all.
 */
export function reconnect(servers) {
  const each = ONLINE / servers;
  return { fits: each <= POLL_CONNS, perServer: each, seconds: (servers - 1) * POLL_CONNS >= ONLINE ? each / ((servers - 1) * RECONNECT_RATE) : Infinity };
}
