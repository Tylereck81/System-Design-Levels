// @ts-check
/** @import { Level, Goal, Lesson } from '../js/types.js' */
// Level 18: Chat system.
// Everything specific to this level lives here: components, rules, missions, quiz and text.
import { fmt, count, percent } from '../js/format.js';
import { servedGoal, costGoal, servedAtLeast, fmtPct } from './shared/goals.js';
import { ONLINE, CONN_KB, SERVER_CONNS, POLL_S, LONG_S, OFFLINE, NIGHT_OFFLINE, FRIENDS, PRESENCE_CAP, HEARTBEAT_S, TRAIN, DROPS_MIN } from '../js/engine/chat.js';
import { lbText, levelComplete } from './shared/text.js';
import { failText, passText } from './shared/quiz.js';
import { panel, lane } from './shared/figures.js';
import { COMPONENTS } from '../js/engine/catalog.js';
import { STEPS } from './mock-steps.js';

const targets = { latencyMs: 150, servedPct: 99 };
const BUDGET = 1800;
const MSGS = 36000; // messages a second at the evening peak
const DELIVER_S = 0.5; // seconds a message may take to arrive
/** Memory each chat server has for connections: 800,000 × 10 KB = 8,000,000 KB = 8 GB. */
const GB_PER_SERVER = (SERVER_CONNS * CONN_KB) / 1e6;
const NEXT_MS = 100; // Level 19's deadline for a suggestion, named in the wrap-up (tests/unit checks it)

const served99 = servedAtLeast(targets.servedPct);
const deliveredGoal = servedGoal(targets, { text: `Deliver ${targets.servedPct}% of messages` });
const fast = (m) => !!m.chat && m.chat.delay <= DELIVER_S;
/** @type {Goal} */
const delayGoal = { id: 'delay', type: 'metric', text: `Messages arrive within ${DELIVER_S} s`, test: fast, val: (m) => (m.chat ? (m.chat.delay < 1 ? `${fmt(m.chat.delay * 1000)} ms` : `${m.chat.delay.toFixed(1)} s`) : '—') };
/** @type {Goal} */
const pushGoal = { id: 'push', type: 'metric', text: 'Offline friends are told at once', test: (m) => !!m.chat && m.chat.notified === 1, val: (m) => (m.chat ? (m.chat.notified ? 'push' : 'next open') : '—') };
const presenceOk = (m) => !!m.chat && m.chat.presenceLoad <= PRESENCE_CAP && m.chat.flips === 0;
/** @type {Goal} */
const presenceGoal = { id: 'presence', type: 'metric', text: 'Green dots keep up and don\'t flicker', test: presenceOk, val: (m) => (m.chat ? `${fmt(m.chat.presenceLoad / 1000)}k/s` : '—') };

// ---------------- Lesson ----------------
const [scope, sketch, deep, stress] = STEPS.map((step) => `<b>${step.name}</b>`);
const chatsrv = COMPONENTS.chatsrv;
const msgstore = COMPONENTS.msgstore;

// Scope example (ours): 1.5 million open connections and groups up to 100 (the mission uses 2 million).
// 1,500,000 × 10 KB = 15,000,000 KB = 15 GB; 15 GB ÷ 8 GB = 1.875, so 2 servers, and a 3rd as a spare
// (with one down, 15 GB on 2 servers is 7.5 GB each, under 8 GB).
const sc = { conn: 1.5e6, group: 100 };
sc.connText = count(sc.conn);
sc.gb = (sc.conn * CONN_KB) / 1e6;
sc.servers = Math.ceil(sc.gb / GB_PER_SERVER);
sc.withSpare = sc.servers + 1;

// Status fanout example (ours): a 20,000-member group (the quiz uses 50,000).
const grp = { members: 20000 };

