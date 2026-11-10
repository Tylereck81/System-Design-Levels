// A chat system (chat.js): its settings, and the chat servers.
import { COMPONENTS, choiceOf, optionOf, isOn } from '../catalog.js';
import { fmt } from '../../format.js';

/** A chat system's settings, from its chat servers and message store (either may be missing). */
export function chatSettingsOf(srv, store) {
  return {
    servers: srv ? optionOf(srv, 'count').count : 0,
    protocol: srv ? choiceOf(srv, 'protocol') : 'poll', discovery: isOn(srv, 'reconnect'), heartbeat: isOn(srv, 'presence'), push: isOn(store, 'offline'),
  };
}

const serversOf = (n) => chatSettingsOf(n, null).servers;

/** The chat servers: they deliver the share of messages the outcome allows, and store every one. Each costs the type's price. */
export const chatServer = {
  id: 'chat-server',
  matches: (c) => c.chat === 'server',
  liveRows: ({ chat }) => !chat ? [] : [
    { value: chat.delay < 1 ? fmt(chat.delay * 1000) + ' ms' : chat.delay.toFixed(1) + ' s', label: `for a message to arrive, by ${{ poll: 'polling', long: 'long polling', ws: 'WebSocket' }[chat.protocol]}`, wide: true },
    { value: `${chat.memoryGB.toFixed(1)} GB`, label: 'of connections on each chat server (8 GB each)', wide: true },
  ],
  outcome: 'chat',
  step(n, L, ctx) {
    const c = COMPONENTS[n.type], o = ctx.outcomes.chat, s = L * o.served;
    const cap = c.cap * o.servers * (o.protocol === 'ws' ? 1 : 2.5); // HTTP servers count requests: 50,000 a second each
    ctx.settle(n, s, { load: L, cap, util: L / cap, ms: c.base, mult: 1, base: c.base, unit: c.unit, drop: 1 - o.served, chat: o });
    ctx.forward(n, s);
  },
  cost: (n) => COMPONENTS[n.type].cost * serversOf(n),
  redundant: (n) => serversOf(n) > 1,
};
