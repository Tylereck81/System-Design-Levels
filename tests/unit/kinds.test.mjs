// Component kinds (js/engine/kinds/): they import only the catalog and modules that import nothing, so components.js
// and model.js can import them without a cycle and they load in Node without a level or a page. Costs and redundancy
// below are worked out by hand from each type's catalog entry (js/engine/catalog.js) at its default choices.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ENGINE, importsOf } from './imports.mjs';

const DIR = new URL('kinds/', ENGINE);
const FILES = readdirSync(fileURLToPath(DIR)).filter((f) => f.endsWith('.js'));
// Loaded inside the tests, so a kind file that breaks the boundary fails the first test by name, not the whole file.
const kinds = () => import(new URL('index.js', DIR));

test('kind files import only the catalog and modules that import nothing', () => {
  assert.ok(FILES.includes('index.js') && FILES.length > 1);
  for (const file of FILES) {
    const url = new URL(file, DIR);
    for (const spec of importsOf(url)) {
      if (spec === '../catalog.js') continue;
      if (file === 'index.js' && spec.startsWith('./')) continue; // the index lists the kind files, checked themselves
      assert.deepEqual(importsOf(new URL(spec, url)), [], `${file}: ${spec} must not import anything`);
    }
  }
});

test('every kind has its own id and describes at least one component type', async () => {
  const [{ KINDS }, { COMPONENTS }] = await Promise.all([kinds(), import(new URL('catalog.js', ENGINE))]);
  const ids = KINDS.map((k) => k.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const k of KINDS) assert.ok(Object.values(COMPONENTS).some((c) => k.matches(c)), `${k.id} matches no component type`);
  // loadPhase, costOf and countSpofs have no per-type branch, so every type with its own load rule has a kind with a step.
  const ownRule = (c) => c.consumes || c.sharded || c.clustered || c.quorum || c.ids || c.crawl || c.limits;
  for (const [type, c] of Object.entries(COMPONENTS)) {
    assert.ok(KINDS.filter((k) => k.matches(c)).length <= 1, `${type} matches two kinds: the second would never run`);
    if (ownRule(c)) assert.ok(KINDS.find((k) => k.matches(c))?.step, `${type} has its own load rule but no kind step`);
  }
});

test('each result field the kinds report has one owner and a value before any component reports it', async () => {
  const { KINDS, RESULT_DEFAULTS, COMBINE } = await kinds();
  const fields = KINDS.flatMap((k) => Object.keys(k.resultDefaults || {}));
  assert.equal(new Set(fields).size, fields.length, 'two kinds report the same field with their own default');
  assert.deepEqual(Object.keys(RESULT_DEFAULTS).sort(), [...fields].sort());
  assert.equal(RESULT_DEFAULTS.shardCount, 0);
  assert.equal(RESULT_DEFAULTS.keyQuota, null);
  // Combining: from the default (null or 0, or none for limitShared), then a second component's value.
  assert.equal(COMBINE.max(COMBINE.max(null, 0.4), 0.2), 0.4);
  assert.equal(COMBINE.sum(COMBINE.sum(0, 2), 3), 5);
  assert.equal(COMBINE.and(COMBINE.and(undefined, true), false), false);
  assert.equal(COMBINE.and(COMBINE.and(undefined, false), true), false);
  assert.equal(COMBINE.set(7, 3), 3);
});

test('kindOf finds a type\'s kind by its catalog flag, and null for generic or unknown types', async () => {
  const { kindOf } = await kinds();
  assert.equal(kindOf({ type: 'nworker' }).id, 'notify-worker');
  assert.equal(kindOf({ type: 'trie' }).id, 'typeahead-trie');
  assert.equal(kindOf({ type: 'vserve' }).id, 'video-serve');
  assert.equal(kindOf({ type: 'worker' }).id, 'worker');
  assert.equal(kindOf({ type: 'downloader' }).id, 'crawl-download');
  assert.equal(kindOf({ type: 'parser' }).id, 'crawl-parse');
  assert.equal(kindOf({ type: 'limiter' }).id, 'rate-limiter');
  assert.equal(kindOf({ type: 'notifier' }), null); // a notification server follows the generic rules
  assert.equal(kindOf({ type: 'web' }), null);
  assert.equal(kindOf({ type: 'no-such-type' }), null);
});

