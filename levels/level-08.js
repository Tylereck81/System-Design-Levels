// @ts-check
/** @import { Level, Goal } from '../js/types.js' */
// Level 8: Message queue, workers and monitoring.
// Everything specific to this level lives here: components, rules, missions, quiz and text.
// The level zooms into one data center and shows only the parts it needs.
import { fmt } from '../js/format.js';
import { servedGoal, latGoal, costGoal, servedAtLeast } from './shared/goals.js';
import { dns, lb, NO_DB_NOTE, db } from './shared/components.js';
import { dnsLookup, usersToLb, lbToWeb, webToDb, lbBad } from './shared/connections.js';
import { lbText, levelComplete } from './shared/text.js';
import { failText, passText } from './shared/quiz.js';
import { dayTraffic } from './shared/workload.js';

const targets = { latencyMs: 150, servedPct: 99 };
const BUDGET = 2300;
const UPLOAD_MS = 1000;

const seconds = (ms) => (ms < 1000 ? fmt(ms) + ' ms' : ms < 60000 ? (ms / 1000).toFixed(1) + ' s' : (ms / 60000).toFixed(1) + ' min');
const quick = (m) => m.uploadMs != null && m.uploadMs < UPLOAD_MS;
const keepsUp = (m) => m.jobsIn > 0 && m.jobsOut >= m.jobsIn * 0.999;
/** @type {Goal} */
const uploadGoal = { id: 'upload', type: 'metric', text: 'Creators hear back in under 1 second', test: quick, val: (m) => (m.uploadMs == null ? '—' : seconds(m.uploadMs)) };
/** @type {Goal} */
const keepUpGoal = { id: 'keep-up', type: 'metric', text: 'Workers keep up with uploads', test: keepsUp, val: (m) => (m.jobsIn > 0 ? `${m.jobsOut.toFixed(2)} of ${m.jobsIn.toFixed(2)}/s` : '—') };
/** @type {Goal} */
const watchGoal = { id: 'watch', type: 'struct', text: 'Monitoring watches the queue', test: (g) => g.onPath('queue').some((q) => g.monitored.has(q.id)), val: () => '' };
const served99 = servedAtLeast(targets.servedPct);
const rate = (v) => v.toFixed(2);
const jobs = (v) => (Math.round(v) === 1 ? '1 job' : `${fmt(v)} jobs`);