/** @type {Lesson} */
const lesson = {
  intro: {
    kicker: 'Level 18 · Part 3: Design real systems',
    title: 'Chat system',
    story: 'A messaging app needs messages to arrive within half a second, for friends who are online, asleep, or in a tunnel. Every message is kept for ever, and a green dot shows who is online.',
    picture: 'figBuilt',
    alt: 'The finished design: phones keep open connections to chat servers, chosen by service discovery. Chat servers store every message in a key-value store, which asks the notification system to push to offline phones. Presence servers receive heartbeats.',
    outcomes: [
      'estimate the memory open connections need',
      'compare polling, long polling and WebSocket',
      'explain why chat servers are stateful',
      'reach friends who are offline',
      'keep presence steady with heartbeats',
    ],
  },
  last: 'Level 17 let feeds be a few seconds late. A chat message cannot wait, and the server must reach the phone without being asked.',
  parts: [
    {
      title: 'Real-time chat',
      mission: 0,
      minutes: 10,
      lead: 'On the web the client asks and the server answers. Chat needs the server to speak first.',
      newParts: [
        { type: 'chatsrv', before: 1, what: 'Servers that keep users\' connections open.', does: 'Hold an open connection to each user\'s phone and pass messages between them as they arrive.', game: `$${chatsrv.cost} a month each. ${GB_PER_SERVER} GB of memory for connections.` },
        { type: 'msgstore', before: 1, what: 'The store that keeps every message for ever.', does: 'Holds messages under their chat and message ID, so recent messages are fast to read.', game: `$${msgstore.cost} a month.` },
      ],
      sections: [
        {
          title: 'Scope it: how much memory do open connections need?',
          hook: `Ask: one-to-one or groups, how many users, how long to keep messages. Say: both, groups up to ${sc.group}, keep everything, and ${sc.connText} users connected at the busiest moment.`,
          body: [
            {
              calc: {
                formula: `Memory = open connections × memory for one (about ${CONN_KB} KB, an assumption).`,
                rows: [
                  { label: 'Memory', work: `${sc.connText} connections × ${CONN_KB} KB`, result: `${sc.gb} GB` },
                  { label: 'Servers', work: `${sc.gb} GB ÷ ${GB_PER_SERVER} GB each`, result: `${sc.gb / GB_PER_SERVER}, so ${sc.servers} servers` },
                  { label: 'With a spare', work: `${sc.servers} servers + 1 server`, result: `${sc.withSpare} servers` },
                ],
                result: `${sc.withSpare} chat servers. With one down, the other ${sc.servers} still hold every connection.`,
              },
            },
            { p: 'For chat the limit is open connections, not requests a second. Every connected user costs memory even when they say nothing.' },
          ],
          takeaway: 'Size chat servers by open connections and their memory.',
          quiz: [4],
        },
        {
          title: 'How can a server send a message the moment it arrives?',
          hook: 'There are three ways for a phone to receive, and only one fits chat.',
          body: [
            {
              figure: 'figPoll',
              alt: 'With polling, the phone asks again and again and is mostly told there is nothing new; a message waits until the next ask. With long polling, the phone holds one request open until a message comes, then asks again. With a WebSocket, one connection stays open and the server pushes the message the moment it arrives.',
              caption: 'Asking often, asking and waiting, or one open connection',
            },
            { ul: [
              '<b>Polling:</b> ask every few seconds. Mostly "nothing new", and a message waits until the next ask.',
              '<b>Long polling:</b> ask, and the server holds the request until there is a message. Behind a load balancer the message may reach a server that is not holding your request.',
              '<b>WebSocket:</b> one connection that stays open and works both ways. The server pushes each message at once.',
            ] },
          ],
          takeaway: 'A WebSocket keeps one connection open, so the server can push at once.',
          quiz: [0, 1],
        },
        {
          title: 'What happens to users when a chat server dies?',
          hook: 'Each phone is connected to one particular chat server. That server holds the connection, so it is <b>stateful</b>, unlike the web servers of Level 6.',
          body: [
            { p: 'So a phone must know which server to connect to. <b>Service discovery</b> keeps a list of healthy chat servers and hands each phone one, by location and spare room.' },
            { p: 'When a server dies, its connections drop. Its users ask service discovery again and reconnect to other servers, which must have memory to spare. That is why you plan a spare server.' },
          ],
          takeaway: 'Service discovery hands each phone a chat server, and a new one if it dies.',
          quiz: [2, 3],
        },
      ],
      checks: [
        {
          q: 'A chat app keeps 4 million connections open, 10 KB each. Servers have 8 GB for connections. How many servers, so one can die?',
          options: [
            { t: '5', why: '40 GB fits on 5 servers, but if one dies the other 4 would need 10 GB each.' },
            { t: '6', right: true, why: '4 million × 10 KB = 40 GB. 5 servers carry it; with one down, 5 of 6 still hold 8 GB each.' },
            { t: '40', why: 'Each server holds 8 GB, not 1 GB.' },
          ],
        },
      ],
      youWill: [
        'estimate the memory for open connections (Play stays locked until you do)',
        `switch to WebSocket so messages arrive within ${DELIVER_S} seconds`,
        `let a chat server die and keep ${targets.servedPct}% of messages delivered`,
        `stay within $${fmt(BUDGET)} a month`,
      ],
      debrief: {
        saw: 'Each message was pushed at once over an open connection. When a server died, its users reconnected to the others.',
        number: [`${CONN_KB} KB`, 'of memory for each open connection'],
        next: `${percent(OFFLINE)} of recipients have their phone asleep when a message arrives.`,
      },
    },
    {
      title: 'Offline friends',
      mission: 1,
      minutes: 7,
      lead: 'A sleeping phone has no open connection. The message must still get through.',
      sections: [
        {
          title: 'Where do messages live, and in what order?',
          hook: 'Every message is kept for ever, and there are billions of them. Most reads are for recent messages.',
          body: [
            { p: 'A <b>key-value store</b> fits: it scales out by adding machines, and reads by key are fast. Messages are keyed by chat and message ID, so one chat\'s messages sit together.' },
            { p: 'Order comes from the <b>message ID</b>, not the send time: two messages can share a timestamp. IDs must be unique and grow with time. They only need to be in order within one chat, so a counter per chat is enough, or a time-based ID from Level 13.' },
          ],
          takeaway: 'Keep messages in a key-value store, ordered by an ID that grows within each chat.',
          quiz: [5, 6],
        },
        {
          title: 'How does a message reach a friend whose phone is asleep?',
          hook: 'The message is always stored first. What happens next depends on whether the friend is connected.',
          body: [
            {
              figure: 'figFlow',
              alt: 'Ana sends a message to chat server 1, which gives it an ID and stores it. If Ben is online, it goes to chat server 2 and over Ben\'s open connection. If Ben is offline, the notification system sends a push to his phone.',
              caption: 'Store it, then deliver or push',
            },
            { p: 'Online: the message goes to the chat server holding the friend\'s connection. Offline: the notification system from Level 16 sends a push.' },
            { p: 'When the app opens, each device asks for every message newer than the last message ID it has. A phone and a laptop each keep their own last ID, so each catches up on its own.' },
          ],
          takeaway: 'Store every message, push to offline friends, and sync by the last message ID.',
          quiz: [7],
        },
      ],
      checks: [
        {
          q: 'A user\'s laptop was closed for a week. How does it catch up when opened?',
          options: [
            { t: 'The phone sends it the missing messages', why: 'Devices never talk to each other; each syncs from the store.' },
            { t: 'It asks the store for every message newer than its last message ID', right: true, why: 'Its last ID marks exactly where it stopped.' },
          ],
        },
      ],
      youWill: [
        'make sure offline friends are told at once',
        'let night fall, with many phones asleep, and keep everyone told',
        `stay within $${fmt(BUDGET)} a month`,
      ],
      debrief: {
        saw: 'Online friends got the message over their connection, and offline friends got a push.',
        number: [percent(OFFLINE), 'of recipients were offline'],
        next: `Each user's green dot shows to ${FRIENDS} friends, and people on trains lose signal in every tunnel.`,
      },
    },
    {
      title: 'Green dots',
      mission: 2,
      minutes: 6,
      lead: 'Showing who is online sounds trivial. Every change has to reach every friend.',
      sections: [
        {
          title: 'Why does a green dot flicker, and how do you stop it?',
          hook: 'If a user is marked offline whenever their connection drops, a train ride flips them off and on every few seconds.',
          body: [
            {
              figure: 'figBeat',
              alt: `A phone sends a heartbeat every ${HEARTBEAT_S} seconds. A tunnel blocks a few heartbeats, but the gap is shorter than the timeout, so the dot stays green. Only a longer silence turns it grey.`,
              caption: 'Only a long silence turns the dot grey',
            },
            { p: `Instead, the phone sends a small <b>heartbeat</b> every few seconds (${HEARTBEAT_S} here). The user counts as online until no heartbeat has arrived for a while. A short drop changes nothing.` },
            { p: `Every status change goes to every friend: with ${FRIENDS} friends, one change is ${FRIENDS} messages. For a group of ${fmt(grp.members)}, one change would be ${fmt(grp.members)}. Large groups fetch statuses only when someone opens the group.` },
          ],
          takeaway: 'Heartbeats keep a short drop from flipping the status, and big groups fetch on demand.',
          quiz: [8, 9],
        },
      ],
      checks: [
        {
          q: 'A user with 300 friends goes offline and online 10 times on a train ride, each drop lasting a few seconds, and every change is sent. How many status messages go out?',
          options: [
            { t: '20', why: 'Each change goes to every friend, not once.' },
            { t: '6,000', right: true, why: '20 changes × 300 friends. Heartbeats would have sent none, because no drop was long enough.' },
          ],
        },
      ],
      youWill: [
        'keep the green dots steady and up to date',
        'send trains through tunnels with the Break it button',
        `stay within $${fmt(BUDGET)} a month`,
      ],
    },
  ],
  wrap: {
    picture: 'figBuiltEnd',
    alt: 'The finished design: phones keep open connections to chat servers chosen by service discovery. Messages are stored in a key-value store, offline phones get a push, and presence servers receive heartbeats.',
    say: [
      '"Phones keep a WebSocket to a chat server, so messages are pushed the moment they arrive."',
      '"Chat servers are stateful, so service discovery assigns them and reassigns users when one dies."',
      '"Offline friends get a push, and presence uses heartbeats so short drops do not flicker."',
    ],
    numbers: [
      [`${CONN_KB} KB`, 'of memory for one open connection (an assumption)'],
      [`${FRIENDS} friends`, 'receive each status change'],
    ],
    loop: `The interview steps: ${scope} (connection memory), ${sketch} (chat servers, store, discovery), ${deep} (message flow and presence), ${stress} (a dead server, a night, a train).`,
    broken: `In Level 19 the server must answer before the user has even finished typing: search suggestions in under ${NEXT_MS} ms.`,
  },
};

