// @ts-check
/** @import { Level, Lesson } from '../js/types.js' */
// Level 20: Video platform.
// Everything specific to this level lives here: components, rules, missions, quiz and text.
import { fmt, count } from '../js/format.js';
import { servedGoal, costGoal, servedAtLeast, fmtPct, fmtMoney } from './shared/goals.js';
import { VIDEO_MB, VIEWS_DAY, VIEW_GB, API_SERVERS, API_MBPS, FAIL, PATCHY_FAIL, TRANSCODE_RATE, IN_FLIGHT, POPULAR, CDN_GB, OWN_GB } from '../js/engine/video.js';
import { lbText, levelComplete } from './shared/text.js';
import { failText, passText } from './shared/quiz.js';
import { queueCells } from './shared/figures.js';
import { COMPONENTS } from '../js/engine/catalog.js';
import { STEPS } from './mock-steps.js';

const targets = { latencyMs: 1000, servedPct: 99 };
const MONEY = { millions: true }; // bills reach millions of dollars: "$1.25M"
const RATE = 9.3; // videos uploaded a second at the peak
const GROWTH = 1.2;
const BUDGET = 3700000;
const TIGHT = 3600000;

const served99 = servedAtLeast(targets.servedPct);
const publishedGoal = servedGoal(targets, { text: `Publish ${targets.servedPct}% of uploaded videos` });
const ON = (key, label, options) => ({ key, label, options });

// ---------- The lesson ----------
const [scope, sketch, deep, stress] = STEPS.map((step) => `<b>${step.name}</b>`);
const growthPct = Math.round(100 * (GROWTH - 1));

// Scope example (ours): 3 million daily users, 5% upload one 200 MB video (the mission uses 4 million, 10%, 250 MB).
// 3,000,000 × 5% = 150,000 videos a day; × 200 MB = 30,000,000 MB = 30 TB.
const sc = { users: 3e6, sharePct: 5, mb: 200 };
sc.videos = sc.users * sc.sharePct / 100;
sc.tb = sc.videos * sc.mb / 1e6;
// CDN bill example (ours): 20 million views a day of 0.2 GB (the mission streams 24 million of 0.25 GB).
// 20,000,000 × 0.2 GB = 4,000,000 GB; × $0.02 = $80,000 a day from the CDN, × $0.002 = $8,000 from your own servers.
const cdn = { views: 20e6, gb: 0.2 };
cdn.day = Math.round(cdn.views * cdn.gb * CDN_GB);
cdn.own = Math.round(cdn.views * cdn.gb * OWN_GB);
// Check yourself (ours): 7.5 uploads a second need 8 transcoding servers, and a 9th so one can die.
const tcCheck = { rate: 7.5 };
tcCheck.need = Math.ceil(tcCheck.rate / TRANSCODE_RATE);

