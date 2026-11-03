// Level 21: Cloud file sync.
// Everything specific to this level lives here: components, rules, missions, quiz and text.
import { fmt } from '../js/format.js';
import { NEW_MB, EDIT_SHARE, BIG_MB, CHANGED_MB, COMPRESS, BLOCK_MBPS, ONLINE, POLL_CONNS, RECONNECT_RATE, STORED_GB, REGIONS, ALL_VERSIONS, TEN_VERSIONS, DEDUPE, COLD_SHARE, HOT_GB, COLD_GB } from '../js/engine/sync.js';
import level2 from './level-02.js';
import level10 from './level-10.js';

const targets = { latencyMs: 1000, servedPct: 99 };
const RATE = 556; // uploads a second at the peak
const GROWTH = 1.3;
const BUDGET = 6100000;
const TIGHT = 2000000;

const pct = (x) => x.toFixed(1) + '%';
const money = (x) => '$' + (x >= 1e6 ? (x / 1e6).toFixed(2) + 'M' : fmt(x));
const costGoal = (max) => ({ id: 'cost', type: 'struct', text: `Spend at most ${money(max)} per month`, test: (g) => g.cost <= max, val: (m, g) => money(g.cost) });
const served99 = (m) => m.servedPct >= targets.servedPct;
const servedGoal = { id: 'served', type: 'metric', text: `Sync ${targets.servedPct}% of uploads`, test: served99, val: (m) => pct(m.servedPct) };
const connGoal = { id: 'conns', type: 'metric', text: 'Every online device holds a notification connection', test: (m) => !!m.sync && m.sync.fits, val: (m) => (m.sync ? `${fmt(m.sync.connsPerServer / 1000)}k per server` : '—') };
const ON = (key, label, options) => ({ key, label, options });
const OFFON = (what, off, offSub, offNote, on, onSub, onNote) => [
  { id: 'off', name: off, sub: offSub, note: offNote, log: `${what}: ${off.toLowerCase()}.` },
  { id: 'on', name: on, sub: onSub, note: onNote, log: `${what}: ${on.toLowerCase()}.` },
];