/**
 * The finished design, drawn for the intro and again for the wrap-up. Phones ask service discovery for a chat server
 * and keep a WebSocket to it; chat servers store every message; the store has offline phones pushed; presence
 * servers receive heartbeats.
 * @param {Record<string, Function>} f the drawing helpers `drawFigures` is given
 * @param {SVGSVGElement} svg
 */
function drawBuilt(f, svg) {
  const { svgEl, figNode, figArrow, figLabel, figSvg } = f;
  figSvg(svg, 450);
  figNode(svg, 'users', 320, 45, 'Phones', 'Online now');
  figNode(svg, 'dns', 110, 165, 'Service discovery', 'Picks a server');
  figArrow(svg, 270, 75, 160, 135, 'which server?', null, 206, 98, 'end');
  // The open connection is a thick line: it carries messages both ways.
  svgEl('line', { x1: 320, y1: 78, x2: 320, y2: 132, class: 'd-arc' }, svg);
  figLabel(svg, 334, 110, 'WebSocket', 'start');
  figNode(svg, 'chatsrv', 320, 165, 'Chat servers', 'Hold connections');
  figNode(svg, 'cache', 530, 165, 'Presence', 'Heartbeats');
  figArrow(svg, 370, 75, 480, 135, 'heartbeats', null, 434, 98);
  figNode(svg, 'msgstore', 320, 285, 'Message store', 'Key-value, kept');
  figArrow(svg, 320, 195, 320, 255, 'store', null, 332, 230);
  figNode(svg, 'notifier', 110, 405, 'Notifications', 'Push if asleep');
  figArrow(svg, 270, 315, 160, 375, 'offline', null, 206, 338, 'end');
  figNode(svg, 'users', 530, 405, 'Asleep phone', 'No connection');
  figArrow(svg, 204, 405, 436, 405, 'push', null, 320, 397, 'middle');
}

