// A web crawler (crawl.js): its settings, the downloaders and the parser.
import { COMPONENTS, choiceOf, optionOf, isOn, qmul } from '../catalog.js';
import { downloaderRate, DUP_SHARE } from '../crawl.js';

/** A crawler downloader's machines and pages a second each, given whether the DNS provider is slow. */
export function downloaderOf(n, slowDns = false) {
  const count = optionOf(n, 'count').count, dnsCache = !!optionOf(n, 'dns').cache;
  return { count, dnsCache, per: downloaderRate({ dnsCache }, { slowDns }) };
}
/** A crawler's settings: per-host queues on its frontier (`users`), and its parser's duplicate check and URL filter. */
export function crawlSettingsOf(users, parser) {
  return { perHost: !!users && choiceOf(users, 'queues') === 'host', dedup: isOn(parser, 'dedup'), filter: isOn(parser, 'filter') };
}

/**
 * The downloaders: `count` machines at their pages a second each (slower while an experiment's `slowDns` flag is on).
 * A flooded host refuses its share of a FIFO crawl (the crawl outcome). What they fetch goes on to the parser. Each
 * machine costs the type's price.
 */
export const downloader = {
  id: 'crawl-download',
  matches: (c) => c.crawl === 'download',
  step(n, L, ctx) {
    const c = COMPONENTS[n.type], d = downloaderOf(n, ctx.flag('slowDns')), cap = d.per * d.count;
    const refused = ctx.outcomes.crawl ? ctx.outcomes.crawl.refused : 0, s = Math.min(L, cap) * (1 - refused);
    ctx.settle(n, s, { load: L, cap, util: L / cap, ms: c.base, mult: 1, base: c.base, unit: c.unit, drop: 1 - s / L, crawl: { ...d, refused } });
    ctx.forward(n, s);
  },
  cost: (n) => COMPONENTS[n.type].cost * downloaderOf(n).count,
  redundant: (n) => downloaderOf(n).count > 1,
};

/** The parser: checks each page; with a duplicate check, only new content goes on to storage. */
export const parser = {
  id: 'crawl-parse',
  matches: (c) => c.crawl === 'parse',
  step(n, L, ctx) {
    const c = COMPONENTS[n.type], set = crawlSettingsOf(null, n), s = Math.min(L, c.cap), u = L / c.cap, mult = qmul(u);
    ctx.settle(n, s, { load: L, cap: c.cap, util: u, ms: c.base * mult, mult, base: c.base, unit: c.unit, drop: 1 - s / L });
    ctx.forward(n, s * (set.dedup ? 1 - DUP_SHARE : 1));
  },
};