/** @type {Lesson} */
const lesson = {
  intro: {
    kicker: 'Level 20 · Part 3: Design real systems',
    title: 'Video platform',
    story: 'Creators upload videos from their phones, and viewers watch them on phones, laptops and TVs around the world. Each video is big, must be converted for every screen, and costs money every time it is streamed.',
    picture: 'figBuilt',
    alt: 'The finished design: phones upload videos in chunks straight to storage with a signed address from the API. Transcoding servers convert each video for every screen. Popular videos stream from a CDN, the rest from your own storage servers.',
    outcomes: [
      'estimate storage and streaming cost for video',
      'upload large files without loading the API servers',
      'explain what transcoding does and why',
      'run transcoding as tasks that survive a crash',
      'cut the streaming bill using popularity',
    ],
  },
  last: 'Level 19 answered tiny requests very fast. Video is the opposite: huge files, slow processing, and a bill that grows with every view.',
  parts: [
    {
      title: 'Get the uploads in',
      mission: 0,
      minutes: 9,
      lead: 'A video is hundreds of megabytes, often sent from a phone on a shaky connection.',
      newParts: [
        { type: 'vupload', before: 1, what: 'API servers plus storage for the original files.', does: 'Check who is uploading, hand out upload permissions and keep each video\'s details.', game: `$${COMPONENTS.vupload.cost} a month for ${API_SERVERS} servers and storage.` },
        { type: 'transcoder', what: 'Servers that convert each video for every kind of screen.', does: 'Split the work into tasks, such as each resolution, audio and thumbnail, and run them in parallel.', game: `$${COMPONENTS.transcoder.cost} a month each. ${TRANSCODE_RATE} video a second each.` },
        { type: 'vserve', what: 'How finished videos reach viewers.', does: 'Streams each view a little at a time, choosing the quality the viewer\'s connection can carry.', game: `A CDN charges $${CDN_GB} a GB; your own servers about $${OWN_GB}.` },
      ],
      sections: [
        {
          title: 'Scope it: how much video, and what does it cost to stream?',
          hook: `Ask: upload and watch only? Which devices? How many users, and how big are videos? Say: ${count(sc.users)} daily users, ${sc.sharePct}% upload one ${sc.mb} MB video a day, and viewers watch ${count(cdn.views)} videos a day of ${cdn.gb} GB each.`,
          body: [
            {
              calc: {
                formula: 'Storage a day = uploads × size. Streaming cost a day = views × size × price per GB.',
                rows: [
                  { label: 'Uploads a day', work: `${count(sc.users)} users × ${sc.sharePct}%`, result: `${fmt(sc.videos)} videos` },
                  { label: 'Storage a day', work: `${fmt(sc.videos)} videos × ${sc.mb} MB`, result: `${sc.tb} TB` },
                  { label: 'CDN a day', work: `${count(cdn.views)} views × ${cdn.gb} GB × $${CDN_GB}`, result: `$${fmt(cdn.day)}` },
                ],
                result: `${sc.tb} TB of new video a day, and $${fmt(cdn.day)} a day to stream it from a CDN. Streaming is the biggest cost.`,
              },
            },
            { p: 'Use services you can rent: blob storage for files, a CDN for streaming. Building either yourself is a project of its own.' },
          ],
          takeaway: 'Video costs storage on upload and money on every view.',
          quiz: [9],
        },
        {
          title: 'How do videos get in without clogging the servers?',
          hook: 'If every byte passes through your API servers, a few uploads fill their network.',
          body: [
            {
              figure: 'figUpload',
              alt: 'The phone asks the API servers for an upload address. The API answers with a short-lived signed address. The phone sends the video in numbered chunks straight to storage; one failed chunk is simply sent again. The API servers carry none of the video.',
              caption: 'Ask the API for permission, send the bytes straight to storage',
            },
            { ul: [
              '<b>Pre-signed URL:</b> the API checks the user and returns a short-lived address that allows one upload, to one place. The phone sends the video straight to storage with it.',
              '<b>Resumable chunks:</b> the phone splits the video into chunks. A dropped connection resends one chunk, not the whole video, and chunks can go in parallel.',
            ] },
            { p: 'Meanwhile the phone sends the title and size to the API, which stores them as the video\'s <b>metadata</b>.' },
          ],
          takeaway: 'Upload straight to storage with a signed URL, in chunks that can be resent.',
          quiz: [1, 2],
        },
      ],
      checks: [
        {
          q: 'A phone loses signal 80% of the way through a 500 MB upload sent in 5 MB chunks. What has to be sent again?',
          options: [
            { t: 'The whole 500 MB', why: 'That is an upload sent as one piece.' },
            { t: 'The chunk that was cut off, then the rest', right: true, why: 'Finished chunks are already stored. Only the broken 5 MB chunk restarts.' },
          ],
        },
      ],
      youWill: [
        'estimate the new video a day (Play stays locked until you do)',
        'send uploads straight to storage, in chunks',
        `survive patchy networks and publish ${targets.servedPct}% of uploads`,
        `stay within ${fmtMoney(BUDGET, MONEY)} a month`,
      ],
      debrief: {
        saw: 'The API servers only handed out permissions. Video went straight to storage, and dropped chunks were resent.',
        number: [`${RATE} a second`, 'uploads at the peak'],
        next: 'Each upload must now be converted for every screen, and conversion servers sometimes die mid-video.',
      },
    },
    {
      title: 'Transcode every video',
      mission: 1,
      minutes: 7,
      lead: 'The file a phone records is not the file a TV in another country can play smoothly.',
      sections: [
        {
          title: 'Why must every video be converted?',
          hook: '<b>Transcoding</b> turns the original into several versions: different resolutions, sizes and formats.',
          body: [
            { ul: [
              'Devices play different formats. A format is a <b>container</b>, the file that holds picture and sound (such as .mp4), plus a <b>codec</b>, the method that compresses them (such as H.264).',
              'A fast connection should get high quality and a slow one lower quality.',
              'Connections change while you watch, especially on phones.',
              'Raw video is enormous; compression makes it practical.',
            ] },
            { p: 'Players then use <b>adaptive bitrate streaming</b> (protocols named HLS and MPEG-DASH): the video is sent a few seconds at a time, and the player picks the quality for each piece from how fast the connection is right now.' },
          ],
          takeaway: 'Transcoding makes versions for every screen and speed, and the player switches between them.',
          quiz: [0, 6],
        },
        {
          title: 'How to transcode quickly, and survive a crash',
          hook: 'Converting one video is a lot of work, and much of it can happen at the same time.',
          body: [
            {
              figure: 'figDag',
              alt: 'The original video splits into video, audio and metadata. The video is inspected, then encoded at three resolutions in parallel, and a thumbnail and watermark are made. The audio is encoded. All parts join to make the video ready to stream.',
              caption: 'Tasks in stages, run in parallel where they can be',
            },
            { p: 'Describe the work as a graph of tasks: some must wait for others, the rest run side by side on different workers. The video is also cut into segments a few seconds long, so even one encoding is spread out.' },
            { p: 'Keep segments in temporary storage until the video is done. If a worker dies, its tasks are <b>retried</b> on another worker from those segments. A task that keeps failing, or a broken file, ends with an error to the creator.' },
          ],
          takeaway: 'Run transcoding as a graph of small tasks, and retry a dead worker\'s tasks.',
          quiz: [3, 5],
        },
      ],
      checks: [
        {
          q: `Uploads arrive at ${tcCheck.rate} videos a second. Each transcoding server handles ${TRANSCODE_RATE} a second. How many servers, so one can die?`,
          options: [
            { t: `${tcCheck.need}`, why: `${tcCheck.need} carry the load, but with one dead, ${tcCheck.need - 1} cannot carry ${tcCheck.rate}.` },
            { t: `${tcCheck.need + 1}`, right: true, why: `${tcCheck.rate} rounds up to ${tcCheck.need} servers, plus one spare.` },
            { t: `${tcCheck.rate * 2}`, why: 'One spare is enough to survive one failure.' },
          ],
        },
      ],
      youWill: [
        'size the transcoding servers with one spare',
        'turn on retries so a dead server\'s tasks run elsewhere',
        `let a transcoding server die and still publish ${targets.servedPct}%, for at most ${fmtMoney(BUDGET, MONEY)} a month`,
      ],
      debrief: {
        saw: 'The dead server\'s tasks were retried on the others, from saved segments, and the spare took up its share.',
        number: ['1 spare', 'transcoding server, so one can die'],
        next: 'Streaming every view from the CDN costs far more than everything else together.',
      },
    },
    {
      title: 'The CDN bill',
      mission: 2,
      minutes: 5,
      lead: 'A CDN streams from an edge next to each viewer. You pay for every gigabyte.',
      sections: [
        {
          title: 'How do you cut the streaming bill?',
          hook: 'Most views go to a few popular videos. Most videos are watched rarely: the <b>long tail</b>.',
          body: [
            {
              figure: 'figTail',
              alt: 'Views per video, sorted from most to least: a few videos have very many views, followed by a very long tail of videos with few views each. The popular few are served from the CDN, the tail from your own storage servers.',
              caption: 'A few popular videos and a very long tail',
            },
            { p: `A popular video streamed from an edge near the viewer is worth the price. A video watched twice a month is not. Serve the popular videos from the CDN and the tail from your own storage servers, at about $${OWN_GB} a GB instead of $${CDN_GB}.` },
            { p: 'More savings: encode rarely watched videos only when someone asks; keep videos popular in one region in that region. And protect creators\' videos with encryption, rights management or watermarks.' },
          ],
          takeaway: 'Serve the popular head from the CDN and the long tail from your own servers.',
          quiz: [8, 4, 7],
        },
      ],
      checks: [
        {
          q: `Streaming everything from the CDN costs $${fmt(cdn.day)} a day. What would the same views cost from your own servers at $${OWN_GB} a GB?`,
          options: [
            { t: `$${fmt(cdn.own)} a day`, right: true, why: 'A tenth of the price per GB, so a tenth of the bill. The catch: viewers far from your servers wait longer.' },
            { t: `$${fmt(cdn.day / 2)} a day`, why: `$${OWN_GB} is a tenth of $${CDN_GB}, not a half.` },
          ],
        },
      ],
      youWill: [
        'serve only popular videos from the CDN',
        `get the month under ${fmtMoney(TIGHT, MONEY)}`,
        `let views grow ${growthPct}% and keep the bill within budget`,
      ],
    },
  ],
  wrap: {
    picture: 'figBuiltEnd',
    alt: 'The finished design: phones upload in chunks straight to storage with a signed address. Transcoding servers convert each video for every screen. Popular videos stream from a CDN, the rest from your own servers.',
    say: [
      '"Clients upload straight to storage with a pre-signed URL, in resumable chunks."',
      '"Transcoding runs as a graph of tasks, and a dead worker\'s tasks are retried."',
      '"Views follow a long tail, so only popular videos go on the CDN."',
    ],
    numbers: [
      [`$${CDN_GB}`, 'a GB to stream from a CDN, in the game'],
      [`$${fmt(cdn.day)}`, 'a day to stream the example\'s views from a CDN'],
    ],
    loop: `The interview steps: ${scope} (storage and streaming cost), ${sketch} (upload, transcode, stream), ${deep} (signed URLs, the task graph, the long tail), ${stress} (patchy networks, a dead server, growing views).`,
    broken: 'Level 21 keeps files in sync across every device a user owns, and sends as little as possible each time a file changes.',
  },
};