export default {
  id: 21,
  saveKey: 'sdl-level21-v1',
  saveVersion: 1,
  targets,
  workload: { sync: true, growth: GROWTH },

  components: {
    users: {
      name: 'Users', sub: 'Laptops, phones, browsers',
      desc: `40 million people, 8 million a day, each with 15 GB free. They save files on one device and expect them on every other one. About ${RATE} uploads a second at the peak; ${fmt(ONLINE / 1e6)} million devices are online.`,
    },
    lb: level2.components.lb,
    blocksrv: {
      name: 'Block servers', short: 'Split, compress, encrypt',
      desc: `Split each file into blocks of up to 4 MB, each named by its hash, compress and encrypt them, and send them to cloud storage. ${fmt(BLOCK_MBPS)} MB a second each (1 Gbps), $300 a month.`,
      subOf: (n) => `${Number(n.count) || 2} servers · ${n.delta === 'delta' ? 'delta' : 'whole files'}${n.compress === 'on' ? ' · compressed' : ''}`,
      choices: [
        ON('count', 'Servers', [2, 3, 4, 6].map((k) => ({ id: String(k), name: `${k} servers`, sub: `$${fmt(k * 300)} a month`, note: `${k} block servers: ${fmt(k * BLOCK_MBPS)} MB a second.`, log: `Block servers set to ${k}.` }))),
        ON('delta', 'Sending an edit', [
          { id: 'whole', name: 'The whole file', sub: 'every byte again', note: `A one-line change to a ${BIG_MB} MB file sends all ${BIG_MB} MB.`, log: 'Edits now send the whole file.' },
          { id: 'delta', name: 'Changed blocks only', sub: 'delta sync', note: `Compare block hashes with the stored version and send only blocks that changed: about ${CHANGED_MB} MB for a typical edit.`, log: 'Edits now send only changed blocks (delta sync).' },
        ]),
        ON('compress', 'Compression', OFFON('Compression', 'Off', 'send blocks as they are', 'Blocks are sent as they are.', 'On', 'gzip or bzip2 for text', `Compress each block with a method that suits its type (gzip or bzip2 for text; others for images and video). About ${Math.round(100 * COMPRESS)}% smaller here.`)),
      ],
    },
    pollsrv: {
      name: 'Notification servers', short: 'Tell devices about changes',
      desc: `Each online device keeps a long-poll connection here. When a file changes, the server answers, and the device fetches the new metadata and blocks. At most ${fmt(POLL_CONNS / 1e6)} million connections a server, $400 a month each.`,
      subOf: (n) => `${Number(n.count) || 4} servers · long polling`,
      choices: [
        ON('count', 'Servers', [4, 5, 6, 7, 8].map((k) => ({ id: String(k), name: `${k} servers`, sub: `$${fmt(k * 400)} a month`, note: `${k} notification servers: ${fmt(ONLINE / k / 1000)}k connections each.`, log: `Notification servers set to ${k}.` }))),
      ],
    },
    blobstore: {
      name: 'Cloud storage', short: 'Blocks, two regions',
      desc: `Keeps every block, copied to ${REGIONS} regions in case one fails. Users store ${fmt(STORED_GB / 1e6)} PB (10% of what's allocated). Hot storage costs $${HOT_GB} a GB a month; cold storage $${COLD_GB}. Its cost is the month's storage bill.`,
      subOf: (n) => [n.versions === 'ten' ? '10 versions' : 'all versions', n.cold === 'on' ? 'cold tier' : null, n.dedupe === 'on' ? 'dedupe' : null].filter(Boolean).join(' · '),
      choices: [
        ON('versions', 'Versions kept', [
          { id: 'all', name: 'Every version', sub: 'forever', note: `Every save is kept: a busy document can have a thousand versions. ${ALL_VERSIONS}× the data on average.`, log: 'Cloud storage keeps every version.' },
          { id: 'ten', name: 'The last 10', sub: 'oldest replaced', note: `Keep a limited history, weighted to recent versions: ${TEN_VERSIONS}× the data.`, log: 'Cloud storage keeps the last 10 versions.' },
        ]),
        ON('cold', 'Cold storage', OFFON('Cold storage', 'Off', 'everything hot', 'Every block stays in hot storage.', 'On', `move idle data to cold`, `Blocks not read for months move to cold storage, about a fifth of the price but slow to read: ${Math.round(100 * COLD_SHARE)}% of the data here.`)),
        ON('dedupe', 'Duplicate blocks', OFFON('Dedupe', 'Off', 'store every copy', 'Two identical blocks in an account are stored twice.', 'On', 'same hash, stored once', `Blocks with the same hash in an account are stored once: about ${Math.round(100 * DEDUPE)}% less.`)),
      ],
    },
  },
  palette: ['lb', 'blocksrv', 'pollsrv', 'blobstore'],
  limits: { lb: 2, blocksrv: 1, pollsrv: 1, blobstore: 1 },
  limitMsg: {
    lb: 'Two load balancers are enough: one active, one standby.',
    blocksrv: 'One block server box is enough: set its servers in the inspector.',
    pollsrv: 'One notification box is enough: set its servers in the inspector.',
    blobstore: 'One cloud storage is enough.',
  },
  // Users → one load balancer → block servers (whole files) → cloud storage; the load balancer → notification servers.
  startNodes: [
    { id: 'u', type: 'users', x: 380, y: 60 },
    { id: 'l', type: 'lb', x: 380, y: 175, algo: 'rr' },
    { id: 'b', type: 'blocksrv', x: 250, y: 300, count: '2', delta: 'whole', compress: 'off' },
    { id: 'n', type: 'pollsrv', x: 510, y: 300, count: '4' },
    { id: 's', type: 'blobstore', x: 250, y: 430, versions: 'all', cold: 'off', dedupe: 'off' },
  ],
  startEdges: [
    { id: 's1', from: 'u', to: 'l' }, { id: 's2', from: 'l', to: 'b' }, { id: 's3', from: 'l', to: 'n' }, { id: 's4', from: 'b', to: 's' },
  ],
  slots: { lb: { x: 640, y: 175 }, blocksrv: { x: 250, y: 300 }, pollsrv: { x: 510, y: 300 }, blobstore: { x: 250, y: 430 } },

  connections: {
    ok: {
      'lb|users': level2.connections.ok['lb|users'],
      'blocksrv|lb': { from: 'lb', to: 'blocksrv', label: 'blocks', desc: 'Uploads and downloads go to the block servers.' },
      'lb|pollsrv': { from: 'lb', to: 'pollsrv', label: 'long polls', desc: 'Each device keeps a long-poll connection to a notification server.' },
      'blobstore|blocksrv': { from: 'blocksrv', to: 'blobstore', label: 'blocks', desc: 'Block servers store and fetch blocks in cloud storage.' },
    },
    bad: {
      'blocksrv|users': 'Devices reach the block servers through the load balancer.',
      'pollsrv|users': 'Devices reach the notification servers through the load balancer.',
      'blobstore|users': 'Devices never write to storage directly here: the block servers split and encrypt first.',
      'blobstore|lb': 'The load balancer spreads requests over block and notification servers.',
      'blobstore|pollsrv': 'Notification servers only tell devices about changes; blocks go through the block servers.',
    },
  },

  missions: [
    {
      title: 'Send less', ref: 'Block servers', qps: RATE, budget: BUDGET,
      gate: {
        hidesTraffic: false,
        lo: 600, hi: 600,
        prompt: '<b>Estimate before you build.</b> 40 million users each get 15 GB free. How many PB of storage is that, allocated?',
        label: 'PB',
        placeholder: 'e.g. 50',
        acceptedHtml: `<p><b>Estimate accepted.</b></p><div class="calc">40,000,000 × 15 GB = 600,000,000 GB = 600 PB<br>Uploads: 8 million × 3 a day ÷ 86,400 ≈ 278 a second, about ${RATE} at a 2× peak</div>`,
        acceptedLog: 'Estimate accepted: 600 PB. Play is unlocked.',
        notNumber: 'Type the PB as a number, for example 50.',
        hints: [
          { test: (v) => v === 120, text: 'That counts only daily users. Every user gets 15 GB.' },
          { test: (v) => v === 60 || v === 6000, text: 'Check the units: 1 PB = 1,000,000 GB.' },
        ],
        fallback: 'Not quite. Users × 15 GB, then 10⁶ GB per PB.',
      },
      story: `${Math.round(100 * EDIT_SHARE)}% of uploads are edits to big files (${BIG_MB} MB on average), and each edit sends the whole file again: the block servers can't keep up. Sync 99% of uploads, and keep going when the load balancer fails.`,
      goals: [
        { id: 'est', type: 'gate', text: 'Estimate the allocated storage' },
        servedGoal, costGoal(BUDGET),
        { id: 'lbdown', type: 'exp', text: 'Break it: the load balancer fails; still 99% synced' },
      ],
      hint: 'Send only changed blocks (delta sync) and compress them. Add a second load balancer as a standby, connected to the block and notification servers.',
      takeaway: 'Delta sync sent a few changed blocks instead of whole files, and compression halved them. When the active load balancer stopped sending heartbeats, the standby took over.',
    },
    {
      title: 'Tell every device', ref: 'Notification service', qps: RATE, budget: BUDGET,
      story: `${fmt(ONLINE / 1e6)} million online devices each hold a long-poll connection, so a change on one shows up on the others. If a notification server dies, its devices must reconnect elsewhere, and a server can only take back ${fmt(RECONNECT_RATE)} a second. Get everyone back within a minute.`,
      goals: [
        connGoal, servedGoal, costGoal(BUDGET),
        { id: 'polldown', type: 'exp', text: 'Break it: a notification server dies; every device back within 60 s' },
      ],
      hint: 'More servers mean fewer connections lost when one dies, and more servers to take them back: try 7.',
      takeaway: 'With more notification servers, each held fewer connections, so a failure dropped fewer devices and more servers shared the reconnects. Long polling suits sync: the server only needs to say "something changed", rarely.',
    },
    {
      title: 'The storage bill', ref: 'Save storage space', qps: RATE, budget: TIGHT,
      story: `Every block is kept in ${REGIONS} regions, every version forever, all in hot storage: about ${money(STORED_GB * ALL_VERSIONS * REGIONS * HOT_GB)} a month. Bring the bill under ${money(TIGHT)}, with room for ${Math.round(100 * (GROWTH - 1))}% more data.`,
      goals: [
        servedGoal, costGoal(TIGHT),
        { id: 'growth', type: 'exp', text: `Break it: data grows ${Math.round(100 * (GROWTH - 1))}%; the bill stays within budget` },
      ],
      hint: 'Keep a limited number of versions, and move idle data to cold storage. Dropping duplicate blocks saves a little more.',
      takeaway: 'A version limit cut the history, cold storage moved idle blocks to a fifth of the price, and dedupe stored identical blocks once. Both regions still hold a copy of everything.',
    },
  ],

  // Break-it experiments. A crash takes a component down; pollDies and growth change the outcome while they run.
  experiments: [
    {
      id: 'lbdown', kind: 'crash', target: (g) => g.entry.find((n) => n.type === 'lb') || null,
      label: 'Load balancer fails', labelOn: 'Restart it',
      needsDesign: 'Build the design first: a load balancer, block servers, notification servers and cloud storage.',
      on: 'The active load balancer fails.', onTone: 'bad',
      off: 'The load balancer is back.',
      expect: served99,
      notMet: (m) => `Only ${pct(m.servedPct)} synced: every request enters through one load balancer. Add a standby connected to the block and notification servers.`,
      issue: 'The only load balancer is down, so no device can sync.',
      observed: (m) => `Observed: the load balancer failed, and ${pct(m.servedPct)} of uploads still synced through the standby.`,
    },
    {
      id: 'polldown', kind: 'event', pollDies: true,
      label: 'A notification server dies', labelOn: 'Replace it',
      needsDesign: 'Build the design first: a load balancer, block servers, notification servers and cloud storage.',
      on: 'A notification server dies, and its devices\' connections drop.', onTone: 'bad',
      off: 'A new server replaces it.',
      expect: (m) => !!m.sync && m.sync.reconnectS <= 60 && served99(m),
      notMet: (m) => (m.sync.reconnectS === Infinity
        ? `The servers left can't hold every device: ${fmt(ONLINE / 1e6)} million connections, ${fmt(POLL_CONNS / 1e6)} million each. Add servers.`
        : `It takes ${fmt(m.sync.reconnectS)} s to get every device back: ${fmt(m.sync.connsPerServer)} lost, and the others take ${fmt(RECONNECT_RATE)} a second each. Add servers.`),
      observed: (m) => `Observed: a notification server died, and every device was back in ${fmt(m.sync.reconnectS)} s.`,
    },
    {
      id: 'growth', kind: 'event', growth: true,
      label: 'Data grows', labelOn: 'Back to today',
      needsDesign: 'Build the design first: a load balancer, block servers, notification servers and cloud storage.',
      on: `Next year: ${Math.round(100 * (GROWTH - 1))}% more data stored.`, onTone: 'bad',
      off: 'Back to today\'s data.',
      expect: (m) => !!m.sync && m.cost - Math.round(m.sync.bill / GROWTH) + Math.round(m.sync.bill) <= TIGHT,
      notMet: (m) => `The storage bill would be ${money(m.sync.bill)} a month. Limit versions and use cold storage.`,
      observed: (m) => `Observed: data grew, and the storage bill would be ${money(m.sync.bill)}, within budget.`,
    },
  ],

  // Messages the engine shows for this level's design.
  text: {
    ...level2.text,
    noWeb: 'Connect the users to a load balancer.',
    levelComplete: 'Level 21 complete: every level is done. Take the quiz.',
  },

  quiz: {
    passScore: 8,
    passText: 'Level 21 is done, and with it every level. Mock interviews are next. They aren\'t built yet.',
    failText: level10.quiz.failText,
    questions: [
      { q: 'What is delta sync?', o: ['Syncing only at night', 'Sending only the blocks that changed', 'Sending every file twice, to two regions at once', 'Syncing one device at a time'], a: 1, e: 'A file is split into blocks named by their hash. After an edit, only blocks whose hash changed are uploaded.', r: 'Block servers' },
      { q: 'Why keep file metadata in a relational database here?', o: ['ACID makes strong consistency easy', 'It is cheaper per GB', 'It stores the file blocks themselves as well', 'It needs no backups'], a: 0, e: 'Two devices must never see a file differently. A relational database gives ACID transactions; caches must be invalidated on every write.', r: 'High consistency requirement' },
      { q: 'Two users edit the same file at once. What happens?', o: ['Both edits are lost', 'The larger edit wins, and the smaller one is quietly dropped', 'The first one processed wins; the other gets a conflict', 'The file is deleted'], a: 2, e: 'The second user sees both versions, theirs and the server\'s, and merges them or keeps one.', r: 'Sync conflicts' },
      { q: 'Why long polling rather than WebSocket for change notifications?', o: ['Notifications go one way, and rarely', 'Long polling is encrypted', 'WebSocket can\'t pass firewalls', 'Long polling needs no servers at all to keep running'], a: 0, e: 'The server only needs to say "something changed", now and then. WebSocket suits real-time two-way traffic such as chat.', r: 'Notification service' },
      { q: 'A device is offline when a file changes. What makes sure it catches up?', o: ['The block servers', 'The load balancer, which remembers each device', 'Cold storage', 'An offline backup queue'], a: 3, e: 'Changes for offline clients wait in an offline backup queue and sync when the device comes back.', r: 'High-level design' },
      { q: 'Which cuts storage most cheaply for files nobody opens?', o: ['Delta sync', 'Compression', 'Keeping copies in more regions around the world', 'Moving them to cold storage'], a: 3, e: 'Data idle for months moves to cold storage, much cheaper per GB but slow to read.', r: 'Save storage space' },
      { q: 'How are duplicate blocks found?', o: ['By file name', 'By upload time', 'By their hash', 'By file size'], a: 2, e: 'Identical blocks have the same hash, so an account can store each one once.', r: 'Save storage space' },
      { q: 'The active load balancer fails. How does the standby know?', o: ['Users report it', 'Heartbeats between them stop', 'The database tells it', 'It checks the DNS records every minute or so'], a: 1, e: 'Load balancers watch each other\'s heartbeats; if the active one goes quiet, the standby takes over its traffic.', r: 'Failure handling' },
      { q: 'Why is a notification server failure slow to recover from?', o: ['Its data is lost', 'Up to a million clients must reconnect elsewhere', 'Long polling can\'t restart', 'The standby server is cold and must be warmed up first'], a: 1, e: 'Each server holds a huge number of open connections; the others can only take them back so fast.', r: 'Failure handling' },
      { q: '40 million users × 15 GB free. How much storage is allocated?', o: ['6 PB', '60 PB', '600 TB', '600 PB'], a: 3, e: '4 × 10⁷ × 15 GB = 6 × 10⁸ GB = 600 PB. Most of it is never filled.', r: 'Back of the envelope' },
    ],
  },

  // Lesson tab content (HTML). The diagram below draws into figBlocks.
  lessonHtml: `
    <p class="label">Level 21 · Cloud file sync</p>
    <h1>Cloud file sync</h1>
    <p class="lede">Save a file on your laptop and it appears on your phone; share a folder and a colleague sees your changes. A sync service stores files reliably, moves as few bytes as possible, and tells every device when something changes. In this last level you make it send less, recover from failures, and keep the storage bill down.</p>
    <div class="goals-box">
      <div><b>You will learn</b>Block servers and delta sync, strong consistency, notifications by long polling, conflicts, storage savings.</div>
      <div><b>You will decide</b>Delta sync and compression, a standby load balancer, notification servers, versions, cold storage and dedupe.</div>
      <div><b>You will estimate</b>Storage allocated.</div>
    </div>

    <section>
      <h2>Scope it</h2>
      <p class="src">Requirements</p>
      <p>Ask: upload, download, sync and share (yes); notifications when a file changes; mobile and web; file types and size (any, up to 5 GB); encryption (yes); users (40 million, 8 million a day, 15 GB free). Reliability matters most: losing data is unacceptable. Then fast sync, low bandwidth, scalability, availability.</p>
      <ul>
        <li>40 million × 15 GB = 600 PB allocated.</li>
        <li>8 million × 3 uploads ÷ 86,400 ≈ 278 a second, about 556 at a 2× peak. Resumable uploads: <code>api.example.com/v1/uploads?resumable=true</code>.</li>
      </ul>
    </section>

    <section>
      <h2>Block servers</h2>
      <p class="src">Delta sync · Compression</p>
      <figure class="fig"><svg id="figBlocks" viewBox="0 0 660 160" role="img" aria-label="A file split into five blocks; after an edit only blocks 2 and 5 changed, so only those are compressed, encrypted and uploaded."></svg><figcaption>Delta sync: only the changed blocks travel</figcaption></figure>
      <p>Split each file into blocks of up to 4 MB, each named by its hash. After an edit, send only blocks whose hash changed (<b>delta sync</b>). <b>Compress</b> each block (gzip or bzip2 for text) and <b>encrypt</b> it before storage. A file is rebuilt by joining its blocks in order.</p>
    </section>

    <section>
      <h2>Metadata, consistency and conflicts</h2>
      <p class="src">High consistency requirement · Sync conflicts</p>
      <p>Two devices must never see a file differently, so metadata (users, files, blocks, versions) lives in a <b>relational database</b> with ACID transactions, and caches are invalidated on every write. When two people edit the same file at once, the first one processed wins; the other gets a <b>conflict</b> and sees both versions to merge or choose.</p>
    </section>

    <section>
      <h2>Notifications</h2>
      <p class="src">Notification service · Offline backup queue</p>
      <p>Each online device holds a <b>long-poll</b> connection to a notification server; when a file changes, the server answers, the device fetches the new metadata and blocks, and reconnects. Long polling fits because the messages are one-way and rare; WebSocket suits chat. Changes for offline devices wait in an <b>offline backup queue</b>.</p>
    </section>

    <section>
      <h2>Saving space, and failures</h2>
      <p class="src">Save storage space · Failure handling</p>
      <ul>
        <li><b>Dedupe</b> blocks with the same hash; <b>limit versions</b> (favor recent ones); move idle data to <b>cold storage</b>.</li>
        <li>Storage is copied across regions; a standby <b>load balancer</b> takes over when the active one stops sending heartbeats; API and block servers are stateless; metadata replicas are promoted when the primary dies.</li>
        <li>A <b>notification server</b> holds up to a million connections; when it dies they must all reconnect elsewhere, which is slow.</li>
      </ul>
    </section>

    <section>
      <h2>How this level is simulated</h2>
      <p class="src">Game assumptions</p>
      <p>${RATE} uploads a second at the peak. ${Math.round(100 * (1 - EDIT_SHARE))}% are new files of ${NEW_MB} MB; ${Math.round(100 * EDIT_SHARE)}% edit ${BIG_MB} MB files, changing about ${CHANGED_MB} MB. Compression saves ${Math.round(100 * COMPRESS)}%. A block server moves ${fmt(BLOCK_MBPS)} MB a second. ${fmt(ONLINE / 1e6)} million devices are online; a notification server holds up to ${fmt(POLL_CONNS / 1e6)} million and takes back ${fmt(RECONNECT_RATE)} a second after a failure. Users store ${fmt(STORED_GB / 1e6)} PB; every version kept means ${ALL_VERSIONS}× that, the last 10 ${TEN_VERSIONS}×; dedupe saves ${Math.round(100 * DEDUPE)}%; ${Math.round(100 * COLD_SHARE)}% of data is idle.</p>
      <p class="assume">Game assumptions: storage $${HOT_GB} a GB a month hot, $${COLD_GB} cold, in ${REGIONS} regions; block servers $300 a month, notification servers $400.</p>
    </section>

    <section>
      <h2>Numbers to carry into the interview</h2>
      <p class="src">Capacity estimates</p>
      <p><b>Allocated</b> = users × free space. 40 million × 15 GB = 600 PB.</p>
      <p><b>Uploads a second</b> = daily users × uploads ÷ 86,400. 8 million × 3 ≈ 278, about 556 at the peak.</p>
    </section>

    <section>
      <h2>How each mission maps to the interview</h2>
      <p class="src">Interview loop · times for a 45-minute interview (formats vary by company)</p>
      <div class="steps4">
        <div><span>Step 1 · 5–8 min</span><b>Scope it</b>Features, devices, sizes, users, and above all: never lose data.</div>
        <div><span>Step 2 · 10–12 min</span><b>Sketch it</b>Block servers, cloud storage, metadata DB, notifications, offline queue.</div>
        <div><span>Step 3 · 15–20 min</span><b>Go deep</b>Delta sync, consistency, the upload and download flows, conflicts, saving space.</div>
        <div><span>Step 4 · 5 min</span><b>Stress it</b>A load balancer fails, a notification server dies, the bill grows.</div>
      </div>
    </section>
`,

  // Lesson diagram. `f` provides the engine's drawing helpers.
  drawFigures(f) {
    const { $, figDefs, svgEl } = f;
    const label = (svg, x, y, t, anchor = 'middle', cls = 'd-label') => { const e = svgEl('text', { x, y, class: cls, 'text-anchor': anchor }, svg); e.textContent = t; };
    const f1 = $('figBlocks'); f1.textContent = ''; figDefs(f1);
    label(f1, 30, 30, 'report.docx, after an edit', 'start');
    for (let i = 0; i < 5; i++) {
      const x = 30 + i * 80, changed = i === 1 || i === 4;
      svgEl('rect', { x, y: 50, width: 70, height: 44, rx: 4, class: changed ? 'd-step' : 'ic-stroke' }, f1);
      label(f1, x + 35, 77, `block ${i + 1}`, 'middle', changed ? 'd-step-t' : 'd-label');
    }
    svgEl('line', { x1: 440, y1: 72, x2: 500, y2: 72, class: 'd-line' }, f1);
    label(f1, 515, 68, 'only 2 and 5:', 'start');
    label(f1, 515, 86, 'compress, encrypt,', 'start');
    label(f1, 515, 104, 'upload', 'start');
    label(f1, 30, 130, 'Unchanged blocks keep their hash and stay where they are.', 'start');
  },
};