/**
 * Three ways to receive, each a phone lane above a server lane, with the same message arriving at the same moment.
 * Polling asks again and again and gets it at the next ask; long polling holds one request open and gets it at once,
 * then asks again; a WebSocket opens once and the server pushes it at once.
 * @param {Record<string, Function>} f the drawing helpers `drawFigures` is given
 * @param {SVGSVGElement} svg
 */
function drawPoll(f, svg) {
  const { svgEl, figArrow, figLabel, figDash, figSvg } = f;
  figSvg(svg, 460);
  const ARRIVES = 330;
  /** One panel with a phone lane and a server lane and the message's arrival; `ask` draws a request down, `answer` one up. */
  const timeline = (y, label) => {
    panel(f, svg, y, 140, label);
    const phone = y + 50, server = y + 110;
    lane(f, svg, phone, 'Phone', 100, 610);
    lane(f, svg, server, 'Server', 100, 610);
    svgEl('circle', { cx: ARRIVES, cy: server, r: 5, class: 'ch-pt' }, svg);
    figLabel(svg, ARRIVES, server + 20, 'message arrives');
    return {
      ask: (x, text) => figArrow(svg, x, phone + 4, x, server - 4, text, null, x + 12, y + 84),
      answer: (x, text) => figArrow(svg, x, server - 4, x, phone + 4, text, null, x + 12, y + 84),
      nothing: (x) => figDash(svg, `M${x} ${server - 4} V${phone + 4}`),
    };
  };
  const poll = timeline(10, 'Polling');
  figLabel(svg, 610, 30, 'time →', 'end', 'tier-label');
  for (const x of [150, 270, 510]) { poll.ask(x, ''); poll.nothing(x + 16); }
  poll.ask(390, '');
  poll.answer(406, 'gets it');
  figLabel(svg, 178, 94, 'nothing new', 'start');
  const held = timeline(160, 'Long polling');
  held.ask(150, 'held open');
  held.answer(ARRIVES + 16, 'answer');
  held.ask(470, 'asks again');
  const ws = timeline(310, 'WebSocket');
  ws.ask(150, 'opens once');
  ws.answer(ARRIVES + 16, 'pushed at once');
}

/**
 * One message: Ana sends it to chat server 1, which gives it an ID and stores it. If Ben is online, chat server 2
 * passes it over his connection; if he is offline, the notification system pushes it to his phone.
 * @param {Record<string, Function>} f the drawing helpers `drawFigures` is given
 * @param {SVGSVGElement} svg
 */
function drawFlow(f, svg) {
  const { figNode, figArrow, figSvg } = f;
  figSvg(svg, 450);
  figNode(svg, 'users', 110, 45, 'Ana', 'Sends a message');
  figNode(svg, 'chatsrv', 320, 165, 'Chat server 1', 'Gives it an ID');
  figArrow(svg, 150, 75, 270, 135, 'send', null, 222, 98);
  figNode(svg, 'msgstore', 530, 45, 'Message store', 'Stored first');
  figArrow(svg, 370, 135, 480, 75, 'store', null, 434, 120);
  figNode(svg, 'chatsrv', 110, 285, 'Chat server 2', 'Holds Ben\'s line');
  figArrow(svg, 270, 195, 160, 255, 'if online', null, 200, 216, 'end');
  figNode(svg, 'notifier', 530, 285, 'Notifications', 'Push if asleep');
  figArrow(svg, 530, 75, 530, 255, 'if offline', null, 542, 170);
  figNode(svg, 'users', 110, 405, 'Ben\'s phone', 'Open connection');
  figArrow(svg, 110, 315, 110, 375, 'WebSocket', null, 122, 350);
  figNode(svg, 'users', 530, 405, 'Ben\'s phone', 'Asleep');
  figArrow(svg, 530, 315, 530, 375, 'push', null, 542, 350);
}

