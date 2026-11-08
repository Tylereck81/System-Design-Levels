// @ts-check
/** @import { Level, Goal } from '../js/types.js' */
// Level 18: Chat system.
// Everything specific to this level lives here: components, rules, missions, quiz and text.
import { fmt } from '../js/format.js';
import { servedGoal, costGoal, servedAtLeast, fmtPct } from './shared/goals.js';
import { ONLINE, CONN_KB, SERVER_CONNS, MSG_CAP, REQ_CAP, POLL_S, LONG_S, OFFLINE, NIGHT_OFFLINE, FRIENDS, PRESENCE_CAP, HEARTBEAT_S, TRAIN, DROPS_MIN } from '../js/engine/chat.js';
import { lbText, levelComplete } from './shared/text.js';
import { failText, passText } from './shared/quiz.js';

const targets = { latencyMs: 150, servedPct: 99 };
const BUDGET = 1800;
const MSGS = 36000; // messages a second at the evening peak

const served99 = servedAtLeast(targets.servedPct);
const deliveredGoal = servedGoal(targets, { text: `Deliver ${targets.servedPct}% of messages` });
const fast = (m) => !!m.chat && m.chat.delay <= 0.5;
/** @type {Goal} */
const delayGoal = { id: 'delay', type: 'metric', text: 'Messages arrive within 0.5 s', test: fast, val: (m) => (m.chat ? (m.chat.delay < 1 ? `${fmt(m.chat.delay * 1000)} ms` : `${m.chat.delay.toFixed(1)} s`) : '—') };
/** @type {Goal} */
const pushGoal = { id: 'push', type: 'metric', text: 'Offline friends are told at once', test: (m) => !!m.chat && m.chat.notified === 1, val: (m) => (m.chat ? (m.chat.notified ? 'push' : 'next open') : '—') };
const presenceOk = (m) => !!m.chat && m.chat.presenceLoad <= PRESENCE_CAP && m.chat.flips === 0;
/** @type {Goal} */
const presenceGoal = { id: 'presence', type: 'metric', text: 'Green dots keep up and don\'t flicker', test: presenceOk, val: (m) => (m.chat ? `${fmt(m.chat.presenceLoad / 1000)}k/s` : '—') };