/**
 * The finished design, drawn for the intro and again for the wrap-up. Creators get an upload URL from the API servers
 * and send chunks straight to blob storage; transcoding encodes the originals; encoded files go to the CDN (popular
 * videos) or your own storage servers (the long tail), and viewers stream from both.
 * @param {Record<string, Function>} f the drawing helpers `drawFigures` is given
 * @param {SVGSVGElement} svg
 */
function drawBuilt(f, svg) {
  const { figNode, figArrow, figSvg } = f;
  figSvg(svg, 460);
  figNode(svg, 'users', 110, 50, 'Creators', 'Upload from phones');
  figNode(svg, 'vupload', 530, 50, 'API servers', 'Hand out URLs');
  figArrow(svg, 204, 50, 436, 50, 'upload URL?', null, 320, 42, 'middle');
  figNode(svg, 'blobstore', 110, 170, 'Blob storage', 'Original videos');
  figArrow(svg, 110, 80, 110, 140, 'chunks', null, 122, 115);
  figNode(svg, 'transcoder', 530, 170, 'Transcoding', 'Graph of tasks');
  figArrow(svg, 204, 170, 436, 170, 'originals', null, 320, 162, 'middle');
  figNode(svg, 'db', 530, 290, 'Encoded files', 'Every resolution');
  figArrow(svg, 530, 200, 530, 260, '', null, 0, 0);
  figNode(svg, 'db', 110, 290, 'Own storage', 'The long tail');
  figArrow(svg, 436, 290, 204, 290, 'rarely watched', null, 320, 282, 'middle');
  figNode(svg, 'cdn', 530, 410, 'CDN', 'Popular videos');
  figArrow(svg, 530, 320, 530, 380, 'popular', null, 542, 355);
  figNode(svg, 'users', 110, 410, 'Viewers', 'Phone, laptop, TV');
  figArrow(svg, 110, 320, 110, 380, 'stream', null, 122, 355);
  figArrow(svg, 436, 410, 204, 410, 'stream', null, 320, 402, 'middle');
}