/**
 * A heartbeat timeline. Beats come every HEARTBEAT_S seconds; a tunnel cuts three, but the gap is shorter than the
 * timeout, so the status stays online. After the last beat, a silence longer than the timeout turns it offline.
 * @param {Record<string, Function>} f the drawing helpers `drawFigures` is given
 * @param {SVGSVGElement} svg
 */
function drawBeat(f, svg) {
  const { svgEl, figLabel, figSvg } = f;
  figSvg(svg, 220);
  // Picture time in seconds: the tunnel, the last beat, the silence before "offline" (the game's 30 s), the end.
  const TUNNEL = [22, 38], LAST = 50, TIMEOUT = 30, END = 90;
  const x = (t) => 110 + t * 5.5;
  const mid = x((TUNNEL[0] + TUNNEL[1]) / 2);
  svgEl('rect', { x: x(TUNNEL[0]), y: 36, width: x(TUNNEL[1]) - x(TUNNEL[0]), height: 116, class: 'ch-cap' }, svg);
  figLabel(svg, mid, 52, 'tunnel', 'middle', 'ch-cap-t');
  lane(f, svg, 76, 'Heartbeats', x(0), x(END));
  for (let t = HEARTBEAT_S; t <= LAST; t += HEARTBEAT_S) {
    if (t < TUNNEL[0] || t > TUNNEL[1]) svgEl('circle', { cx: x(t), cy: 76, r: 5, class: 'ch-pt' }, svg);
  }
  figLabel(svg, x(HEARTBEAT_S), 58, `every ${HEARTBEAT_S} s`, 'start', 'ch-t');
  figLabel(svg, 24, 134, 'Status', 'start', 'tier-label');
  svgEl('rect', { x: x(0), y: 118, width: x(LAST + TIMEOUT) - x(0), height: 24, rx: 4, class: 'ch-area' }, svg);
  figLabel(svg, x(0) + 10, 134, 'online', 'start', 'ch-pt-t');
  figLabel(svg, x(LAST + TIMEOUT) + 8, 134, 'offline', 'start', 'ch-t');
  figLabel(svg, mid, 172, 'gap under the timeout', 'middle', 'ch-t');
  svgEl('line', { x1: x(LAST), y1: 160, x2: x(LAST + TIMEOUT), y2: 160, class: 'ch-axis d-dash' }, svg);
  figLabel(svg, x(LAST + TIMEOUT / 2), 178, 'silent past the timeout', 'middle', 'ch-t');
  svgEl('line', { x1: x(0), y1: 200, x2: x(END), y2: 200, class: 'ch-axis' }, svg);
  figLabel(svg, x(END), 214, 'time →', 'end', 'ch-t');
}