/** @type {Level} */
export default {
  id: 18,
  saveKey: 'sdl-level18-v1',
  saveVersion: 1,
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
      desc: `Servers that hold users' open connections and pass messages between them. Each has 8 GB of memory for connections, about ${CONN_KB} KB each: ${fmt(SERVER_CONNS)} connections. $300 a month each.`,
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
        acceptedHtml: `<p><b>Estimate accepted.</b></p><div class="calc">2,000,000 × ${CONN_KB} KB = 20,000,000 KB = 20 GB<br>At 8 GB per server: 3 servers, and a 4th so one can die</div>`,
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
      { q: 'Why is WebSocket the usual choice for receiving chat messages?', o: ['It needs no server memory for each open connection', 'The server can push over one open connection', 'It works only on mobile', 'It replaces the database'], a: 1, e: 'HTTP is started by the client. WebSocket upgrades one HTTP connection into a persistent two-way one, so the server sends each message as it arrives.', r: 'WebSocket' },
      { q: 'What goes wrong with long polling behind a round-robin load balancer?', o: ['Messages are encrypted twice', 'Requests never time out, so the servers slowly fill up with held connections', 'Clients can\'t send', 'The message may land on a server not holding the recipient\'s request'], a: 3, e: 'HTTP servers are stateless; the sender\'s message can reach a server that isn\'t holding the recipient\'s waiting request, so it waits for the next poll.', r: 'Long polling' },
      { q: 'Why are chat servers stateful?', o: ['Each client holds a connection to one server', 'They store all messages', 'They run the database', 'They keep every user\'s password and profile in memory'], a: 0, e: 'A client stays connected to the same chat server while it is healthy. Login, profiles and settings live on stateless API servers.', r: 'Stateful service' },
      { q: 'What does service discovery do for a chat app?', o: ['Encrypts messages', 'Stores the chat history', 'Gives a client a healthy chat server to connect to', 'Sends push notifications to every device a user owns'], a: 2, e: 'It knows every chat server, its location and load, and hands the client the best one: at login, and again when its server dies.', r: 'Service discovery' },
      { q: '2 million connections at 10 KB each. How much memory?', o: ['2 GB', '200 GB', '20 GB', '20 MB'], a: 2, e: '2 × 10⁶ × 10 KB = 2 × 10⁷ KB = 20 GB. It might fit one box, but one box is a single point of failure.', r: 'Scalability' },
      { q: 'Which store suits chat history best?', o: ['A key-value store', 'A spreadsheet', 'The CDN', 'The client\'s memory only'], a: 0, e: 'Huge volume, mostly recent reads, roughly 1:1 reads to writes: a key-value store scales out easily and answers recent messages fast.', r: 'Storage' },
      { q: 'Why not order messages by their created_at time?', o: ['Clocks are always wrong', 'Timestamps take too many bytes to store per message', 'It\'s slower than IDs', 'Two messages can share a timestamp'], a: 3, e: 'Two messages can be created at the same moment. A message ID that is unique and grows with time (a global or a per-chat sequence) gives the order.', r: 'Message ID' },
      { q: 'How does a phone know which messages it is missing?', o: ['It downloads the whole chat history again every time it opens', 'It compares its last message ID with the store', 'The server guesses', 'Friends resend them'], a: 1, e: 'Each device keeps cur_max_message_id and fetches the messages for its user with larger IDs. Each device syncs on its own.', r: 'Multiple devices' },
      { q: 'Why use heartbeats for the green dot?', o: ['So short drops don\'t flip the status', 'To save battery', 'To encrypt the status', 'To count how many messages each user sends a day'], a: 0, e: 'Connections drop in tunnels and elevators. With a heartbeat every few seconds and "offline" only after, say, 30 s of silence, short drops go unnoticed.', r: 'Online presence' },
      { q: 'A fan group has 50,000 members. Why not push every status change to all of them?', o: ['Groups can\'t have statuses', 'Each change would be 50,000 events', 'Statuses are secret', 'Push notifications are too slow for that many people'], a: 1, e: 'Fan out one status change to every member and it costs 50,000 events. For big groups, fetch statuses when a member opens the group.', r: 'Online status fanout' },
    ],
  },

  // Lesson tab content (HTML). The diagram below draws into figChat.
  lessonHtml: `
    <p class="label">Level 18 · Chat system</p>
    <h1>Chat system</h1>
    <p class="lede">A chat app delivers messages between people the moment they are sent, keeps them forever, and shows who is online. Clients never talk to each other directly: each keeps a connection to a chat server. In this level, capacity is counted in open connections, not only requests.</p>
    <div class="goals-box">
      <div><b>You will learn</b>Polling, long polling and WebSocket, stateful servers, service discovery, message IDs, presence.</div>
      <div><b>You will decide</b>The protocol, chat servers, reconnects, offline delivery and presence.</div>
      <div><b>You will estimate</b>The memory for all open connections.</div>
    </div>

    <section>
      <h2>Scope it</h2>
      <p class="src">Requirements</p>
      <p>Ask: one-on-one or groups (both, groups up to 150), mobile and web (both, several devices per account), how many users (40 million a day), message size (text, under 50,000 characters), encryption (not now), history (forever). Plus online status and push notifications.</p>
    </section>

    <section>
      <h2>How the server reaches the client</h2>
      <p class="src">Polling · Long polling · WebSocket</p>
      <p>Sending is easy: an HTTP request (keep-alive saves handshakes). Receiving is the problem, because HTTP is started by the client.</p>
      <ul>
        <li><b>Polling:</b> ask every few seconds. Mostly "nothing new", and messages wait.</li>
        <li><b>Long polling:</b> the server holds the request until a message arrives or a timeout. But the message may land on a server that isn't holding the recipient's request, the server can't tell when a client is gone, and idle users still reconnect after every timeout.</li>
        <li><b>WebSocket:</b> an HTTP connection upgraded to a persistent, two-way one, on ports 80 and 443 so it passes firewalls. The server pushes at once. Use it for sending too.</li>
      </ul>
      <figure class="fig"><svg id="figChat" viewBox="0 0 660 210" role="img" aria-label="User A sends a message to chat server 1 over WebSocket; it gets an ID and is stored in the message store; chat server 2 pushes it to user B over B's WebSocket, or a push notification goes out if B is offline."></svg><figcaption>A one-on-one message: store it, then push it to the recipient's server</figcaption></figure>
    </section>

    <section>
      <h2>Stateless and stateful parts</h2>
      <p class="src">High-level design</p>
      <ul>
        <li><b>Stateless API servers</b> behind a load balancer: sign-up, login, profiles. Also <b>service discovery</b>, which gives each client the best chat server (by location and load), and a new one if its server dies.</li>
        <li><b>Stateful chat servers</b>: a client stays connected to one while it is healthy. <b>Presence servers</b> track who is online.</li>
        <li><b>Push notifications</b> for offline recipients (Level 16), and a <b>key-value store</b> for history: huge, mostly recent reads, about 1:1 reads to writes.</li>
      </ul>
      <p>2 million connections × 10 KB = 20 GB: it might fit one box, but one box is a single point of failure.</p>
    </section>

    <section>
      <h2>Messages and IDs</h2>
      <p class="src">Data models · Message flows</p>
      <p>A one-on-one message is keyed by message ID; a group message by (channel ID, message ID), with channel ID as the partition key. created_at can't order messages, since two can share a time: use an ID that is unique and grows with time, either global (Level 13) or a per-chat sequence. The flow: chat server 1 gets an ID, puts the message on the recipient's <b>sync queue</b> and in the store; if the recipient is online, their chat server pushes it, otherwise a push notification goes out. Each device keeps its <code>cur_max_message_id</code> and fetches anything newer. A small group copies each message into every member's inbox.</p>
    </section>

    <section>
      <h2>Online presence</h2>
      <p class="src">Heartbeats · Status fanout</p>
      <p>Marking a user offline on every disconnect makes the dot flicker in every tunnel. Instead the client sends a <b>heartbeat</b> every few seconds; no heartbeat for 30 s means offline. Each status change goes to friends through a channel per friend pair. In a 50,000-member fan group that is 50,000 events per change: fetch statuses when someone opens the group instead.</p>
    </section>

    <section>
      <h2>How this level is simulated</h2>
      <p class="src">Game assumptions</p>
      <p>${fmt(ONLINE / 1e6)} million users online, ${fmt(MSGS)} messages a second at the peak. A chat server holds ${fmt(SERVER_CONNS)} connections (8 GB at ${CONN_KB} KB each) and handles ${fmt(MSG_CAP)} WebSocket messages or ${fmt(REQ_CAP)} HTTP requests a second. Polling asks every ${POLL_S} s; long polling times out after ${LONG_S} s. ${Math.round(100 * OFFLINE)}% of recipients are offline (${Math.round(100 * NIGHT_OFFLINE)}% at night). Each status change goes to ${FRIENDS} friends; presence servers handle ${fmt(PRESENCE_CAP / 1e6)} million events a second.</p>
      <p class="assume">Game assumptions: a session lasts 30 minutes on average; ${Math.round(100 * TRAIN)}% of users are on trains in the tunnel test; chat servers $300 a month, the message store $500.</p>
    </section>

    <section>
      <h2>Numbers to carry into the interview</h2>
      <p class="src">Capacity estimates</p>
      <p><b>Connection memory</b> = connections × memory each. 2 million × 10 KB = 20 GB.</p>
      <p><b>Polling load</b> = users ÷ interval. 2 million every 5 s = 400,000 requests a second, mostly empty.</p>
    </section>

    <section>
      <h2>How each mission maps to the interview</h2>
      <p class="src">Interview loop · times for a 45-minute interview (formats vary by company)</p>
      <div class="steps4">
        <div><span>Step 1 · 5–8 min</span><b>Scope it</b>One-on-one and groups, devices, users, message size, history.</div>
        <div><span>Step 2 · 10–12 min</span><b>Sketch it</b>WebSocket, stateless API servers, stateful chat servers, KV store, push.</div>
        <div><span>Step 3 · 15–20 min</span><b>Go deep</b>Service discovery, message IDs and sync, group inboxes, presence.</div>
        <div><span>Step 4 · 5 min</span><b>Stress it</b>A chat server dies, a user goes offline, a train goes through tunnels.</div>
      </div>
    </section>
`,

  // Lesson diagram. `f` provides the engine's drawing helpers.
  drawFigures(f) {
    const { $, figNode, figArrow, figDefs } = f;
    const f1 = $('figChat'); f1.textContent = ''; figDefs(f1);
    figNode(f1, 'users', 100, 50, 'User A', 'Sends "on my way"');
    figNode(f1, 'chatsrv', 330, 50, 'Chat server 1', 'Gets an ID');
    figNode(f1, 'msgstore', 330, 160, 'Message store', 'Keeps it forever');
    figNode(f1, 'chatsrv', 560, 50, 'Chat server 2', 'Pushes it to B');
    figNode(f1, 'users', 560, 160, 'User B', 'Online: WebSocket');
    figArrow(f1, 196, 50, 234, 50, '', null, 0, 0);
    figArrow(f1, 330, 76, 330, 134, '', null, 0, 0);
    figArrow(f1, 426, 50, 464, 50, '', null, 0, 0);
    figArrow(f1, 560, 76, 560, 134, '', null, 0, 0);
  },
};
