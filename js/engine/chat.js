// A chat system: connections held, how fast a message arrives, who is told while offline, and presence updates.

/** Users online at the peak, and memory per open connection (KB). */
export const ONLINE = 2e6;
export const CONN_KB = 10;
/** Connections one chat server holds (8 GB of memory for them), and what it handles a second. */
export const SERVER_CONNS = 800000;
export const MSG_CAP = 20000; // messages, over WebSocket
export const REQ_CAP = 50000; // HTTP requests, for polling and long polling
/** Seconds between polls; long polling's timeout; a WebSocket delivery. */
export const POLL_S = 5;
export const LONG_S = 30;
export const WS_S = 0.1;
/** Share of recipients offline: normally, and at night. */
export const OFFLINE = 0.3;
export const NIGHT_OFFLINE = 0.6;
/** Friends who see a user's green dot; presence events a second the presence servers handle. */
export const FRIENDS = 100;
export const PRESENCE_CAP = 1e6;
/** A user's average session (minutes); a heartbeat every 5 s; users on a train, and the drops a minute each gets. */
export const SESSION_MIN = 30;
export const HEARTBEAT_S = 5;
export const TRAIN = 0.05;
export const DROPS_MIN = 6;

/**
 * The chat's outcome for `msgs` messages a second. WebSocket and long polling keep a connection per user, which takes
 * server memory; polling asks every POLL_S seconds instead, mostly for nothing. When a server dies, its users reconnect
 * elsewhere only through service discovery. Offline recipients are told at once only with push notifications.
 * Presence: each status change goes to FRIENDS; marking users offline on every disconnect turns each tunnel drop into
 * two changes, while a heartbeat (and 30 s of silence before "offline") rides them out, at one event per HEARTBEAT_S.
 * Returns served (share of messages delivered), delay (seconds), memoryGB (per server), notified (share of offline
 * recipients told at once), presenceLoad (events a second) and flips (status changes a minute for a user on a train).
 */
export function chatOutcome({ protocol, servers, discovery, heartbeat, push }, { msgs, dies = false, night = false, tunnel = false }) {
  const healthy = Math.max(0, servers - (dies ? 1 : 0)), online = ONLINE;
  const stranded = dies && !discovery ? online / servers : 0;
  const persistent = protocol !== 'poll';
  const connected = Math.min(online - stranded, persistent ? healthy * SERVER_CONNS : Infinity);
  const reach = online ? connected / online : 0;
  const requests = protocol === 'ws' ? msgs : msgs + connected / (protocol === 'poll' ? POLL_S : LONG_S);
  const capacity = healthy * (protocol === 'ws' ? MSG_CAP : REQ_CAP);
  const cpu = requests ? Math.min(1, capacity / requests) : 1;
  const delay = protocol === 'ws' ? WS_S : protocol === 'poll' ? POLL_S / 2 : (healthy ? (WS_S + (healthy - 1) * LONG_S / 2) / healthy : LONG_S);
  const changes = online / (SESSION_MIN * 60) * 2 + (tunnel && !heartbeat ? online * TRAIN * DROPS_MIN / 60 * 2 : 0);
  return {
    served: reach * cpu, delay,
    memoryGB: persistent && healthy ? connected / healthy * CONN_KB / 1e6 : 0,
    notified: push ? 1 : 0, offline: night ? NIGHT_OFFLINE : OFFLINE,
    presenceLoad: changes * FRIENDS + (heartbeat ? online / HEARTBEAT_S : 0),
    flips: tunnel && !heartbeat ? 2 * DROPS_MIN : 0,
  };
}
