// @ts-check
/** @import { Level, Goal, Lesson } from '../js/types.js' */
// Level 8: Message queue, workers and monitoring.
// Everything specific to this level lives here: components, rules, missions, quiz and text.
// The level zooms into one data center and shows only the parts it needs.
import { fmt, ms } from '../js/format.js';
import { COMPONENTS, T } from '../js/engine/catalog.js';
import { servedGoal, latGoal, costGoal, servedAtLeast } from './shared/goals.js';
import { dns, lb, NO_DB_NOTE, db } from './shared/components.js';
import { dnsLookup, usersToLb, lbToWeb, webToDb, lbBad } from './shared/connections.js';
import { lbText, levelComplete } from './shared/text.js';
import { failText, passText } from './shared/quiz.js';
import { dayTraffic } from './shared/workload.js';
import { STEPS } from './mock-steps.js';
import { panel } from './shared/figures.js';

const targets = { latencyMs: 150, servedPct: 99 };
/** Monthly budget of every mission, in dollars. */
const BUDGET = 2300;
/** The upload goal: creators hear back in under this many ms. */
const UPLOAD_MS = 1000;
const uploadLimit = `${UPLOAD_MS / 1000} second`; // the same goal in words

const seconds = (t) => (t < 1000 ? fmt(t) + ' ms' : t < 60000 ? (t / 1000).toFixed(1) + ' s' : (t / 60000).toFixed(1) + ' min');
const quick = (m) => m.uploadMs != null && m.uploadMs < UPLOAD_MS;
const keepsUp = (m) => m.jobsIn > 0 && m.jobsOut >= m.jobsIn * 0.999;
/** @type {Goal} */
const uploadGoal = { id: 'upload', type: 'metric', text: `Creators hear back in under ${uploadLimit}`, test: quick, val: (m) => (m.uploadMs == null ? '—' : seconds(m.uploadMs)) };
/** @type {Goal} */
const keepUpGoal = { id: 'keep-up', type: 'metric', text: 'Workers keep up with uploads', test: keepsUp, val: (m) => (m.jobsIn > 0 ? `${m.jobsOut.toFixed(2)} of ${m.jobsIn.toFixed(2)}/s` : '—') };
/** @type {Goal} */
const watchGoal = { id: 'watch', type: 'struct', text: 'Monitoring watches the queue', test: (g) => g.onPath('queue').some((q) => g.monitored.has(q.id)), val: () => '' };
const served99 = servedAtLeast(targets.servedPct);
const rate = (v) => v.toFixed(2);
const jobs = (v) => (Math.round(v) === 1 ? '1 job' : `${fmt(v)} jobs`);

// ---------------- Lesson ----------------
const [scope, sketch, deep, stress] = STEPS.map((step) => `<b>${step.name}</b>`);
const queue = COMPONENTS.queue;
const monitor = COMPONENTS.monitor;
const sizes = COMPONENTS.worker.sizes;
const jobSecs = T.job / 1000; // seconds of one vCPU to process one upload
const HOUR_S = 3600; // seconds in an hour
// Sizing example (ours): 2 jobs a second, 6 seconds of one vCPU each: 12 vCPUs, so 3 workers with 4 vCPUs.
const ex = { jobs: 2, secs: 6 };
const exVcpu = ex.jobs * ex.secs;
const exWorkers = Math.ceil(exVcpu / sizes.M.cpu);
// Check yourself: 0.5 jobs a second at 30 seconds each is 15 vCPUs.
const chk = { jobs: 0.5, secs: 30 };
const chkVcpu = chk.jobs * chk.secs;
// Backlog example (ours): 3 jobs/s arrive, the workers finish 2 jobs/s: 1 job/s more waits each second,
// 3,600 after an hour, and a new job waits 3,600 ÷ 2 = 1,800 s = 30 minutes.
const lag = { arrive: 3, finish: 2 };
const lagGrow = lag.arrive - lag.finish;
const lagHour = lagGrow * HOUR_S;
const lagWaitS = lagHour / lag.finish;
const lagWaitMin = lagWaitS / 60;