/** @type {Level} */
export default {
  id: 18,
  saveKey: 'sdl-level18-v1',
  saveVersion: 2, // 2: which missions were opened from the lesson (`opened`)
  targets,
  workload: { chat: true },

  // The mock interview's brief and self-check list for this problem (see mock.js).
  mock: {
    title: 'Chat system',
    brief: 'Design a chat app: one-on-one and group chats (up to 150 people), text only, several devices per account, online status, and history kept forever. 40 million daily users.',
    checklist: [
      'Chose WebSocket over polling and long polling, and said why',
      'Separated stateless API servers from stateful chat servers',
      'Used service discovery to pick, and replace, a chat server',
      'Stored messages in a key-value store, with IDs that grow with time',
      'Pushed notifications to offline recipients; synced each device by its last message ID',
      'Used heartbeats for online status, and fetched big groups\' status on demand',
    ],
  },

  components: {
    users: {
      name: 'Users', sub: 'Chat on phone and laptop',
      desc: `People on a chat app: one-on-one and group chats, text only. ${fmt(ONLINE / 1e6)} million are online at the evening peak, sending ${fmt(MSGS)} messages a second. Each keeps a connection open to a chat server, so messages can be pushed to them.`,
    },
    chatsrv: {
      name: 'Chat servers', short: 'Hold connections',
      desc: `Servers that hold users' open connections and pass messages between them. Each has ${GB_PER_SERVER} GB of memory for connections, about ${CONN_KB} KB each: ${fmt(SERVER_CONNS)} connections. $300 a month each.`,
      subOf: (n) => `${Number(n.count) || 3} servers · ${{ poll: 'polling', long: 'long polling', ws: 'WebSocket' }[n.protocol] || 'polling'}`,
      choices: [
        { key: 'count', label: 'Servers', options: [2, 3, 4, 5, 6].map((k) => ({ id: String(k), name: `${k} servers`, sub: `$${fmt(k * 300)} a month`, note: `${k} chat servers: ${(k * SERVER_CONNS / 1e6).toFixed(1)} million connections in all.`, log: `Chat servers set to ${k}.` })) },
        {
          key: 'protocol', label: 'How messages reach a user',
          options: [
            { id: 'poll', name: 'Polling', sub: `ask every ${POLL_S} s`, note: `Each client asks "anything new?" every ${POLL_S} seconds over HTTP. Simple, but most answers are "no", and a message waits ${POLL_S / 2} s on average.`, log: 'Clients now poll for messages.' },
            { id: 'long', name: 'Long polling', sub: `hold the request up to ${LONG_S} s`, note: 'The server holds each request until a message arrives or it times out. But the message may land on a server that isn\'t holding the recipient\'s request; it then waits for the timeout.', log: 'Clients now long-poll.' },
            { id: 'ws', name: 'WebSocket', sub: 'one open two-way connection', note: 'The client opens an HTTP connection and upgrades it to WebSocket: persistent and two-way, so the server pushes each message at once. Costs memory per connection.', log: 'Clients now use WebSocket.' },
          ],
        },
        {
          key: 'reconnect', label: 'When a server dies',
          options: [
            { id: 'fixed', name: 'Retry the same server', sub: 'a fixed address', note: 'Clients keep retrying the address they had. If that server is gone, they stay offline.', log: 'Clients retry the same chat server.' },
            { id: 'discovery', name: 'Ask service discovery', sub: 'get a healthy server', note: 'A service discovery system (such as ZooKeeper) knows every chat server and its load, and gives the client the best healthy one, at login and after a failure.', log: 'Clients now find a chat server through service discovery.' },
          ],
        },
        {
          key: 'presence', label: 'Online status',
          options: [
            { id: 'disconnect', name: 'Follow the connection', sub: 'offline on every disconnect', note: 'A dropped connection marks the user offline, and the reconnect marks them online: every flap goes to all their friends.', log: 'Online status now follows the connection.' },
            { id: 'heartbeat', name: 'Heartbeat', sub: `every ${HEARTBEAT_S} s, offline after 30 s`, note: `The client sends a heartbeat every ${HEARTBEAT_S} seconds; a user is offline only after 30 s without one. Short drops don't change the status.`, log: 'Online status now uses heartbeats.' },
          ],
        },
      ],
    },
    msgstore: {
      name: 'Message store', short: 'Chat history, forever',
      desc: 'A key-value store holding every message, keyed by chat and message ID: easy to scale out, fast for recent messages. $500 a month.',
      subOf: (n) => (n.offline === 'push' ? 'pushes to offline users' : 'waits for offline users'),
      choices: [
        {
          key: 'offline', label: 'Offline recipients',
          options: [
            { id: 'wait', name: 'Wait until they open the app', sub: 'they sync then', note: 'The message waits in the store; the recipient\'s app fetches everything newer than its last message ID when it next opens.', log: 'Offline recipients now get messages when they open the app.' },
            { id: 'push', name: 'Store and send a push', sub: 'tell them now', note: 'Store the message, and ask the notification system (Level 16) to send a push notification to the recipient\'s devices.', log: 'Offline recipients now get a push notification.' },
          ],
        },
      ],
    },
  },
  palette: ['chatsrv', 'msgstore'],
  limits: { chatsrv: 1, msgstore: 1 },
  limitMsg: {
    chatsrv: 'One chat server box is enough: set its servers in the inspector.',
    msgstore: 'One message store is enough.',
  },
  // Users → 3 chat servers (polling, fixed addresses) → message store.
  startNodes: [
    { id: 'u', type: 'users', x: 380, y: 70 },
    { id: 'c', type: 'chatsrv', x: 380, y: 230, count: '3', protocol: 'poll', reconnect: 'fixed', presence: 'disconnect' },
    { id: 'm', type: 'msgstore', x: 380, y: 390, offline: 'wait' },
  ],
  startEdges: [{ id: 's1', from: 'u', to: 'c' }, { id: 's2', from: 'c', to: 'm' }],
  slots: { chatsrv: { x: 380, y: 230 }, msgstore: { x: 380, y: 390 } },

  connections: {
    ok: {
      'chatsrv|users': { from: 'users', to: 'chatsrv', label: 'connections', desc: 'Each client keeps a connection to one chat server.' },
      'chatsrv|msgstore': { from: 'chatsrv', to: 'msgstore', label: 'messages', desc: 'Every message is stored with its ID before it is delivered.' },
    },
    bad: { 'msgstore|users': 'Clients talk to chat servers, which store the messages.' },
  },

  missions: [
    {
      title: 'Real-time chat', ref: 'Polling vs WebSocket', qps: MSGS, budget: BUDGET,
      gate: {
        hidesTraffic: false,
        lo: 20, hi: 20,
        prompt: `<b>Estimate before you build.</b> ${fmt(ONLINE / 1e6)} million users keep a connection open, about ${CONN_KB} KB of server memory each. How many GB in all?`,
        label: 'GB',
        placeholder: 'e.g. 5',
        acceptedHtml: `<p><b>Estimate accepted.</b></p><div class="calc">2,000,000 × ${CONN_KB} KB = 20,000,000 KB = 20 GB<br>At ${GB_PER_SERVER} GB per server: 3 servers, and a 4th so one can die</div>`,
        acceptedLog: 'Estimate accepted: 20 GB. Play is unlocked.',
        notNumber: 'Type the GB as a number, for example 5.',
        hints: [
          { test: (v) => v === 2 || v === 200, text: 'Check the units: 2 × 10⁶ × 10 × 10³ bytes = 2 × 10¹⁰ bytes.' },
          { test: (v) => v === 20000, text: 'That is MB. The question asks for GB.' },
        ],
        fallback: 'Not quite. Connections × KB each, then 10⁶ KB per GB.',
      },
      story: `Clients poll every ${POLL_S} seconds, so messages wait and the servers answer "nothing new" all day. Deliver messages within half a second, and keep every user connected when a chat server dies.`,
      goals: [
        { id: 'est', type: 'gate', text: 'Estimate the connection memory' },
        deliveredGoal, delayGoal, costGoal(BUDGET),
        { id: 'dies', type: 'exp', text: 'Break it: a chat server dies; still 99% delivered' },
      ],
      hint: 'Switch to WebSocket. When a server dies, its users must find another one (service discovery), and the others must have memory for them: 20 GB on 3 survivors needs 4 servers.',
      takeaway: 'WebSocket pushed each message at once over one open connection. When a server died, service discovery sent its users to healthy servers, which had memory to spare. Chat servers are stateful: plan for the connections, not just the requests.',
    },
    {
      title: 'Offline friends', ref: 'Message flows', qps: MSGS, budget: BUDGET,
      story: `About ${Math.round(100 * OFFLINE)}% of recipients are offline when a message arrives: their phone is asleep. Every message is kept, but they should know now, not tomorrow.`,
      goals: [
        pushGoal, deliveredGoal, delayGoal, costGoal(BUDGET),
        { id: 'night', type: 'exp', text: 'Break it: night falls; offline friends still told at once' },
      ],
      hint: 'Have the message store ask the notification system to push to offline recipients.',
      takeaway: 'Online recipients got the message over their WebSocket; offline ones got a push, and their app syncs every message newer than its last message ID when it opens. Nothing waits silently.',
    },
    {
      title: 'Green dots', ref: 'Online presence', qps: MSGS, budget: BUDGET,
      story: `Each user's green dot shows to ${FRIENDS} friends. Users on trains lose signal in every tunnel, ${DROPS_MIN} times a minute. Keep the dots steady and the presence servers within ${fmt(PRESENCE_CAP / 1e6)} million events a second.`,
      goals: [
        presenceGoal, pushGoal, deliveredGoal, delayGoal, costGoal(BUDGET),
        { id: 'tunnel', type: 'exp', text: 'Break it: trains go through tunnels; dots steady, presence keeps up' },
      ],
      hint: 'Use heartbeats: a short drop shouldn\'t change anyone\'s status.',
      takeaway: `Heartbeats every ${HEARTBEAT_S} seconds cost a steady stream of small events, but a tunnel no longer flips a status, and no flip goes out to ${FRIENDS} friends. For a 50,000-member fan group, fetch statuses when someone opens it instead.`,
    },
  ],

  // Break-it experiments. An event only checks its outcome; serverDies, night and tunnel change the outcome while it runs.
  experiments: [
    {
      id: 'dies', kind: 'event', serverDies: true,
      label: 'A chat server dies', labelOn: 'Bring it back',
      needsDesign: 'Build the design first: chat servers and the message store.',
      on: 'One chat server dies, and its connections drop.', onTone: 'bad',
      off: 'The server is back.',
      expect: served99,
      notMet: (m) => (m.chat && !m.chat.discovery
        ? `Only ${fmtPct(m.servedPct)} delivered: the dead server's users keep retrying its address. Let them ask service discovery for a healthy server.`
        : `Only ${fmtPct(m.servedPct)} delivered: the servers left don't have memory for every connection (${fmt(SERVER_CONNS)} each). Add a server.`),
      observed: (m) => `Observed: a chat server died, and ${fmtPct(m.servedPct)} of messages were still delivered.`,
    },
    {
      id: 'night', kind: 'event', night: true,
      label: 'Night falls', labelOn: 'Morning',
      needsDesign: 'Build the design first: chat servers and the message store.',
      on: `Night: ${Math.round(100 * NIGHT_OFFLINE)}% of recipients are offline.`, onTone: 'bad',
      off: 'Morning: people are back online.',
      expect: (m) => !!m.chat && m.chat.notified === 1 && served99(m),
      notMet: () => `${Math.round(100 * NIGHT_OFFLINE)}% of recipients won't see their messages until they open the app. Send a push notification to offline recipients.`,
      observed: () => 'Observed: night fell, and offline friends were told by push.',
    },
    {
      id: 'tunnel', kind: 'event', tunnel: true,
      label: 'Trains enter tunnels', labelOn: 'Out of the tunnels',
      needsDesign: 'Build the design first: chat servers and the message store.',
      on: `${Math.round(100 * TRAIN)}% of online users are on trains, losing signal ${DROPS_MIN} times a minute.`, onTone: 'bad',
      off: 'The trains are out of the tunnels.',
      expect: (m) => presenceOk(m) && served99(m),
      notMet: (m) => `Each user on a train flips offline and online ${m.chat.flips} times a minute, and every flip goes to ${FRIENDS} friends: ${(m.chat.presenceLoad / 1e6).toFixed(1)} million events a second. Use heartbeats.`,
      observed: () => 'Observed: trains went through tunnels, and the green dots stayed steady.',
    },
  ],

  // Messages the engine shows for this level's design.
  text: {
    ...lbText(),
    noWeb: 'Connect the users to the chat servers.',
    levelComplete: levelComplete(18),
  },

  quiz: {
    passScore: 8,
    passText: passText(18, 'Search autocomplete'),
    failText,
    questions: [
      { q: 'Why is WebSocket the usual choice for receiving chat messages?', o: ['It needs no server memory for each open connection', 'The server can push over one open connection', 'It works only on mobile', 'It replaces the database'], a: 1, e: 'HTTP is started by the client. WebSocket upgrades one HTTP connection into a persistent two-way one, so the server sends each message as it arrives.', r: 'How can a server send a message the moment it arrives?' },
      { q: 'What goes wrong with long polling behind a round-robin load balancer?', o: ['Messages are encrypted twice', 'Requests never time out, so the servers slowly fill up with held connections', 'Clients can\'t send', 'The message may land on a server not holding the recipient\'s request'], a: 3, e: 'HTTP servers are stateless; the sender\'s message can reach a server that isn\'t holding the recipient\'s waiting request, so it waits for the next poll.', r: 'How can a server send a message the moment it arrives?' },
      { q: 'Why are chat servers stateful?', o: ['Each client holds a connection to one server', 'They store all messages', 'They run the database', 'They keep every user\'s password and profile in memory'], a: 0, e: 'A client stays connected to the same chat server while it is healthy. Login, profiles and settings live on stateless API servers.', r: 'What happens to users when a chat server dies?' },
      { q: 'What does service discovery do for a chat app?', o: ['Encrypts messages', 'Stores the chat history', 'Gives a client a healthy chat server to connect to', 'Sends push notifications to every device a user owns'], a: 2, e: 'It knows every chat server, its location and load, and hands the client the best one: at login, and again when its server dies.', r: 'What happens to users when a chat server dies?' },
      { q: '2 million connections at 10 KB each. How much memory?', o: ['2 GB', '200 GB', '20 GB', '20 MB'], a: 2, e: '2 × 10⁶ × 10 KB = 2 × 10⁷ KB = 20 GB. It might fit one box, but one box is a single point of failure.', r: 'Scope it: how much memory do open connections need?' },
      { q: 'Which store suits chat history best?', o: ['A key-value store', 'A spreadsheet', 'The CDN', 'The client\'s memory only'], a: 0, e: 'Huge volume, mostly recent reads, roughly 1:1 reads to writes: a key-value store scales out easily and answers recent messages fast.', r: 'Where do messages live, and in what order?' },
      { q: 'Why not order messages by their created_at time?', o: ['Clocks are always wrong', 'Timestamps take too many bytes to store per message', 'It\'s slower than IDs', 'Two messages can share a timestamp'], a: 3, e: 'Two messages can be created at the same moment. A message ID that is unique and grows with time (a global or a per-chat sequence) gives the order.', r: 'Where do messages live, and in what order?' },
      { q: 'How does a phone know which messages it is missing?', o: ['It downloads the whole chat history again every time it opens', 'It compares its last message ID with the store', 'The server guesses', 'Friends resend them'], a: 1, e: 'Each device keeps cur_max_message_id and fetches the messages for its user with larger IDs. Each device syncs on its own.', r: 'How does a message reach a friend whose phone is asleep?' },
      { q: 'Why use heartbeats for the green dot?', o: ['So short drops don\'t flip the status', 'To save battery', 'To encrypt the status', 'To count how many messages each user sends a day'], a: 0, e: 'Connections drop in tunnels and elevators. With a heartbeat every few seconds and "offline" only after, say, 30 s of silence, short drops go unnoticed.', r: 'Why does a green dot flicker, and how do you stop it?' },
      { q: 'A fan group has 50,000 members. Why not push every status change to all of them?', o: ['Groups can\'t have statuses', 'Each change would be 50,000 events', 'Statuses are secret', 'Push notifications are too slow for that many people'], a: 1, e: 'Fan out one status change to every member and it costs 50,000 events. For big groups, fetch statuses when a member opens the group.', r: 'Why does a green dot flicker, and how do you stop it?' },
    ],
  },

  lesson,

  drawFigures(f) {
    const { $ } = f;
    drawBuilt(f, $('figBuilt'));
    drawPoll(f, $('figPoll'));
    drawFlow(f, $('figFlow'));
    drawBeat(f, $('figBeat'));
    drawBuilt(f, $('figBuiltEnd'));
  },
};
