// A web crawler: how fast its downloaders go, how hard it hits each website, and what traps and duplicates cost it.

/** Each downloader runs 100 threads, and a page takes 500 ms to download. */
export const THREADS = 100;
export const PAGE_MS = 500;
/** ms for a DNS lookup, normally and while the DNS provider is slow; many DNS interfaces do one lookup at a time. */
export const DNS_MS = 10;
export const SLOW_DNS_MS = 200;
/** Share of pages whose host a DNS cache doesn't hold yet (new hosts), so they still need a lookup. */
export const DNS_MISS = 0.02;
/** Share of pages that duplicate a page already stored, and the average page size (KB). */
export const DUP_SHARE = 0.29;
export const PAGE_KB = 300;
/** Pages a month in the plan (2 billion), for the storage estimate. */
export const PAGES_MONTH = 2e9;
/** Requests a second a polite crawler sends one host. */
export const POLITE = 1;
/** Share of the frontier's URLs from its busiest host: normally, and when one site's links flood it. */
export const TOP_HOST = 0.02;
export const FLOOD_SHARE = 0.3;
/** Share of the frontier's URLs that are a crawler trap's endless pages, and the new trap links each one holds. */
export const TRAP_SHARE = 0.4;
export const TRAP_LINKS = 10;

/**
 * Pages a second one downloader can fetch: its threads' limit, or the lookups its DNS interface can do one at a time,
 * whichever is lower. A DNS cache leaves only new hosts (DNS_MISS) to look up.
 */
export function downloaderRate({ dnsCache }, { slowDns = false } = {}) {
  const ms = slowDns ? SLOW_DNS_MS : DNS_MS, lookups = dnsCache ? DNS_MISS : 1;
  return Math.min(THREADS * 1000 / PAGE_MS, 1000 / (lookups * ms));
}

/**
 * What the crawl does at `rate` downloads a second. With one FIFO queue, a host gets its share of the downloads; with a
 * queue per host, each host gets POLITE a second and the downloaders work on other hosts meanwhile. A flooded host
 * refuses the crawler (429) once it sends far too much. A trap's endless pages take their share of a FIFO crawl (one
 * request a second with per-host queues), and each adds TRAP_LINKS new URLs to the frontier, unless a URL filter drops
 * them (maximum depth or length). A duplicate check stores only new content.
 * Returns hostRate (requests a second to the busiest host), refused and wasted (shares of downloads), trapAdds (new
 * trap URLs a second) and storageTB (a month, for the plan's pages).
 */
export function crawlOutcome({ perHost, dedup, filter }, { rate, flood = false, trap = false }) {
  const top = flood ? FLOOD_SHARE : TOP_HOST, trapped = trap && !filter;
  const trapRate = trapped ? (perHost ? POLITE : rate * TRAP_SHARE) : 0;
  return {
    hostRate: perHost ? POLITE : rate * top,
    refused: flood && !perHost ? FLOOD_SHARE : 0,
    wasted: rate ? trapRate / rate : 0,
    trapAdds: trapRate * TRAP_LINKS,
    storageTB: PAGES_MONTH * PAGE_KB * (dedup ? 1 - DUP_SHARE : 1) / 1e9,
  };
}