/** @type {Lesson} */
const lesson = {
  intro: {
    kicker: 'Level 8 · Part 1: Grow one app',
    title: 'Message queue, workers and monitoring',
    story: `Your platform now lets creators upload audio episodes. Processing one takes ${jobSecs} seconds of work, and your web servers do it while the creator waits. Uploads take minutes and every other page slows down. In this level the slow work moves out of the way.`,
    picture: 'figBuilt',
    alt: 'The finished design: web servers publish a job to a message queue and answer the creator at once. A group of workers takes jobs from the queue. Monitoring watches the queue.',
    outcomes: [
      'say which work should not happen while the user waits',
      'explain what a queue, a producer and a consumer do',
      'size workers from the job rate',
      'explain what a growing queue means',
      'name the metrics worth watching',
    ],
  },
  last: 'Level 7 made the design survive the loss of a whole data center. Every request is still answered while the user waits, however long the work takes.',
  parts: [
    {
      title: 'Slow uploads',
      mission: 0,
      minutes: 9,
      lead: 'Some work is too slow to do while someone waits for an answer.',
      newParts: [
        { type: 'queue', before: 1, what: 'A buffer that holds messages until something is ready to handle them.', does: 'Web servers put a message in for each job. It keeps the jobs safe, in order, until a worker takes them.', game: `$${queue.cost} a month. Takes ${fmt(queue.cap)} messages/s.` },
        { type: 'worker', before: 1, what: 'Servers that do slow jobs in the background.', does: 'Take one job at a time from the queue, do the work, and come back for the next.', game: `Four sizes, from ${sizes.S.cpu} to ${sizes.XL.cpu} vCPUs. One upload takes ${jobSecs} seconds of one vCPU.` },
      ],
      sections: [
        {
          title: 'Why does one slow job hurt everyone?',
          hook: `A page takes a web server ${ms(T.web)} of work. An upload takes ${jobSecs} seconds: a thousand times more.`,
          body: [
            { p: 'While a web server processes an upload, that part of it is busy and cannot answer pages. A few uploads at once fill the server, and everyone waits in line behind them, as in Level 1.' },
            { p: 'The creator does not need the processing to be finished. They need to know the upload <b>arrived</b>. So split the request in two: answer now, do the work later. Doing work later, outside the request, is called <b>asynchronous</b> processing.' },
          ],
          takeaway: 'Answer the user now, and do slow work later, outside the request.',
          quiz: [],
        },
        {
          title: 'What does a message queue do?',
          hook: 'It sits between the servers that create jobs and the servers that do them.',
          body: [
            {
              figure: 'figQueue',
              alt: 'A web server, the producer, publishes a job to the queue and answers the creator at once. Workers, the consumers, take jobs from the queue when they are free.',
              caption: 'The producer publishes and moves on. A consumer takes the job when it is free',
            },
            { ul: [
              'A <b>producer</b> puts a <b>message</b> on the queue: "process episode 81". Here the web servers are the producers.',
              'The <b>queue</b> keeps messages safe until they are handled. A <b>durable</b> queue writes them to disk, so a restart of the queue loses nothing.',
              'A <b>consumer</b> takes a message and does the work. Here the workers are the consumers.',
            ] },
            { p: 'The web server only publishes a message, which takes milliseconds, so the creator hears back at once.' },
          ],
          takeaway: 'Producers put jobs on the queue, and consumers take them when they are free.',
          quiz: [0, 1],
        },
        {
          title: 'How many workers keep up?',
          hook: `Workers must finish jobs as fast as they arrive. Count the work in vCPUs. Say ${ex.jobs} jobs arrive each second and one takes ${ex.secs} seconds of one vCPU.`,
          body: [
            {
              calc: {
                formula: 'vCPUs kept busy = jobs a second × seconds of one vCPU for each job.',
                rows: [
                  { label: 'Work arriving', work: `${ex.jobs} jobs/s × ${ex.secs} s each`, result: `${exVcpu} vCPUs` },
                  { label: `Workers with ${sizes.M.cpu} vCPUs`, work: `${exVcpu} vCPUs ÷ ${sizes.M.cpu} vCPUs`, result: `${exWorkers} workers` },
                ],
                result: `${exVcpu} vCPUs are busy all the time, so ${exWorkers} workers of that size only just keep up. Add some room.`,
              },
            },
            { p: 'With fewer, jobs arrive faster than they leave and the queue grows without end.' },
          ],
          takeaway: 'Jobs a second times seconds per job gives the vCPUs you need.',
          quiz: [9],
        },
      ],
      checks: [
        {
          q: `Jobs arrive at ${chk.jobs} a second. Each takes ${chk.secs} seconds of one vCPU. How many vCPUs keep up?`,
          options: [
            { t: `${chk.secs} vCPUs`, why: 'That is the time for one job. Multiply by how many jobs arrive each second.' },
            { t: `${chkVcpu} vCPUs`, right: true, why: `${chk.jobs} × ${chk.secs} = ${chkVcpu}. Half a job a second, ${chk.secs} seconds of work each.` },
            { t: `${chk.secs / chk.jobs} vCPUs`, why: 'Multiply the rate by the work. Do not divide.' },
          ],
        },
      ],
      youWill: [
        'estimate the vCPUs the workers need (Play stays locked until you do)',
        'add a message queue and workers, and connect web servers → queue → workers',
        `get creators an answer in under ${uploadLimit}, with Response under ${ms(targets.latencyMs)} for everyone else`,
        `stay within $${fmt(BUDGET)} a month`,
      ],
      debrief: {
        saw: 'The web servers only published a message, so creators heard back at once and pages were fast again.',
        number: [`${jobSecs} vCPUs`, 'busy for every upload a second'],
        next: 'A bad deploy is about to crash every worker for half an hour.',
      },
    },
    {
      title: 'A bad deploy',
      mission: 1,
      minutes: 8,
      lead: 'The web servers and the workers no longer talk to each other. They only talk to the queue.',
      newParts: [
        { type: 'monitor', before: 1, what: 'A service that collects numbers and logs from your servers.', does: 'Shows how the system is doing and alerts the engineer on call when a number goes wrong.', game: `$${monitor.cost} a month. Connect it to the queue.` },
      ],
      sections: [
        {
          title: 'What happens to jobs when the workers are down?',
          hook: 'Nothing. They wait.',
          body: [
            {
              figure: 'figDown',
              alt: 'With the workers down, web servers keep publishing jobs and the queue fills up while monitoring raises an alert. When the workers return they work through the waiting jobs, oldest first.',
              caption: 'The queue holds the jobs until the workers return',
            },
            { p: 'The web servers keep publishing and creators keep getting answers. When the workers return, they work through the backlog. Because the two sides only share the queue, each can fail, be updated or be resized without the other noticing. This is <b>decoupling</b>.' },
            { p: 'A worker confirms each job when it is done. If it crashes halfway, the queue hands the job to another worker. So a job can run twice, and must be safe to repeat.' },
          ],
          takeaway: 'A queue lets producers and consumers fail and scale separately.',
          quiz: [2, 5],
        },
        {
          title: 'How do you find out that something is wrong?',
          hook: 'With the workers down, nothing fails on screen. Episodes just stop appearing. Someone has to be told.',
          body: [
            { table: { head: ['Kind of metric', 'Example'], rows: [
              ['<b>Host</b>: one server', 'CPU, memory and disk use of worker 3'],
              ['<b>Tier</b>: a whole group', 'Jobs waiting in the queue; average database load'],
              ['<b>Business</b>', 'Episodes uploaded per hour'],
            ] } },
            { p: 'A <b>metric</b> is a number measured over time. A <b>log</b> is the record of what each server did, collected in one place for searching. An <b>alert</b> tells a person when a metric crosses a line.' },
            { p: 'Four numbers are worth watching on any service: response time, traffic, errors, and how full it is. And test every change automatically before it ships (<b>continuous integration</b>), so fewer bad deploys reach the servers.' },
          ],
          takeaway: 'Measure every tier, and alert a person when a number goes wrong.',
          quiz: [6, 7, 8],
        },
      ],
      checks: [
        {
          q: 'The workers crash for an hour. A creator uploads an episode during that hour. What happens?',
          options: [
            { t: 'The upload fails', why: 'The web server only needs the queue, and the queue is up.' },
            { t: 'The upload is accepted and processed after the workers return', right: true, why: 'The job waits in the queue. The creator gets an answer at once; the episode appears later.' },
            { t: 'The job is lost', why: 'The queue keeps every message until a worker confirms it is done.' },
          ],
        },
      ],
      youWill: [
        'add monitoring and connect it to the queue',
        'crash the workers with the Break it button: uploads must still be accepted',
        'watch the queue grow, the alert fire, and the backlog clear when the workers return',
      ],
      debrief: {
        saw: 'The web servers never noticed the crash. The queue kept every job, and an alert told you it was growing.',
        number: ['0 jobs', 'lost while the workers were down'],
        next: 'Every Monday morning creators upload three times as many episodes as usual.',
      },
    },
    {
      title: 'Monday rush',
      mission: 2,
      minutes: 6,
      lead: 'Workers sized for a normal day fall behind on a busy one.',
      sections: [
        {
          title: 'What does the length of the queue tell you?',
          hook: `Jobs arrive at ${lag.arrive} a second. The workers finish ${lag.finish} a second.`,
          body: [
            {
              calc: {
                formula: 'Queue growth = jobs arriving − jobs finished. Wait = jobs waiting ÷ jobs finished a second.',
                rows: [
                  { label: 'Growth', work: `${lag.arrive} jobs/s − ${lag.finish} jobs/s`, result: `${lagGrow} job/s` },
                  { label: 'After an hour', work: `${lagGrow} job/s × ${fmt(HOUR_S)} s`, result: `${fmt(lagHour)} jobs waiting` },
                  { label: 'Wait for a new job', work: `${fmt(lagHour)} jobs ÷ ${lag.finish} jobs/s`, result: `${fmt(lagWaitS)} s = ${lagWaitMin} minutes` },
                ],
                result: `After one hour, a new upload waits ${lagWaitMin} minutes, and it gets worse every second.`,
              },
            },
            { ul: [
              '<b>Growing queue:</b> too few workers. Add some.',
              '<b>Queue empty most of the day:</b> too many workers. Remove some and save money.',
            ] },
          ],
          takeaway: 'A growing queue means too few workers, and an empty one means too many.',
          quiz: [3, 4],
        },
        {
          title: 'How to let the workers follow the queue',
          hook: 'Workers hold nothing between jobs: they are stateless. So they can be autoscaled, like the web servers in Level 6.',
          body: [
            { p: 'Here the autoscaler watches the queue, not the traffic. When the queue grows it adds workers, and when the queue is empty it removes them. You pay for Monday only on Monday.' },
            { assume: `In the game a group grows to at most ${T.maxCopies} workers, so the size you pick still matters.` },
          ],
          takeaway: 'Autoscale the workers on the length of the queue.',
          quiz: [],
        },
      ],
      checks: [
        {
          q: 'At night the queue is empty and eight workers sit idle. During the day the queue never grows. What do you change?',
          options: [
            { t: 'Nothing: an empty queue is the goal', why: 'An empty queue all day means you are paying for workers with nothing to do.' },
            { t: 'Let the workers scale down when the queue is empty', right: true, why: 'Fewer workers at night, more when the queue grows. The queue length tells you both.' },
          ],
        },
      ],
      youWill: [
        'set the workers to autoscale, and pick a size that can carry the rush',
        'press Monday rush to triple the uploads and check that the workers keep up',
        `stay within $${fmt(BUDGET)} a month`,
      ],
    },
  ],
  wrap: {
    picture: 'figBuiltEnd',
    alt: 'The design you built: web servers publish a job to a message queue and answer the creator at once. A group of workers takes jobs from the queue. Monitoring watches the queue.',
    say: [
      '"Slow work goes on a queue: the web server answers at once and workers do the job later."',
      '"The queue decouples producers from consumers, so each can fail and scale on its own."',
      '"I alert on queue length and autoscale the workers on it."',
    ],
    numbers: [
      [`${jobSecs} seconds`, 'of one vCPU to process an upload, in the game'],
      [fmt(HOUR_S), 'seconds in an hour, for turning a rate into a backlog'],
    ],
    loop: `The interview steps again: ${scope} (the vCPUs the workers need), ${sketch} (queue between web servers and workers), ${deep} (worker size and autoscaling), ${stress} (you crashed the workers and tripled the uploads).`,
    broken: 'The database is the one part that still cannot be scaled out for writes, and writes keep growing. Level 9 splits it.',
  },
};

