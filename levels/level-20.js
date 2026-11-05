// Level 20: Video platform.
// Everything specific to this level lives here: components, rules, missions, quiz and text.
import { fmt } from '../js/format.js';
import { servedGoal, costGoal, servedAtLeast, fmtPct, fmtMoney } from './shared/goals.js';
import { VIDEO_MB, VIEWS_DAY, VIEW_GB, API_SERVERS, API_MBPS, FAIL, PATCHY_FAIL, TRANSCODE_RATE, IN_FLIGHT, POPULAR, CDN_GB, OWN_GB } from '../js/engine/video.js';
import { lbText, levelComplete } from './shared/text.js';
import { failText, passText } from './shared/quiz.js';

const targets = { latencyMs: 1000, servedPct: 99 };
const MONEY = { millions: true }; // bills reach millions of dollars: "$1.25M"
const RATE = 9.3; // videos uploaded a second at the peak
const GROWTH = 1.2;
const BUDGET = 3700000;
const TIGHT = 3600000;

const served99 = servedAtLeast(targets.servedPct);
const publishedGoal = servedGoal(targets, { text: `Publish ${targets.servedPct}% of uploaded videos` });
const ON = (key, label, options) => ({ key, label, options });

export default {
  id: 20,
  saveKey: 'sdl-level20-v1',
  saveVersion: 1,
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
      { q: 'What does transcoding do?', o: ['Compresses the database', 'Copies every uploaded video to a second backup region overnight', 'Checks the uploader\'s password', 'Encodes a video into formats and bitrates for each device'], a: 3, e: 'Raw video is huge and many devices play only certain formats. Transcoding makes several resolutions, codecs and bitrates, so each viewer gets one that fits their screen and network.', r: 'Video transcoding' },
      { q: 'What is a pre-signed upload URL?', o: ['Short-lived permission to upload one object straight to storage', 'A URL that never expires', 'A link to the video\'s thumbnail, signed by the creator and the platform', 'An encrypted video'], a: 0, e: 'The API server checks the user and returns a URL that allows one upload to one storage location for a short time. The bytes then skip the API servers.', r: 'Safety optimization' },
      { q: 'Why upload a video in chunks?', o: ['A drop resends one chunk, and chunks go in parallel', 'Each chunk is encrypted for free by the storage service', 'The CDN needs chunks', 'It makes videos smaller'], a: 0, e: 'Split by group of pictures, chunks upload in parallel, and after a dropped connection only the missing ones are sent again.', r: 'Speed optimization' },
      { q: 'Why model transcoding as a graph of tasks?', o: ['To store videos as graphs', 'To find similar videos', 'So tasks run in stages, in parallel where they can', 'To share each video with every user who follows the creator'], a: 2, e: 'Split into video, audio and metadata, then encodings, thumbnails and watermarks: each task runs as soon as its inputs are ready, many in parallel, and creators can choose their own steps.', r: 'DAG model' },
      { q: 'Views follow a long tail. How does that cut the CDN bill?', o: ['Stop serving any video older than one year', 'Serve only popular videos from the CDN', 'Lower every video\'s quality', 'Charge viewers per GB'], a: 1, e: 'A few videos get most views: keep those on the CDN, close to viewers, and stream the rarely watched rest from your own storage servers.', r: 'Cost-saving optimization' },
      { q: 'A segment fails to transcode. What should happen?', o: ['Delete the video', 'Retry it a few times, then return an error', 'Publish it anyway, without that segment, and move on', 'Ask the creator to re-record'], a: 1, e: 'It is a recoverable error: retry, then give a proper error code if it keeps failing. A malformed file is non-recoverable: stop and return an error.', r: 'Error handling' },
      { q: 'What are HLS and MPEG-DASH?', o: ['Video codecs only', 'CDN companies', 'Streaming protocols for adaptive bitrate', 'Upload formats used by phones and cameras when recording'], a: 2, e: 'They stream video over HTTP in small pieces at the bitrate the viewer\'s network can take, switching as it changes.', r: 'Streaming protocols' },
      { q: 'Which keeps creators\' videos from being copied?', o: ['DRM, encryption or watermarks', 'A bigger CDN', 'Shorter videos', 'Pre-signed URLs that expire after an hour'], a: 0, e: 'Digital rights management, AES encryption with an authorization policy, or a visible watermark protect the content.', r: 'Protect your videos' },
      { q: 'Where does a viewer\'s video stream come from?', o: ['The API servers', 'The transcoding servers that encoded the video', 'The metadata database', 'An edge server near the viewer'], a: 3, e: 'Encoded files are pushed to the CDN; the closest edge server streams them, so playback starts fast.', r: 'Video streaming flow' },
      { q: '24 million views a day, 0.25 GB each, at $0.02 a GB. About how much a day on the CDN?', o: ['$12,000', '$1.2 million', '$120,000', '$480,000'], a: 2, e: '24 × 10⁶ × 0.25 GB = 6 × 10⁶ GB a day; × $0.02 = $120,000 a day, about $3.6 million a month.', r: 'Back of the envelope' },
    ],
  },

  // Lesson tab content (HTML). The diagram below draws into figUpload.
  lessonHtml: `
    <p class="label">Level 20 · Video platform</p>
    <h1>Video platform</h1>
    <p class="lede">Creators upload videos from their phones; millions of viewers stream them on every kind of screen. Uploading, encoding and streaming are each heavy in their own way, and streaming is the biggest bill. In this level you make uploads reliable, keep encoding going when servers die, and bring the bill down.</p>
    <div class="goals-box">
      <div><b>You will learn</b>The upload and streaming flows, transcoding as a task graph, chunked and pre-signed uploads, CDN costs.</div>
      <div><b>You will decide</b>Pre-signed URLs, chunked uploads, transcoding servers and retries, what the CDN serves.</div>
      <div><b>You will estimate</b>New video a day.</div>
    </div>

    <section>
      <h2>Scope it</h2>
      <p class="src">Requirements</p>
      <p>Ask: upload and watch (both), which devices (phones, browsers, TVs), how many users (4 million a day), resolutions, encryption, file size limit, and whether to use cloud services (yes: blob storage and a CDN, rather than building them).</p>
      <ul>
        <li>4 million × 10% × ${VIDEO_MB} MB = 100 TB of new video a day.</li>
        <li>4 million × 6 views × ${VIEW_GB} GB × $${CDN_GB} = $120,000 a day on the CDN.</li>
      </ul>
    </section>

    <section>
      <h2>Uploading</h2>
      <p class="src">Upload flow</p>
      <figure class="fig"><svg id="figUpload" viewBox="0 0 660 200" role="img" aria-label="A phone uploads to original storage with a pre-signed URL; transcoding servers encode the video; encoded files go to storage and the CDN; viewers stream from the CDN."></svg><figcaption>Upload, transcode, stream: each step can scale on its own</figcaption></figure>
      <p>Two flows run in parallel: the video goes to <b>original storage</b>, and its metadata (title, size, format) to API servers and the metadata database and cache. <b>Transcoding servers</b> encode the original; encoded files go to <b>transcoded storage</b> and the <b>CDN</b>; a completion queue tells a handler to update the metadata. Queues between steps let each run in parallel.</p>
      <ul>
        <li><b>Pre-signed URL:</b> the API server checks the user and returns a short-lived permission to upload one object to one place. The phone sends the bytes straight to storage.</li>
        <li><b>Chunks:</b> split the video on the phone by group of pictures; upload chunks in parallel; after a drop, resend only what's missing. Upload centers near users help too.</li>
      </ul>
    </section>

    <section>
      <h2>Transcoding</h2>
      <p class="src">Video transcoding · DAG model</p>
      <p>Raw video is huge (an hour of HD at 60 frames a second can be hundreds of GB) and devices play only some formats. Transcoding makes several <b>codecs</b> and <b>bitrates</b>, so each viewer gets one that suits their screen and network. Model it as a <b>graph of tasks</b>: split into video, audio and metadata; then inspect, encode each resolution, make thumbnails, add watermarks. A scheduler runs tasks in stages, many at once; a resource manager hands them to workers. Segments are kept in temporary storage, so a failed task is retried, not the whole video.</p>
    </section>

    <section>
      <h2>Streaming and cost</h2>
      <p class="src">Streaming protocols · Cost-saving optimization</p>
      <p>Viewers stream from the CDN's nearest edge, with adaptive-bitrate protocols such as <b>HLS</b> or <b>MPEG-DASH</b>. The CDN charges per GB, and views follow a <b>long tail</b>: a few videos get most views. So serve only popular videos from the CDN and the rest from your own storage servers; encode rarely watched videos on demand; keep regional videos in their region; very large platforms build their own CDN with internet providers. Protect content with DRM, encryption or watermarks.</p>
    </section>

    <section>
      <h2>How this level is simulated</h2>
      <p class="src">Game assumptions</p>
      <p>${RATE} uploads a second at the peak, ${VIDEO_MB} MB each. ${API_SERVERS} API servers with 1 Gbps each would carry ${fmt(API_SERVERS * API_MBPS / VIDEO_MB)} videos a second. ${Math.round(100 * FAIL)}% of whole-file uploads fail (${Math.round(100 * PATCHY_FAIL)}% on patchy networks); chunked uploads always finish. A transcoding server finishes ${TRANSCODE_RATE} video a second; a dying one held ${Math.round(100 * IN_FLIGHT)}% of the videos in progress. Popular videos get ${Math.round(100 * POPULAR)}% of views.</p>
      <p class="assume">Game assumptions: CDN $${CDN_GB} a GB, your own storage servers $${OWN_GB} a GB, ${VIEW_GB * 1000} MB per view; upload service $800 a month, transcoding $500 a server.</p>
    </section>

    <section>
      <h2>Numbers to carry into the interview</h2>
      <p class="src">Capacity estimates</p>
      <p><b>Storage a day</b> = uploaders × size. 400,000 × ${VIDEO_MB} MB = 100 TB.</p>
      <p><b>CDN a day</b> = views × GB × price. 24 million × ${VIEW_GB} × $${CDN_GB} = $120,000.</p>
    </section>

    <section>
      <h2>How each mission maps to the interview</h2>
      <p class="src">Interview loop · times for a 45-minute interview (formats vary by company)</p>
      <div class="steps4">
        <div><span>Step 1 · 5–8 min</span><b>Scope it</b>Upload and watch, devices, users, sizes, cloud services.</div>
        <div><span>Step 2 · 10–12 min</span><b>Sketch it</b>Upload flow, metadata flow, streaming from the CDN.</div>
        <div><span>Step 3 · 15–20 min</span><b>Go deep</b>Transcoding graph, chunked and pre-signed uploads, protection, cost.</div>
        <div><span>Step 4 · 5 min</span><b>Stress it</b>Patchy networks, a dead worker, the CDN bill.</div>
      </div>
    </section>
`,

  // Lesson diagram. `f` provides the engine's drawing helpers.
  drawFigures(f) {
    const { $, figNode, figArrow, figDefs, svgEl } = f;
    const label = (svg, x, y, t, anchor = 'middle') => { const e = svgEl('text', { x, y, class: 'd-label', 'text-anchor': anchor }, svg); e.textContent = t; };
    const f1 = $('figUpload'); f1.textContent = ''; figDefs(f1);
    figNode(f1, 'users', 100, 50, 'Phone', 'Uploads chunks');
    figNode(f1, 'db', 330, 50, 'Original storage', 'Pre-signed URL');
    figNode(f1, 'worker', 560, 50, 'Transcoding', 'Task graph');
    figNode(f1, 'cdn', 560, 160, 'CDN', 'Encoded files');
    figNode(f1, 'users', 330, 160, 'Viewers', 'Stream nearby');
    figArrow(f1, 196, 50, 234, 50, '', null, 0, 0);
    figArrow(f1, 426, 50, 464, 50, '', null, 0, 0);
    figArrow(f1, 560, 76, 560, 134, '', null, 0, 0);
    figArrow(f1, 464, 160, 426, 160, '', null, 0, 0);
    label(f1, 445, 152, 'HLS');
  },
};
