// Level workloads: the maths a level adds on top of the generic simulation, one entry per level `workload` key.
// model() works them out once per call and passes them down; nothing here keeps state between calls.
//
// An entry: { field, active(workload), at(qps, env), shape? }
//   field   the model result's field for its outcome (null while the level does not use it)
//   active  whether the level's `workload` turns it on
//   at      its outcome for `qps` requests a second, from the design and the running experiments (env)
//   shape   how the outcome changes the traffic the servers see: { qps, writes?, cacheHot? }
// A level turns on at most one entry (tests/unit/levels.test.mjs checks it). A field must not be the name of another
// model result field: model() spreads the outcomes into its result.
import { byFlag } from './catalog.js';
import { roleOf, linkSettingsOf, crawlSettingsOf } from './components.js';
import { notifySettingsOf } from './kinds/notify.js';
import { feedSettingsOf } from './kinds/feed.js';
import { chatSettingsOf } from './kinds/chat.js';
import { typeaheadSettingsOf } from './kinds/typeahead.js';
import { videoSettingsOf } from './kinds/video.js';
import { syncSettingsOf } from './kinds/sync.js';
import { linkTraffic } from './links.js';
import { crawlOutcome } from './crawl.js';
import { notifyOutcome } from './notify.js';
import { feedOutcome } from './feed.js';
import { chatOutcome } from './chat.js';
import { typeaheadOutcome } from './typeahead.js';
import { videoOutcome } from './video.js';
import { mbPerUpload, storageBill, reconnect } from './sync.js';

export const WORKLOADS = [
  {
    field: 'link', // a URL shortener (links.js): the clicks and new links that reach its servers
    active: (w) => w.repeatClicks != null,
    at(q, env) {
      const web = byFlag(env.nodes, 'links');
      if (!web) return null;
      const set = linkSettingsOf(web);
      const traffic = {
        qps: q, writes: env.mission.writes || 0, repeat: env.workload.repeatClicks, viral: env.total('viral'), bulk: env.total('bulk'),
      };
      return { ...linkTraffic(set, traffic), code: set.code };
    },
    shape: (o) => ({ qps: o.qps, writes: o.writes, cacheHot: o.hot }), // clicks on a viral link always find it cached
  },
  {
    field: 'crawl', // a web crawler (crawl.js)
    active: (w) => !!w.crawl,
    at(q, env) {
      const users = env.nodes.find((n) => roleOf(n) === 'client'), parser = byFlag(env.nodes, 'crawl', 'parse');
      return crawlOutcome(crawlSettingsOf(users, parser), { rate: q, flood: env.flag('flood'), trap: env.flag('trap') });
    },
  },
  {
    field: 'notify', // a notification system (notify.js)
    active: (w) => !!w.notify,
    at(q, env) {
      const [server, queue, worker] = ['server', 'queue', 'worker'].map((role) => byFlag(env.nodes, 'notify', role));
      const set = notifySettingsOf(server, queue, worker);
      return { ...notifyOutcome(set, { rate: q, smsDown: env.flag('smsDown'), blast: env.flag('blast'), crash: env.flag('crash') }), ...set };
    },
  },
  {
    field: 'feed', // a news feed (feed.js)
    active: (w) => !!w.feed,
    at(q, env) {
      const set = feedSettingsOf(byFlag(env.nodes, 'feed'), byFlag(env.nodes, 'feedCache')), w = env.mission.writes || 0;
      const posts = q * w * (env.flag('postSurge') ? env.workload.surge || 1 : 1);
      return { ...feedOutcome(set, { reads: q * (1 - w), posts, star: env.flag('star') }), ...set };
    },
  },
  {
    field: 'chat', // a chat system (chat.js)
    active: (w) => !!w.chat,
    at(q, env) {
      const set = chatSettingsOf(byFlag(env.nodes, 'chat', 'server'), byFlag(env.nodes, 'chat', 'store'));
      return { ...chatOutcome(set, { msgs: q, dies: env.flag('serverDies'), night: env.flag('night'), tunnel: env.flag('tunnel') }), ...set };
    },
  },
  {
    field: 'video', // a video platform (video.js)
    active: (w) => !!w.video,
    at(q, env) {
      const set = videoSettingsOf(...['upload', 'transcode', 'serve'].map((role) => byFlag(env.nodes, 'video', role)));
      const growth = env.flag('growth') ? env.workload.growth || 1 : 1;
      return { ...videoOutcome(set, { rate: q, patchy: env.flag('patchy'), dies: env.flag('workerDies'), growth }), ...set };
    },
  },
  {
    field: 'sync', // cloud file sync (sync.js); it does not depend on the request rate
    active: (w) => !!w.sync,
    at(q, env) {
      const set = syncSettingsOf(...['block', 'poll', 'store'].map((role) => byFlag(env.nodes, 'sync', role)));
      const re = reconnect(set.polls), dies = env.flag('pollDies'), growth = env.flag('growth') ? env.workload.growth || 1 : 1;
      return {
        ...set, mbPerUpload: mbPerUpload(set), bill: storageBill(set, growth),
        reconnectS: dies ? re.seconds : 0, connsPerServer: re.perServer, fits: re.fits,
      };
    },
  },
  {
    field: 'typeahead', // search autocomplete (typeahead.js): browsers answer some keystrokes from their own cache
    active: (w) => !!w.typeahead,
    at(q, env) {
      const set = typeaheadSettingsOf(byFlag(env.nodes, 'typeahead', 'api'), byFlag(env.nodes, 'typeahead', 'trie'));
      return { ...typeaheadOutcome(set, { qps: q }), ...set };
    },
    shape: (o) => ({ qps: o.reach }),
  },
];

/** How the outcomes in `byField` change the share of requests that write and of keys always cached. */
export function trafficShape(byField) {
  let shape = {};
  for (const w of WORKLOADS) if (w.shape && byField[w.field]) shape = { ...shape, ...w.shape(byField[w.field]) };
  return { writes: shape.writes, cacheHot: shape.cacheHot };
}

/**
 * Every workload's outcome at this moment, by field (null for the ones the level does not use), and the traffic the
 * servers see after them: `qps` with the wobble, `base` without it.
 */
export function workloadsAt(qps, base, env) {
  const byField = {};
  for (const w of WORKLOADS) {
    const o = w.active(env.workload) ? w.at(qps, env) : null;
    byField[w.field] = o;
    if (o && w.shape) { base = w.shape(base === qps ? o : w.at(base, env)).qps; qps = w.shape(o).qps; }
  }
  return { byField, qps, base, ...trafficShape(byField) };
}