/**
 * The finished design, drawn for the intro and again for the wrap-up: requests reach the web servers, which publish
 * each upload's job to the queue; a group of workers that grows and shrinks takes the jobs; monitoring watches the queue.
 * @param {Record<string, Function>} f the drawing helpers `drawFigures` is given
 * @param {SVGSVGElement} svg
 */
function drawBuilt(f, svg) {
  const { svgEl, figNode, figArrow, figSvg, figLabel, figDash } = f;
  figSvg(svg, 446);
  figNode(svg, 'users', 160, 46, 'Users', 'Listen and upload');
  figNode(svg, 'lb', 160, 156, 'Load balancer', 'Shares requests');
  figNode(svg, 'web', 160, 266, 'Web servers', 'Answer at once');
  figNode(svg, 'db', 160, 396, 'Database', 'Episodes, accounts');
  figNode(svg, 'monitor', 480, 156, 'Monitoring', 'Alerts on the queue');
  figNode(svg, 'queue', 480, 266, 'Message queue', 'Jobs wait here');
  svgEl('rect', { x: 370, y: 330, width: 220, height: 106, rx: 12, class: 'tier-box' }, svg);
  figLabel(svg, 384, 350, 'Grows and shrinks', 'start', 'tier-label');
  figNode(svg, 'worker', 480, 396, 'Workers', 'Process uploads');
  figArrow(svg, 160, 76, 160, 126, 'requests', null, 172, 106);
  figArrow(svg, 160, 186, 160, 236, '', null, 0, 0);
  figArrow(svg, 160, 296, 160, 366, 'queries', null, 172, 336);
  figArrow(svg, 254, 266, 386, 266, 'publish a job', null, 320, 258, 'middle');
  figArrow(svg, 540, 296, 540, 366, 'take a job', null, 552, 322);
  figDash(svg, 'M480 186 V236');
  figLabel(svg, 492, 216, 'watches', 'start');
}