test('a kind prices its type from its settings', async () => {
  const { kindOf } = await kinds();
  const cost = (n, nodes = [n]) => kindOf(n).cost(n, 0, nodes);
  assert.equal(cost({ type: 'nworker' }), 360);          // $90 × 4 workers
  assert.equal(cost({ type: 'chatsrv' }), 900);          // $300 × 3 servers
  assert.equal(cost({ type: 'tapi' }), 800);             // $200 × 4 API servers
  assert.equal(cost({ type: 'trie' }), 1000);            // $300 × 3 shards + $100 weekly rebuild
  assert.equal(cost({ type: 'trie', rebuild: 'hourly', shards: '1' }), 800); // $300 × 1 + $500
  assert.equal(cost({ type: 'transcoder' }), 5000);      // $500 × 10 workers
  assert.equal(cost({ type: 'blocksrv' }), 600);         // $300 × 2 servers
  assert.equal(cost({ type: 'pollsrv' }), 1600);         // $400 × 4 servers
  assert.equal(cost({ type: 'feedsvc' }), 500);          // $300 + $100 × 2 fanout workers
  // Streaming: 24M views a day × 0.25 GB × 30 days = 180M GB a month, at $0.02 from the CDN; popular-only sends 80%
  // from the CDN and 20% from own servers at $0.002: 180M × (0.016 + 0.0004) = $2,952,000.
  assert.equal(cost({ type: 'vserve' }), 3600000);
  assert.equal(cost({ type: 'vserve', deliver: 'popular' }), 2952000);
  // The feed cache holds feeds only when posts are fanned out on write: 15M users × 500 entries × 16 bytes (IDs) =
  // 120 GB at $2 = $240. Built at read time (the default, or with no feed service), it holds nothing.
  const cache = { type: 'feedcache', store: 'ids' };
  assert.equal(cost(cache, [cache, { type: 'feedsvc', fanout: 'write' }]), 240);
  assert.equal(cost(cache, [cache, { type: 'feedsvc' }]), 0);
  assert.equal(cost(cache), 0);
  assert.equal(cost({ type: 'shards', size: 'M' }), 180);             // $90 × 2 shards
  assert.equal(cost({ type: 'shards', size: 'M', hot: 'own' }), 450); // $90 × (2 + 3 shards for the hot accounts)
  assert.equal(cost({ type: 'shards' }), 0);                          // no size picked yet
  assert.equal(cost({ type: 'ring', size: 'S' }), 100);               // $20 × 5 servers
  assert.equal(cost({ type: 'kv' }), 450);                            // $150 × 3 replicas
  assert.equal(cost({ type: 'kv', n: '5' }), 750);                    // $150 × 5 replicas
  assert.equal(cost({ type: 'idgen' }), 0);                           // UUIDs are made in the web servers
  assert.equal(cost({ type: 'idgen', method: 'snow', servers: '3' }), 300); // $100 × 3 servers
  assert.equal(cost({ type: 'downloader' }), 800);                    // $200 × 4 machines
});

test('a kind is redundant when one of its machines can fail', async () => {
  const { kindOf } = await kinds();
  const redundant = (n) => !!kindOf(n).redundant?.(n);
  assert.equal(redundant({ type: 'trie' }), true);              // 3 shards
  assert.equal(redundant({ type: 'trie', shards: '1' }), false); // one shard holds every prefix
  assert.equal(redundant({ type: 'chatsrv', count: '2' }), true);
  assert.equal(redundant({ type: 'vupload' }), true);           // it runs on the API servers
  assert.equal(redundant({ type: 'feedsvc' }), false);          // one feed service
  assert.equal(redundant({ type: 'ring', count: '3' }), true);  // a lost server's keys move to the others
  assert.equal(redundant({ type: 'kv' }), true);                // 3 replicas
  assert.equal(redundant({ type: 'kv', n: '1' }), false);
  assert.equal(redundant({ type: 'idgen' }), true);             // UUIDs: no generator server to fail
  assert.equal(redundant({ type: 'idgen', method: 'ticket' }), false); // one ticket server
  assert.equal(redundant({ type: 'idgen', method: 'ticket', servers: '2' }), true);
  assert.equal(redundant({ type: 'downloader', count: '1' }), false);
  assert.equal(redundant({ type: 'downloader' }), true);        // 4 machines
  assert.equal(redundant({ type: 'shards', size: 'M' }), false); // one box: its shards do not stand in for each other
  assert.equal(redundant({ type: 'limiter' }), false);
});

test('a kind adds no inspector rows when its step did not run (its stat lacks its fields)', async () => {
  const { KINDS } = await kinds();
  for (const k of KINDS.filter((x) => x.liveRows && !x.liveRowsOnly)) assert.deepEqual(k.liveRows({ load: 1, cap: 1 }, {}), [], k.id);
  // A kind whose rows replace the generic ones always runs its own step, so it has no outcome to switch it off.
  for (const k of KINDS.filter((x) => x.liveRowsOnly)) assert.equal(k.outcome, undefined, k.id);
});

test('notification workers: a row for each problem only while it happens', async () => {
  const { KINDS } = await kinds();
  const rows = (o) => KINDS.find((k) => k.id === 'notify-worker').liveRows({ notify: o }).filter(Boolean);
  const calm = { workers: 4, perChannel: true, retry: true, lost: 0, dup: 0, waiting: 0 };
  assert.deepEqual(rows(calm), [{ value: '4 workers', label: 'split over a queue per channel, with a notification log', wide: true }]);
  // 0.05 → 5%, 0.124 → 12%, 0.006 → 1% (toFixed(0) rounds)
  assert.deepEqual(rows({ ...calm, lost: 0.05, dup: 0.124, waiting: 0.006 }).slice(1), [
    { value: '5%', label: 'of notifications lost', tone: 'bad', wide: true },
    { value: '12%', label: 'sent twice', tone: 'warn', wide: true },
    { value: '1%', label: 'waiting in the SMS queue for a retry', wide: true },
  ]);
});