/**
 * The upload: 1 the phone asks the API servers for an upload URL, 2 they answer with a signed one, 3 the phone sends
 * the video in numbered chunks straight to blob storage. One chunk was cut off and is sent again.
 * @param {Record<string, Function>} f the drawing helpers `drawFigures` is given
 * @param {SVGSVGElement} svg
 */
function drawUpload(f, svg) {
  const { figNode, figArrow, figLabel, figSvg, svgEl } = f;
  figSvg(svg, 290);
  figNode(svg, 'users', 110, 52, 'Phone', 'Creator\'s video');
  figNode(svg, 'vupload', 530, 52, 'API servers', 'Check the user');
  figArrow(svg, 204, 42, 436, 42, 'upload URL?', '1', 272, 34);
  figArrow(svg, 436, 64, 204, 64, 'signed URL', '2', 272, 88);
  figLabel(svg, 530, 106, 'carry none of the video', 'middle', 'ch-t');
  figArrow(svg, 110, 82, 110, 176, 'chunks', '3', 136, 134);
  const cell = 44, x = 40, y = 210;
  queueCells(f, svg, x, y, ['1', '2'], cell);
  queueCells(f, svgEl('g', { class: 'fig-down' }, svg), x + 2 * cell, y, ['3'], cell);
  queueCells(f, svg, x + 3 * cell, y, ['4', '5'], cell);
  figLabel(svg, x + 2.5 * cell, y + 40, 'cut off: sent again', 'middle', 'ch-t');
  figNode(svg, 'blobstore', 530, y, 'Blob storage', 'Original videos');
  figArrow(svg, x + 5 * cell + 12, y, 436, y, 'straight to storage', null, 346, y - 10, 'middle');
}

/**
 * The transcoding graph: the original splits into video, audio and metadata; the video is inspected, then encoded at
 * three resolutions with a thumbnail and a watermark, side by side; the audio is encoded; everything joins in
 * "Ready to stream".
 * @param {Record<string, Function>} f the drawing helpers `drawFigures` is given
 * @param {SVGSVGElement} svg
 */
function drawDag(f, svg) {
  const { svgEl, figArrow, figLabel, figSvg } = f;
  figSvg(svg, 400);
  /** A task box; `lines` above one make it taller. Arrows join it on the left and leave it on the right. */
  const box = (x, y, w, ...lines) => {
    const h = 28 + 18 * (lines.length - 1);
    svgEl('rect', { x: x - w / 2, y: y - h / 2, width: w, height: h, rx: 8, class: 'node-box' }, svg);
    lines.forEach((text, i) => figLabel(svg, x, y + 4 - 9 * (lines.length - 1) + 18 * i, text));
    return { l: x - w / 2, r: x + w / 2, y };
  };
  const join = (from, to, dy = 0) => figArrow(svg, from.r, from.y, to.l, to.y + dy, '', null, 0, 0);
  const original = box(65, 260, 90, 'Original');
  const video = box(190, 150, 90, 'Video');
  const audio = box(190, 310, 90, 'Audio');
  const meta = box(190, 380, 90, 'Metadata');
  const inspect = box(320, 150, 100, 'Inspect');
  const encAudio = box(320, 310, 100, 'Encode audio');
  const ready = box(585, 260, 90, 'Ready', 'to stream');
  figLabel(svg, 450, 22, 'side by side', 'middle', 'tier-label');
  ['360p', '720p', '1080p', 'Thumbnail', 'Watermark'].forEach((text, i) => {
    const task = box(450, 50 + i * 50, 100, text);
    join(inspect, task);
    join(task, ready, -20 + 6 * i); // each arrowhead lands on its own spot along the box's edge
  });
  for (const part of [video, audio, meta]) join(original, part);
  join(video, inspect);
  join(audio, encAudio);
  join(encAudio, ready, 12);
  join(meta, ready, 20);
}