/** @type {Level} */
export default {
  id: 8,
  saveKey: 'sdl-level8-v1',
  saveVersion: 2, // 2: which missions were opened from the lesson (`opened`)
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
      { q: 'What does a message queue do between web servers and workers?', o: ['Answers database queries faster', 'Holds jobs until a worker takes them', 'Spreads incoming requests over the web servers', 'Caches finished files near users'], a: 1, e: 'Producers publish messages to the queue, and consumers take them when they are ready. The queue buffers the work in between.', r: 'What does a message queue do?' },
      { q: 'In this design, which are the producers?', o: ['The workers that process files', 'The web servers', 'The database behind the web servers', 'Monitoring'], a: 1, e: 'The web servers create the messages and publish them to the queue. The workers consume them.', r: 'What does a message queue do?' },
      { q: 'The workers are down for an hour. What happens to new uploads?', o: ['They fail until the workers are back', 'The web servers process them instead', 'They wait safely in the queue', 'The queue deletes the oldest ones'], a: 2, e: 'The queue is durable: messages wait until a consumer takes them. Producers keep publishing while consumers are down.', r: 'What happens to jobs when the workers are down?' },
      { q: 'The queue keeps growing during the day. What should you do?', o: ['Add more workers', 'Add more web servers', 'Give the queue less memory', 'Turn off the monitoring alerts'], a: 0, e: 'A growing queue means jobs arrive faster than the workers take them. More workers raise the rate they are taken at.', r: 'What does the length of the queue tell you?' },
      { q: 'The queue is empty most of the day. What can you do?', o: ['Remove the queue', 'Add web servers', 'Move jobs back to the web servers for speed', 'Remove some workers to save money'], a: 3, e: 'An empty queue means the workers have spare capacity. Fewer workers still keep up, and cost less.', r: 'What does the length of the queue tell you?' },
      { q: 'Why can producers and consumers be scaled independently?', o: ['They share one server', 'They run the same code on one machine', 'The queue decouples them', 'The load balancer sizes both'], a: 2, e: 'Neither side calls the other directly. Each only talks to the queue, so you can add web servers or workers without changing the other.', r: 'What happens to jobs when the workers are down?' },
      { q: 'Which is a host-level metric?', o: ['Daily active users', 'CPU use of one server', 'Hit rate of the whole cache tier', 'Revenue per day'], a: 1, e: 'Host-level metrics describe one machine: CPU, memory, disk I/O. A whole tier\'s numbers are aggregated metrics; users and revenue are business metrics.', r: 'How do you find out that something is wrong?' },
      { q: 'Which is a business metric?', o: ['Disk I/O on the database server', 'Average latency of the cache tier', 'Episodes uploaded per hour', 'Memory used by one worker'], a: 2, e: 'Business metrics describe what the product achieves, such as sign-ups, uploads or revenue. The others describe machines or tiers.', r: 'How do you find out that something is wrong?' },
      { q: 'What is continuous integration?', o: ['Every check-in is built and tested automatically', 'Running every server at one hundred percent all day', 'A queue between two services', 'Deploying to every data center by hand'], a: 0, e: 'With continuous integration, each code check-in is verified by an automated build and tests, so problems are found early.', r: 'How do you find out that something is wrong?' },
      { q: 'Uploads arrive at 3 a second, and each takes 10 seconds of one vCPU. How many vCPUs keep up?', o: ['3', '10', '300', '30'], a: 3, e: '3 jobs a second × 10 vCPU-seconds each = 30 vCPUs busy all the time. Fewer, and the queue grows.', r: 'How many workers keep up?' },
    ],
  },

  lesson,

  // Lesson diagrams. `f` provides the engine's drawing helpers. Each figure sets its own viewBox.
  drawFigures(f) {
    const { $, svgEl, figNode, figArrow, figSvg, figLabel, figDash } = f;

    // The producer publishes (1) and answers the creator at once (2); a free consumer takes the job (3).
    const f1 = figSvg($('figQueue'), 346);
    figNode(f1, 'users', 130, 46, 'Creator', 'Uploads an episode');
    figNode(f1, 'web', 130, 176, 'Web server', 'Producer');
    figNode(f1, 'queue', 435, 176, 'Message queue', 'Jobs in order');
    figNode(f1, 'worker', 330, 306, 'Worker 1', 'Consumer');
    figNode(f1, 'worker', 540, 306, 'Worker 2', 'Consumer');
    figArrow(f1, 110, 76, 110, 146, 'upload', null, 98, 116, 'end');
    figArrow(f1, 224, 168, 341, 168, 'publish', '1', 262, 158);
    figArrow(f1, 150, 146, 150, 76, 'done, we got it', '2', 182, 116);
    figArrow(f1, 400, 206, 340, 276, 'take', '3', 302, 246);
    figArrow(f1, 470, 206, 530, 276, '', null, 0, 0);

    // Workers down: jobs pile up and monitoring alerts. Workers back: they work through the backlog, oldest first.
    const f2 = figSvg($('figDown'), 428);
    const panels = [
      { y: 10, label: 'Workers down: jobs wait', queueSub: 'Filling up', monitorSub: 'Alert: queue grows' },
      { y: 222, label: 'Workers back: oldest job first', queueSub: 'Emptying', monitorSub: 'Queue shrinking' },
    ];
    for (const { y, label, queueSub, monitorSub } of panels) {
      panel(f, f2, y, 196, label);
      figNode(f2, 'web', 160, y + 56, 'Web servers', 'Keep publishing');
      figNode(f2, 'queue', 480, y + 56, 'Message queue', queueSub);
      figNode(f2, 'monitor', 160, y + 156, 'Monitoring', monitorSub);
      figArrow(f2, 254, y + 56, 386, y + 56, 'publish', null, 320, y + 48, 'middle');
      figDash(f2, `M254 ${y + 146} L386 ${y + 76}`);
      figLabel(f2, 326, y + 142, 'watches');
    }
    figNode(svgEl('g', { class: 'fig-down' }, f2), 'worker', 480, 166, 'Workers', 'Crashed');
    figNode(f2, 'worker', 480, 378, 'Workers', 'Oldest job first');
    figArrow(f2, 480, 308, 480, 348, 'take', null, 492, 332);

    drawBuilt(f, $('figBuilt'));
    drawBuilt(f, $('figBuiltEnd'));
  },
};
