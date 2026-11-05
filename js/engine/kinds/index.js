// Component kinds: what a component type with its own rules does, in one place, so a new type adds a file here instead
// of a branch in loadPhase, costOf and countSpofs. A type with no kind follows the generic rules.
//
// A kind: { id, matches(c), outcome?, step?(n, L, ctx), cost?(n, work, nodes), redundant?(n) }
//   matches    true for the catalog entry `c` (COMPONENTS[type]) of the types it describes, by catalog flag
//   outcome    the workload field (workloads.js) its step reads; while that outcome is null the type takes the generic
//              server step instead
//   step       its load rule for `L` requests a second in loadPhase (model.js). ctx gives the workloads' `outcomes`, the
//              write share `writes`, settle(n, served, stat) to record what it served and its stat, and forward(n, flow)
//              to send `flow` on to the servers behind it
//   cost       its monthly cost (components.js costOf), given its `work` at the peak and the design's `nodes`
//   redundant  true when it keeps working with one machine down, so it is not a single point of failure on its own
// Kind files import only catalog.js and pure outcome modules (tests/unit/kinds.test.mjs checks it), so components.js
// and model.js can import them without a cycle.
import { notifyWorker } from './notify.js';
import { feedService, feedCache } from './feed.js';
import { chatServer } from './chat.js';
import { typeaheadApi, typeaheadTrie } from './typeahead.js';
import { videoUpload, videoTranscode, videoServe } from './video.js';
import { syncBlock, syncPoll, syncStore } from './sync.js';
import { COMPONENTS } from '../catalog.js';

/** Every kind; the first that matches a type is its kind. */
export const KINDS = [
  notifyWorker, feedService, feedCache, chatServer, typeaheadApi, typeaheadTrie,
  videoUpload, videoTranscode, videoServe, syncBlock, syncPoll, syncStore,
];

/** The kind of node `n`'s type, or null when it has none (or its type is unknown). */
export function kindOf(n) {
  const c = COMPONENTS[n.type];
  return (c && KINDS.find((k) => k.matches(c))) || null;
}