/**
 * Views per video, most watched first: a few tall bars (served from the CDN), then a long, low tail (served from your
 * own storage servers), split by a dashed line. The heights are a shape, not data.
 * @param {Record<string, Function>} f the drawing helpers `drawFigures` is given
 * @param {SVGSVGElement} svg
 */
function drawTail(f, svg) {
  const { svgEl, figLabel, figSvg } = f;
  figSvg(svg, 300);
  const base = 250, top = 60, bars = 40, head = 5, w = 12, gap = 2.5, left = 50;
  for (let i = 0; i < bars; i++) {
    const h = (base - top) / (i + 1) ** 1.2;
    svgEl('rect', { x: left + i * (w + gap), y: base - h, width: w, height: h, class: 'ch-area' }, svg);
  }
  const split = left + head * (w + gap) - gap / 2;
  svgEl('line', { x1: left - 6, y1: base, x2: 620, y2: base, class: 'ch-axis' }, svg);
  svgEl('line', { x1: split, y1: 30, x2: split, y2: base, class: 'ch-axis d-dash' }, svg);
  figLabel(svg, split - 8, 44, 'Popular: CDN', 'end', 'tier-label');
  figLabel(svg, split + 12, 44, 'The long tail: your own storage servers', 'start', 'tier-label');
  figLabel(svg, left - 6, base + 22, 'videos, most watched first', 'start', 'ch-t');
  figLabel(svg, 36, base - 4, 'views', 'end', 'ch-t');
}