/** @type {Level} */
export default {
  id: 8,
  saveKey: 'sdl-level8-v1',
  saveVersion: 1,
  targets,
  // The day's traffic curve, for the cost of autoscaled workers.
  workload: { day: dayTraffic() },

  components: {
    users: {
      name: 'Users', sub: 'Listen and upload',
      desc: 'Listeners open episode pages; creators upload new episodes. At peak, 1 request in 1,000 is an upload: 1 a second.',
    },
    dns: dns(),
    lb: lb(),
    web: {
      name: 'Web server', short: 'Your back-end code',
      desc: 'Runs your back-end code. For an upload it saves the audio, then either processes it itself (trim the silence, even out the volume, cut a 30-second preview: 20 seconds of one vCPU\'s work) or puts a message on the queue and answers the creator at once.',
      noDbNote: NO_DB_NOTE,
    },
    db: db(),
    queue: {
      name: 'Message queue', short: 'Jobs wait here', sub: 'Managed · $50',
      desc: 'A durable buffer for jobs. Web servers (producers) publish a message for each upload and answer the creator at once; workers (consumers) take messages when they have time. Either side can be slow or down without the other noticing. A managed service in this game: 10,000 messages/s, 2 ms to publish, $50/month.',
    },
    worker: {
      name: 'Workers', short: 'Process uploads',
      desc: 'Servers that take jobs from the queue and process each episode. A job takes 20 seconds of one vCPU, so a worker with 4 vCPU finishes 0.2 jobs a second.',
      sizeLabel: 'Worker size',
      sizeWhat: (s) => `${s.cpu} vCPU`,
      subOf: (n, size, st) => {
        if (n.scaling === 'auto') return st && st.copies ? `${n.size} · auto, ×${st.copies} now` : `${n.size} · autoscaled`;
        const count = +n.scaling || 1;
        return `${count} × ${n.size} · ${(size.cap * count).toFixed(1)}/s`;
      },
      choices: [
        {
          key: 'scaling', label: 'How many',
          options: [
            { id: '1', name: '1 worker', sub: 'fixed', note: 'One worker of this size, all month.', log: 'Workers set to 1 server.' },
            { id: '2', name: '2 workers', sub: 'fixed', note: 'Two workers of this size, all month.', log: 'Workers set to 2 servers.' },
            { id: '4', name: '4 workers', sub: 'fixed', note: 'Four workers of this size, all month.', log: 'Workers set to 4 servers.' },
            { id: '8', name: '8 workers', sub: 'fixed', note: 'Eight workers of this size, all month.', log: 'Workers set to 8 servers.' },
            { id: 'auto', name: 'Autoscale', sub: '1 to 10, by queue', note: 'The autoscaler runs enough workers for the jobs arriving, at most 60% busy, plus enough to clear any backlog within a minute: from 1 to 10. You pay for the hours each one runs.', log: 'Workers set to autoscale with the queue.' },
          ],
        },
      ],
    },
    monitor: {
      name: 'Monitoring', short: 'Metrics and alerts', sub: 'Alerts · $30',
      desc: 'Collects metrics and logs, and alerts the engineer on call. Connected to the queue, it alerts when the queue grows: jobs arrive faster than the workers take them. $30/month in this game.',
    },
  },
  palette: ['dns', 'lb', 'web', 'db', 'queue', 'worker', 'monitor'],
  limits: { dns: 1, lb: 1, web: 2, db: 1, queue: 1, worker: 1, monitor: 1 },
  limitMsg: {
    dns: 'You only need one DNS service.',
    lb: 'One load balancer is enough in this level.',
    web: 'Two XL web servers carry the listeners. Move the slow work off them instead.',
    db: 'One database is enough in this level.',
    queue: 'One queue is enough: every upload job goes on it.',
    worker: 'One box of workers is enough: choose how many servers it runs in the inspector.',
    monitor: 'One monitoring service is enough.',
  },
  // Inside one data center: the parts this level needs.
  startNodes: [
    { id: 'u', type: 'users', x: 380, y: 60 },
    { id: 'd', type: 'dns', x: 120, y: 60 },
    { id: 'l', type: 'lb', x: 380, y: 168, algo: 'rr' },
    { id: 'w1', type: 'web', x: 250, y: 276, size: 'XL' },
    { id: 'w2', type: 'web', x: 510, y: 276, size: 'XL' },
    { id: 'b', type: 'db', x: 120, y: 420, size: 'XL', kind: 'sql' },
  ],
  startEdges: [
    { id: 's1', from: 'u', to: 'd' }, { id: 's2', from: 'u', to: 'l' },
    { id: 's3', from: 'l', to: 'w1' }, { id: 's4', from: 'l', to: 'w2' },
    { id: 's5', from: 'w1', to: 'b' }, { id: 's6', from: 'w2', to: 'b' },
  ],
  slots: {
    dns: { x: 120, y: 60 }, lb: { x: 380, y: 168 }, web: { x: 510, y: 276 }, db: { x: 120, y: 420 },
    queue: { x: 640, y: 372 }, worker: { x: 640, y: 468 }, monitor: { x: 640, y: 168 },
  },

  connections: {
    ok: {
      'dns|users': dnsLookup(),
      'lb|users': usersToLb(),
      'lb|web': lbToWeb(),
      'db|web': webToDb(),
      'queue|web': { from: 'web', to: 'queue', label: 'publish', desc: 'For each upload, the web server saves the audio and publishes a message: "process episode 4812". It answers the creator straight away; listeners\' pages never touch the queue.' },
      'queue|worker': { from: 'queue', to: 'worker', label: 'jobs', desc: 'Workers take messages from the queue as fast as they can process them. Messages they can\'t take yet stay in the queue.' },
      'monitor|queue': { from: 'monitor', to: 'queue', label: 'watches', desc: 'Monitoring reads the queue\'s length and alerts when it keeps growing: jobs are arriving faster than the workers take them.' },
    },
    bad: {
      ...lbBad(),
      'queue|users': 'Users upload to the web servers through the load balancer. Connect the web servers to the queue.',
      'lb|queue': 'The load balancer sends requests to web servers. Connect the web servers to the queue.',
      'db|queue': 'The database stores the site\'s data; the queue holds jobs. Connect the web servers to the queue.',
      'web|worker': 'Workers take jobs from the queue, so the web servers never wait for them. Connect the web servers to the queue, and the queue to the workers.',
      'db|worker': 'Workers process audio files from the queue. Connect the queue to the workers.',
      'monitor|web': 'Real monitoring collects metrics from every server. In this game it watches the queue: connect it there.',
      'monitor|worker': 'In this game monitoring watches the queue, which shows when workers fall behind. Connect it to the queue.',
      'db|monitor': 'In this game monitoring watches the queue. Connect it there.',
      'lb|monitor': 'In this game monitoring watches the queue. Connect it there.',
      'monitor|users': 'Monitoring alerts engineers, not users. Connect it to the queue.',
      'dns|monitor': 'In this game monitoring watches the queue. Connect it there.',
    },
  },

  missions: [
    {
      title: 'Slow uploads', ref: 'Message queue', qps: 1000, writes: 0.1, uploads: 0.001, budget: BUDGET,
      gate: {
        hidesTraffic: false,
        lo: 19.5, hi: 21,
        prompt: '<b>Estimate before you build.</b> At peak, creators upload 1 episode a second. Processing one takes 20 seconds of one vCPU. How many vCPUs must the workers have, in total, to keep up?',
        label: 'vCPUs',
        placeholder: 'e.g. 8',
        acceptedHtml: '<p><b>Estimate accepted.</b></p><div class="calc">1 upload/s × 20 vCPU-seconds each = 20 vCPUs busy all the time<br>Workers with 4 vCPU (size M): 20 ÷ 4 = 5 at least<br>Workers with 8 vCPU (size L): 20 ÷ 8 = 2.5, so 3 at least</div>',
        acceptedLog: 'Estimate accepted: the workers need 20 vCPUs to keep up. Play is unlocked.',
        notNumber: 'Type the estimate as a number of vCPUs, for example 8.',
        hints: [
          { test: (v) => v >= 0.04 && v <= 0.06, text: 'That is jobs per vCPU per second. Turn it around: vCPUs = jobs per second × seconds per job.' },
          { test: (v) => v === 1, text: 'One vCPU finishes a job every 20 seconds, not every second.' },
          { test: (v) => v >= 1100 && v <= 1300, text: 'That counts a minute of uploads. Work per second: 1 upload × 20 vCPU-seconds.' },
        ],
        fallback: 'Not quite. Multiply the uploads per second by the vCPU-seconds each one takes.',
      },
      story: 'Creators now upload episodes. Each web server processes an upload itself before it answers: it trims the silence, evens out the volume and cuts a 30-second preview. That takes 20 seconds of work, so creators wait for minutes, and listeners\' pages slow down too. Put the work on a queue and let workers do it.',
      goals: [
        { id: 'est', type: 'gate', text: 'Estimate the workers\' vCPUs' },
        uploadGoal, keepUpGoal, servedGoal(targets), latGoal(targets), costGoal(BUDGET),
      ],
      hint: 'Add a message queue and connect both web servers to it. Add workers and connect the queue to them. Then select the workers and pick at least 20 vCPUs in total, such as 8 M workers.',
      takeaway: 'Creators hear back in milliseconds, and listeners\' pages are fast again: the web servers only publish a message. The slow work runs on workers you size on their own.',
    },
    {
      title: 'A bad deploy', ref: 'Decoupling', qps: 1000, writes: 0.1, uploads: 0.001, budget: BUDGET,
      story: 'A bad deploy crashes every worker for half an hour. Creators must still be able to upload, and their jobs must wait safely until the workers are back. Someone must also find out: add monitoring that alerts when the queue grows.',
      goals: [
        uploadGoal, keepUpGoal, servedGoal(targets), latGoal(targets), costGoal(BUDGET), watchGoal,
        { id: 'crash-workers', type: 'exp', text: 'Break it: crash the workers; uploads still work, and an alert fires' },
      ],
      hint: 'Add monitoring and connect it to the queue. Then crash the workers and watch the queue grow.',
      takeaway: 'The web servers never noticed: they kept publishing, and the queue kept every job. When the workers came back, they worked through the backlog. That is decoupling: producers and consumers fail, and scale, on their own.',
    },
    {
      title: 'Monday rush', ref: 'Scaling workers', qps: 1000, writes: 0.1, uploads: 0.001, budget: BUDGET,
      story: 'Every Monday morning creators upload three times as many episodes. Fixed workers sized for a normal day fall behind, and the queue grows for hours. Enough fixed workers for Monday would blow the budget. Let the workers grow with the queue.',
      goals: [
        uploadGoal, keepUpGoal, servedGoal(targets), latGoal(targets), costGoal(BUDGET), watchGoal,
        { id: 'upload-rush', type: 'exp', text: 'Break it: triple the uploads; the workers keep up' },
      ],
      hint: 'Select the workers and set them to autoscale. A group stops at 10 servers, so pick a size whose 10 servers can take 3 jobs a second: L or XL.',
      takeaway: 'The workers grew with the queue and shrank afterwards, so you pay for Monday only on Monday. Next, the database: one server can only hold and serve so much.',
    },
  ],

  // Break-it experiments. A crash takes down the component `target` picks when it starts; a spike with
  // uploadFactor multiplies the share of uploads. `expect` is the outcome that must hold for the whole run.
  experiments: [
    {
      id: 'crash-workers', kind: 'crash', target: (g) => g.onPath('worker')[0] || null,
      label: 'Crash the workers', labelOn: 'Restart the workers',
      needsDesign: 'Build the design first: add a queue and workers, then crash the workers.',
      on: 'Every worker is down after a bad deploy.', onTone: 'bad',
      off: 'Workers restarted. They work through the jobs that waited.',
      expect: (m) => served99(m) && quick(m) && !!m.alert,
      notMet: (m) => (!m.alert
        ? `The queue grows by ${rate(m.jobsIn - m.jobsOut)} jobs a second, and nothing alerts anyone. Add monitoring and connect it to the queue.`
        : `Creators wait ${seconds(m.uploadMs || 0)} for an answer. Uploads should only be published to the queue.`),
      observed: (m) => `Observed: workers down, and uploads were still answered in ${seconds(m.uploadMs)}. ${jobs(m.backlog)} waited safely in the queue, and monitoring raised an alert.`,
    },
    {
      id: 'upload-rush', kind: 'spike', uploadFactor: 3, hud: 'uploads ×3',
      label: 'Monday rush', labelOn: 'Back to normal',
      needsDesign: 'Build the design first, then start the Monday rush.',
      on: 'Monday morning: creators upload 3 episodes a second.', onTone: 'bad',
      off: 'Uploads are back to 1 a second.',
      expect: (m) => served99(m) && keepsUp(m),
      notMet: (m) => `The workers take ${rate(m.jobsOut)} jobs a second, but ${rate(m.jobsIn)} arrive, so the queue grows. Set the workers to autoscale, with a size whose 10 servers can take 3 jobs a second.`,
      observed: (m) => `Observed: 3 uploads a second, and the workers kept up, taking ${rate(m.jobsOut)} jobs a second.`,
    },
  ],

  // Messages the engine shows for this level's design.
  text: {
    ...lbText(),
    queueGrowing: (q, alert, waiting) => (alert
      ? `Monitoring alert: the queue grows by ${rate(q.in - q.out)} jobs a second. ${jobs(waiting || 0)} waiting.`
      : `The queue grows by ${rate(q.in - q.out)} jobs a second, and nothing is watching it.`),
    levelComplete: levelComplete(8),
  },

  quiz: {
    passScore: 8,
    passText: passText(8, 'Scale the data tier with sharding'),
    failText,
    questions: [
      { q: 'What does a message queue do between web servers and workers?', o: ['Answers database queries faster', 'Holds jobs until a worker takes them', 'Spreads incoming requests over the web servers', 'Caches finished files near users'], a: 1, e: 'Producers publish messages to the queue, and consumers take them when they are ready. The queue buffers the work in between.', r: 'Message queue' },
      { q: 'In this design, which are the producers?', o: ['The workers that process files', 'The web servers', 'The database behind the web servers', 'Monitoring'], a: 1, e: 'The web servers create the messages and publish them to the queue. The workers consume them.', r: 'Message queue' },
      { q: 'The workers are down for an hour. What happens to new uploads?', o: ['They fail until the workers are back', 'The web servers process them instead', 'They wait safely in the queue', 'The queue deletes the oldest ones'], a: 2, e: 'The queue is durable: messages wait until a consumer takes them. Producers keep publishing while consumers are down.', r: 'Decoupling' },
      { q: 'The queue keeps growing during the day. What should you do?', o: ['Add more workers', 'Add more web servers', 'Give the queue less memory', 'Turn off the monitoring alerts'], a: 0, e: 'A growing queue means jobs arrive faster than the workers take them. More workers raise the rate they are taken at.', r: 'Scaling workers' },
      { q: 'The queue is empty most of the day. What can you do?', o: ['Remove the queue', 'Add web servers', 'Move jobs back to the web servers for speed', 'Remove some workers to save money'], a: 3, e: 'An empty queue means the workers have spare capacity. Fewer workers still keep up, and cost less.', r: 'Scaling workers' },
      { q: 'Why can producers and consumers be scaled independently?', o: ['They share one server', 'They run the same code on one machine', 'The queue decouples them', 'The load balancer sizes both'], a: 2, e: 'Neither side calls the other directly. Each only talks to the queue, so you can add web servers or workers without changing the other.', r: 'Decoupling' },
      { q: 'Which is a host-level metric?', o: ['Daily active users', 'CPU use of one server', 'Hit rate of the whole cache tier', 'Revenue per day'], a: 1, e: 'Host-level metrics describe one machine: CPU, memory, disk I/O. A whole tier\'s numbers are aggregated metrics; users and revenue are business metrics.', r: 'Logging, metrics, automation' },
      { q: 'Which is a business metric?', o: ['Disk I/O on the database server', 'Average latency of the cache tier', 'Episodes uploaded per hour', 'Memory used by one worker'], a: 2, e: 'Business metrics describe what the product achieves, such as sign-ups, uploads or revenue. The others describe machines or tiers.', r: 'Logging, metrics, automation' },
      { q: 'What is continuous integration?', o: ['Every check-in is built and tested automatically', 'Running every server at one hundred percent all day', 'A queue between two services', 'Deploying to every data center by hand'], a: 0, e: 'With continuous integration, each code check-in is verified by an automated build and tests, so problems are found early.', r: 'Logging, metrics, automation' },
      { q: 'Uploads arrive at 3 a second, and each takes 10 seconds of one vCPU. How many vCPUs keep up?', o: ['3', '10', '300', '30'], a: 3, e: '3 jobs a second × 10 vCPU-seconds each = 30 vCPUs busy all the time. Fewer, and the queue grows.', r: 'Numbers to carry into the interview' },
    ],
  },

  // Lesson tab content (HTML). The diagram below draws into figQueue.
  lessonHtml: `
    <p class="label">Level 8 · Message queue, workers and monitoring</p>
    <h1>Message queue, workers and monitoring</h1>
    <p class="lede">Creators upload podcast episodes, and each one needs 20 seconds of processing. In this level you take that slow work off the web servers with a message queue, run it on workers, crash the workers to see the queue protect the jobs, and add monitoring so someone knows when the queue grows.</p>
    <div class="goals-box">
      <div><b>You will learn</b>Producers, consumers and queues; why decoupling helps; logs, metrics and automation.</div>
      <div><b>You will decide</b>How big the workers are, how many run, and what monitoring watches.</div>
      <div><b>You will estimate</b>How much processing power the workers need.</div>
    </div>

    <section>
      <h2>Message queue</h2>
      <p class="src">Asynchronous messaging</p>
      <p>From this level on, the canvas zooms into one data center and shows only the parts each level needs.</p>
      <p>A <b>message queue</b> is a durable buffer, usually held in memory, that lets services talk asynchronously. <b>Producers</b> (also called publishers) create messages and publish them to the queue. <b>Consumers</b> (subscribers) connect to the queue and do the work each message describes.</p>
      <figure class="fig"><svg id="figQueue" viewBox="0 0 660 230" role="img" aria-label="Web servers publish a message for each upload to a message queue. Workers take messages from the queue and process the episodes. Monitoring watches the queue."></svg><figcaption>Web servers publish jobs; workers take them when they can</figcaption></figure>
      <p>Here, processing an episode means trimming the silence, evening out the volume and cutting a 30-second preview. The web servers publish a job for each upload and answer the creator at once. Workers pick up the jobs and process the episodes in the background.</p>
    </section>

    <section>
      <h2>Decoupling</h2>
      <p class="src">Producers and consumers</p>
      <ul>
        <li><b>Failures stay apart.</b> A producer can publish while no consumer is available, and a consumer can read messages while the producer is down. Jobs wait in the queue.</li>
        <li><b>Each side scales on its own.</b> When the queue grows, add workers to cut the waiting time. When it is empty most of the time, remove some.</li>
      </ul>
    </section>

    <section>
      <h2>Logging, metrics, automation</h2>
      <p class="src">Operating a large site</p>
      <p>On a small site these tools are good practice. Once the site serves a large business, they are essential.</p>
      <ul>
        <li><b>Logging.</b> Watch error logs to find problems. Read them on each server, or send them to a central service where they are easy to search.</li>
        <li><b>Metrics.</b> They show the system's health and how the business is doing.</li>
        <li><b>Automation.</b> With continuous integration, every code check-in is built and tested automatically, so problems show up early. Automating build, test and deployment also saves engineers a lot of time.</li>
      </ul>
      <div class="tbl-wrap"><table class="t">
        <thead><tr><th>Metric level</th><th>Examples</th></tr></thead>
        <tbody>
          <tr><td>Host</td><td>CPU, memory and disk I/O of one server</td></tr>
          <tr><td>Aggregated</td><td>Performance of a whole tier: the database tier, the cache tier</td></tr>
          <tr><td>Business</td><td>Episodes uploaded per hour, sign-ups, refunds</td></tr>
        </tbody>
      </table></div>
    </section>

    <section>
      <h2>How this level is simulated</h2>
      <p class="src">Game assumptions</p>
      <p>1 request in 1,000 is an upload. Processing an upload takes 20 seconds of one vCPU. A web server without a queue does it itself; a web server of a size does as many jobs as a worker of that size, and pages wait behind them. With a queue, the web server publishes a message in 2 ms and answers.</p>
      <p>Workers take as many jobs a second as their vCPUs allow (vCPUs ÷ 20). Jobs they can't take yet wait in the queue, and are never lost. Autoscaled workers run enough servers for the jobs arriving at most 60% busy, plus enough to clear the backlog within a minute, up to 10. Monitoring connected to the queue alerts as soon as it grows.</p>
      <p class="assume">Game assumptions: at peak 1,000 requests a second, of which 1 is an upload. The queue is a managed service: 10,000 messages a second, $50 a month, not a single point of failure. Monitoring costs $30 a month. Worker prices follow the server sizes. The canvas shows one data center and one load balancer to keep it readable.</p>
    </section>

    <section>
      <h2>Numbers to carry into the interview</h2>
      <p class="src">Throughput estimates</p>
      <p><b>Workers needed</b> = jobs per second × CPU-seconds per job, in vCPUs. For example, 1 upload a second × 20 vCPU-seconds = 20 vCPUs.</p>
      <p><b>Queue growth</b> = jobs in per second − jobs out per second. <b>Time to drain</b> a backlog = backlog ÷ (jobs out − jobs in).</p>
    </section>

    <section>
      <h2>How each mission maps to the interview</h2>
      <p class="src">Interview loop · times for a 45-minute interview (formats vary by company)</p>
      <div class="steps4">
        <div><span>Step 1 · 5–8 min</span><b>Scope it</b>Which work is slow? Does the user need the result right away?</div>
        <div><span>Step 2 · 10–12 min</span><b>Sketch it</b>Web servers publish to a queue; workers consume.</div>
        <div><span>Step 3 · 15–20 min</span><b>Go deep</b>Worker capacity, scaling with the queue, what to monitor.</div>
        <div><span>Step 4 · 5 min</span><b>Stress it</b>Crash the workers. Triple the jobs.</div>
      </div>
      <p>When you add a queue in an interview, say what goes on it, who consumes it, how you scale the consumers, and which alert tells you they are falling behind.</p>
    </section>
`,

  // Lesson diagram. `f` provides the engine's drawing helpers.
  drawFigures(f) {
    const { $, figNode, figArrow, figDefs } = f;
    const f1 = $('figQueue'); f1.textContent = ''; figDefs(f1);
    figNode(f1, 'web', 110, 50, 'Web servers', 'Producers');
    figNode(f1, 'queue', 330, 50, 'Message queue', 'Jobs wait here');
    figNode(f1, 'worker', 550, 50, 'Workers', 'Consumers');
    figNode(f1, 'monitor', 330, 190, 'Monitoring', 'Alerts if it grows');
    figArrow(f1, 206, 50, 234, 50, '', null, 0, 0);
    figArrow(f1, 426, 50, 454, 50, '', null, 0, 0);
    figArrow(f1, 330, 158, 330, 82, 'watches', null, 342, 126, 'start');
    const { svgEl } = f;
    for (const [x, t] of [[220, 'publish'], [440, 'take']]) { const e = svgEl('text', { x, y: 104, class: 'd-label', 'text-anchor': 'middle' }, f1); e.textContent = t; }
  },
};