/** @type {Level} */
export default {
  id: 20,
  saveKey: 'sdl-level20-v1',
  saveVersion: 2, // 2: which missions were opened from the lesson (`opened`)
  targets,
  workload: { video: true, growth: GROWTH },

  // The mock interview's brief and self-check list for this problem (see mock.js).
  mock: {
    title: 'Video platform',
    brief: 'Design a video platform: creators upload videos, mostly from phones, and viewers stream them on any device. 4 million daily users watch 6 videos each; 10% upload one 250 MB video a day.',
    checklist: [
      'Estimated storage (100 TB a day) and the CDN bill (about $120,000 a day)',
      'Drew the upload flow: storage, transcoding, encoded storage, CDN, and the metadata',
      'Used pre-signed URLs and resumable chunked uploads',
      'Transcoded with a graph of tasks, retrying failed ones',
      'Streamed from the CDN with adaptive bitrate',
      'Cut the CDN bill: only popular videos on the CDN',
    ],
  },

  components: {
    users: {
      name: 'Creators and viewers', sub: 'Upload and watch',
      desc: `4 million people a day watch 6 videos each, and 1 in 10 uploads a ${VIDEO_MB} MB video, mostly from phones: about ${RATE} uploads a second at the peak.`,
    },
    vupload: {
      name: 'Upload service', short: 'API servers + storage',
      desc: `${API_SERVERS} API servers (1 Gbps each) that take uploads and metadata, and blob storage for the original files. $800 a month.`,
      subOf: (n) => [n.url === 'presigned' ? 'pre-signed URL' : 'via API servers', n.chunks === 'chunked' ? 'chunks' : 'whole file'].join(' · '),
      choices: [
        ON('url', 'Where the bytes go', [
          { id: 'api', name: 'Through the API servers', sub: 'they relay every byte', note: `Each video crosses the API servers' links: ${API_SERVERS} × 1 Gbps carries about ${fmt(API_SERVERS * API_MBPS / VIDEO_MB)} videos a second.`, log: 'Uploads now go through the API servers.' },
          { id: 'presigned', name: 'Pre-signed URL', sub: 'straight to storage', note: 'The API server checks the user and returns a pre-signed URL: permission to upload one object to one storage location, for a short time. The phone sends the bytes straight to storage.', log: 'Uploads now use pre-signed URLs.' },
        ]),
        ON('chunks', 'Upload as', [
          { id: 'whole', name: 'One whole file', sub: 'restart if it fails', note: `A dropped connection loses the whole upload. ${Math.round(100 * FAIL)}% fail and are given up on (${Math.round(100 * PATCHY_FAIL)}% on patchy networks).`, log: 'Videos are now uploaded as one file.' },
          { id: 'chunked', name: 'Resumable chunks', sub: 'split on the phone', note: 'The phone splits the video into chunks (by group of pictures) and uploads them in parallel; after a drop it resends only the missing chunks.', log: 'Videos are now uploaded in resumable chunks.' },
        ]),
      ],
    },
    transcoder: {
      name: 'Transcoding', short: 'Encode for every screen',
      desc: `Servers that split each video into a processing graph of tasks (inspect, encode each resolution, audio, thumbnail, watermark) and run them in parallel. ${TRANSCODE_RATE} video a second per server, $500 a month each.`,
      subOf: (n) => `${Number(n.workers) || 8} servers${n.retry === 'on' ? ' · retry' : ''}`,
      choices: [
        ON('workers', 'Servers', [6, 8, 10, 11, 12].map((k) => ({ id: String(k), name: `${k} servers`, sub: `$${fmt(k * 500)} a month`, note: `${k} transcoding servers: ${fmt(k * TRANSCODE_RATE)} videos a second.`, log: `Transcoding set to ${k} servers.` }))),
        ON('retry', 'When a server dies', [
          { id: 'off', name: 'Give up', sub: 'its videos fail', note: 'Videos the dead server was encoding fail, and their creators must upload again.', log: 'Transcoding no longer retries.' },
          { id: 'on', name: 'Retry the tasks', sub: 'from temporary storage', note: 'The video\'s segments and metadata are kept in temporary storage, so the scheduler reruns the dead server\'s tasks on another.', log: 'Transcoding now retries failed tasks.' },
        ]),
      ],
    },
    vserve: {
      name: 'Video delivery', short: 'Streams to viewers',
      desc: `Streams each view (about ${VIEW_GB * 1000} MB) by adaptive bitrate (HLS or MPEG-DASH): ${fmt(VIEWS_DAY / 1e6)} million views a day. The CDN charges $${CDN_GB} a GB; your own storage servers about $${OWN_GB}. Its cost is the month's streaming bill.`,
      subOf: (n) => (n.deliver === 'popular' ? 'CDN for popular videos' : 'all from the CDN'),
      choices: [
        ON('deliver', 'Stream from', [
          { id: 'cdn', name: 'The CDN, every video', sub: `$${CDN_GB} a GB`, note: 'Every view streams from the CDN\'s edge servers, close to viewers. Fast, and expensive.', log: 'Every video now streams from the CDN.' },
          { id: 'popular', name: 'CDN for popular videos only', sub: 'the long tail from your servers', note: `Views follow a long tail: popular videos get ${Math.round(100 * POPULAR)}% of them. Put those on the CDN; stream the rest from your own high-capacity storage servers.`, log: 'Only popular videos now stream from the CDN.' },
        ]),
      ],
    },
  },
  palette: ['vupload', 'transcoder', 'vserve'],
  limits: { vupload: 1, transcoder: 1, vserve: 1 },
  limitMsg: {
    vupload: 'One upload service is enough.',
    transcoder: 'One transcoding box is enough: set its servers in the inspector.',
    vserve: 'One delivery box is enough.',
  },
  // Users → upload service (through API servers, whole files) → 10 transcoding servers → delivery (all CDN).
  startNodes: [
    { id: 'u', type: 'users', x: 380, y: 60 },
    { id: 'p', type: 'vupload', x: 380, y: 190, url: 'api', chunks: 'whole' },
    { id: 't', type: 'transcoder', x: 380, y: 320, workers: '10', retry: 'off' },
    { id: 'v', type: 'vserve', x: 380, y: 450, deliver: 'cdn' },
  ],
  startEdges: [{ id: 's1', from: 'u', to: 'p' }, { id: 's2', from: 'p', to: 't' }, { id: 's3', from: 't', to: 'v' }],
  slots: { vupload: { x: 380, y: 190 }, transcoder: { x: 380, y: 320 }, vserve: { x: 380, y: 450 } },

  connections: {
    ok: {
      'users|vupload': { from: 'users', to: 'vupload', label: 'uploads', desc: 'Creators upload videos and their metadata.' },
      'transcoder|vupload': { from: 'vupload', to: 'transcoder', label: 'originals', desc: 'Each original goes to transcoding.' },
      'transcoder|vserve': { from: 'transcoder', to: 'vserve', label: 'encoded', desc: 'Encoded files go to storage and the CDN; a completion event updates the metadata.' },
    },
    bad: {
      'transcoder|users': 'Creators upload to the upload service first.',
      'users|vserve': 'Viewers stream from delivery, but uploads come in through the upload service.',
      'vserve|vupload': 'Originals must be transcoded before they can be streamed.',
    },
  },

  missions: [
    {
      title: 'Get the uploads in', ref: 'Upload flow', qps: RATE, budget: BUDGET,
      gate: {
        hidesTraffic: false,
        lo: 100, hi: 100,
        prompt: `<b>Estimate before you build.</b> 4 million people a day; 10% upload one ${VIDEO_MB} MB video. How many TB of new video a day?`,
        label: 'TB a day',
        placeholder: 'e.g. 10',
        acceptedHtml: `<p><b>Estimate accepted.</b></p><div class="calc">4,000,000 × 10% = 400,000 videos a day<br>400,000 × ${VIDEO_MB} MB = 100,000,000 MB = 100 TB a day<br>÷ 86,400 ≈ 4.6 uploads a second, ${RATE} at a 2× peak</div>`,
        acceptedLog: 'Estimate accepted: 100 TB a day. Play is unlocked.',
        notNumber: 'Type the TB as a number, for example 10.',
        hints: [
          { test: (v) => v === 1000, text: 'That counts every user. Only 10% upload.' },
          { test: (v) => v === 10 || v === 100000, text: 'Check the units: 1 TB = 1,000,000 MB.' },
        ],
        fallback: 'Not quite. Users × 10% × MB, then 10⁶ MB per TB.',
      },
      story: `Creators upload ${RATE} videos a second at the peak, mostly from phones, and every byte passes through ${API_SERVERS} API servers. Publish 99% of uploads, even when phones are on patchy networks.`,
      goals: [
        { id: 'est', type: 'gate', text: 'Estimate the new video a day' },
        publishedGoal, costGoal(BUDGET, MONEY),
        { id: 'patchy', type: 'exp', text: 'Break it: patchy networks; still 99% published' },
      ],
      hint: 'Send the bytes straight to storage with a pre-signed URL, and upload in resumable chunks so a drop only resends one chunk.',
      takeaway: 'Pre-signed URLs took the video bytes off the API servers, which only check the user and hand out the URL. Resumable chunks turned a dropped connection into one chunk sent again, not a whole video lost.',
    },
    {
      title: 'Transcode every video', ref: 'Video transcoding', qps: RATE, budget: BUDGET,
      story: 'Every upload must be encoded into several resolutions and formats before anyone can watch it. Transcoding servers sometimes die mid-video. Publish 99% of uploads, even when one dies.',
      goals: [
        publishedGoal, costGoal(BUDGET, MONEY),
        { id: 'dies', type: 'exp', text: 'Break it: a transcoding server dies; still 99% published' },
      ],
      hint: `Retry the dead server's tasks from temporary storage, and keep one server spare: ${RATE} videos a second needs 10, so run 11.`,
      takeaway: 'The scheduler reran the dead server\'s tasks on the others, from segments kept in temporary storage, and the spare server took up its share. A recoverable error is retried; a malformed video gets an error code.',
    },
    {
      title: 'The CDN bill', ref: 'Cost-saving optimization', qps: RATE, budget: TIGHT,
      story: `Streaming ${fmt(VIEWS_DAY / 1e6)} million views a day from the CDN costs about $120,000 a day: the biggest bill by far. Most views go to a few popular videos. Get the month under ${fmtMoney(TIGHT, MONEY)}, with room for views to grow ${Math.round(100 * (GROWTH - 1))}%.`,
      goals: [
        publishedGoal, costGoal(TIGHT, MONEY),
        { id: 'growth', type: 'exp', text: `Break it: views grow ${Math.round(100 * (GROWTH - 1))}%; the bill stays within budget` },
      ],
      hint: `Put only the popular videos on the CDN, and stream the long tail from your own storage servers at about $${OWN_GB} a GB.`,
      takeaway: 'Popular videos stayed on the CDN, close to viewers; the long tail, watched rarely, streamed from your own servers. Other savings: encode rarely watched videos on demand, keep regional videos in their region, and partner with internet providers.',
    },
  ],

  // Break-it experiments. An event only checks its outcome; patchy, workerDies and growth change it while it runs.
  experiments: [
    {
      id: 'patchy', kind: 'event', patchy: true,
      label: 'Patchy networks', labelOn: 'Networks recover',
      needsDesign: 'Build the design first: upload service, transcoding and delivery.',
      on: `Phones on patchy networks: ${Math.round(100 * PATCHY_FAIL)}% of whole-file uploads drop.`, onTone: 'bad',
      off: 'Networks are steady again.',
      expect: served99,
      notMet: (m) => (m.video && !m.video.presigned
        ? `Only ${fmtPct(m.servedPct)} published: every byte crosses the API servers' links, which carry about ${fmt(API_SERVERS * API_MBPS / VIDEO_MB)} videos a second. Upload straight to storage with a pre-signed URL.`
        : `Only ${fmtPct(m.servedPct)} published: a dropped whole-file upload starts over and is given up on. Upload in resumable chunks.`),
      observed: (m) => `Observed: networks got patchy, and ${fmtPct(m.servedPct)} of uploads were still published.`,
    },
    {
      id: 'dies', kind: 'event', workerDies: true,
      label: 'A transcoding server dies', labelOn: 'Replace it',
      needsDesign: 'Build the design first: upload service, transcoding and delivery.',
      on: 'A transcoding server dies in the middle of its videos.', onTone: 'bad',
      off: 'A new server replaces it.',
      expect: served99,
      notMet: (m) => (m.video && m.video.lost > 0
        ? `${Math.round(100 * IN_FLIGHT)}% of videos in transcoding were on the dead server and are lost. Retry its tasks from temporary storage.`
        : `Only ${fmtPct(m.servedPct)} published: the servers left can't keep up. Keep a spare.`),
      observed: (m) => `Observed: a transcoding server died, and ${fmtPct(m.servedPct)} of videos were still published.`,
    },
    {
      id: 'growth', kind: 'event', growth: true,
      label: 'Views grow', labelOn: 'Back to today',
      needsDesign: 'Build the design first: upload service, transcoding and delivery.',
      on: `Next month: ${Math.round(100 * (GROWTH - 1))}% more views.`, onTone: 'bad',
      off: 'Back to today\'s views.',
      expect: (m) => !!m.video && m.cost - Math.round(m.video.bill / GROWTH) + Math.round(m.video.bill) <= TIGHT,
      notMet: (m) => `Next month's streaming bill would be ${fmtMoney(m.video.bill, MONEY)}. Serve only the popular videos from the CDN.`,
      observed: (m) => `Observed: views grew, and the month's streaming bill would be ${fmtMoney(m.video.bill, MONEY)}, within budget.`,
    },
  ],

  // Messages the engine shows for this level's design.
  text: {
    ...lbText(),
    noWeb: 'Connect the creators to the upload service.',
    levelComplete: levelComplete(20),
  },

  quiz: {
    passScore: 8,
    passText: passText(20, 'Cloud file sync'),
    failText,
    questions: [
      { q: 'What does transcoding do?', o: ['Compresses the database', 'Copies every uploaded video to a second backup region overnight', 'Checks the uploader\'s password', 'Encodes a video into formats and bitrates for each device'], a: 3, e: 'Raw video is huge and many devices play only certain formats. Transcoding makes several resolutions, codecs and bitrates, so each viewer gets one that fits their screen and network.', r: 'Why must every video be converted?' },
      { q: 'What is a pre-signed upload URL?', o: ['Short-lived permission to upload one object straight to storage', 'A URL that never expires', 'A link to the video\'s thumbnail, signed by the creator and the platform', 'An encrypted video'], a: 0, e: 'The API server checks the user and returns a URL that allows one upload to one storage location for a short time. The bytes then skip the API servers.', r: 'How do videos get in without clogging the servers?' },
      { q: 'Why upload a video in chunks?', o: ['A drop resends one chunk, and chunks go in parallel', 'Each chunk is encrypted for free by the storage service', 'The CDN needs chunks', 'It makes videos smaller'], a: 0, e: 'Split by group of pictures, chunks upload in parallel, and after a dropped connection only the missing ones are sent again.', r: 'How do videos get in without clogging the servers?' },
      { q: 'Why model transcoding as a graph of tasks?', o: ['To store videos as graphs', 'To find similar videos', 'So tasks run in stages, in parallel where they can', 'To share each video with every user who follows the creator'], a: 2, e: 'Split into video, audio and metadata, then encodings, thumbnails and watermarks: each task runs as soon as its inputs are ready, many in parallel, and creators can choose their own steps.', r: 'How to transcode quickly, and survive a crash' },
      { q: 'Views follow a long tail. How does that cut the CDN bill?', o: ['Stop serving any video older than one year', 'Serve only popular videos from the CDN', 'Lower every video\'s quality', 'Charge viewers per GB'], a: 1, e: 'A few videos get most views: keep those on the CDN, close to viewers, and stream the rarely watched rest from your own storage servers.', r: 'How do you cut the streaming bill?' },
      { q: 'A segment fails to transcode. What should happen?', o: ['Delete the video', 'Retry it a few times, then return an error', 'Publish it anyway, without that segment, and move on', 'Ask the creator to re-record'], a: 1, e: 'It is a recoverable error: retry, then give a proper error code if it keeps failing. A malformed file is non-recoverable: stop and return an error.', r: 'How to transcode quickly, and survive a crash' },
      { q: 'What are HLS and MPEG-DASH?', o: ['Video codecs only', 'CDN companies', 'Streaming protocols for adaptive bitrate', 'Upload formats used by phones and cameras when recording'], a: 2, e: 'They stream video over HTTP in small pieces at the bitrate the viewer\'s network can take, switching as it changes.', r: 'Why must every video be converted?' },
      { q: 'Which keeps creators\' videos from being copied?', o: ['DRM, encryption or watermarks', 'A bigger CDN', 'Shorter videos', 'Pre-signed URLs that expire after an hour'], a: 0, e: 'Digital rights management, AES encryption with an authorization policy, or a visible watermark protect the content.', r: 'How do you cut the streaming bill?' },
      { q: 'Where does a viewer\'s video stream come from?', o: ['The API servers', 'The transcoding servers that encoded the video', 'The metadata database', 'An edge server near the viewer'], a: 3, e: 'Encoded files are pushed to the CDN; the closest edge server streams them, so playback starts fast.', r: 'How do you cut the streaming bill?' },
      { q: '24 million views a day, 0.25 GB each, at $0.02 a GB. About how much a day on the CDN?', o: ['$12,000', '$1.2 million', '$120,000', '$480,000'], a: 2, e: '24 × 10⁶ × 0.25 GB = 6 × 10⁶ GB a day; × $0.02 = $120,000 a day, about $3.6 million a month.', r: 'Scope it: how much video, and what does it cost to stream?' },
    ],
  },

  lesson,

  // Lesson diagrams. `f` provides the engine's drawing helpers. Each figure sets its own viewBox.
  drawFigures(f) {
    const { $ } = f;
    drawUpload(f, $('figUpload'));
    drawDag(f, $('figDag'));
    drawTail(f, $('figTail'));
    drawBuilt(f, $('figBuilt'));
    drawBuilt(f, $('figBuiltEnd'));
  },
};
