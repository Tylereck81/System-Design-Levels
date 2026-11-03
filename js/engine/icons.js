// Component icons.
import { svgEl } from '../dom.js';

export function drawIcon(type, parent, x, y, scale) {
  const g = svgEl('g', { transform: `translate(${x} ${y})` + (scale ? ` scale(${scale})` : '') }, parent);
  type = { notifier: 'web', nqueue: 'queue', nworker: 'worker' }[type] || type; // drawn like the parts they are
  if (type === 'users') {
    svgEl('rect', { x: 0, y: 4, width: 17, height: 12, rx: 2, class: 'ic-stroke' }, g);
    svgEl('path', { d: 'M-2 19h21', class: 'ic-stroke' }, g);
    svgEl('rect', { x: 21, y: 2, width: 9, height: 17, rx: 2, class: 'ic-stroke' }, g);
  } else if (type === 'dns') {
    svgEl('circle', { cx: 13, cy: 12, r: 10.5, class: 'ic-stroke' }, g);
    svgEl('ellipse', { cx: 13, cy: 12, rx: 4.6, ry: 10.5, class: 'ic-stroke' }, g);
    svgEl('path', { d: 'M2.5 12h21M4.5 6.5h17M4.5 17.5h17', class: 'ic-stroke' }, g);
  } else if (type === 'lb') {
    // One point in, fanning out to three: traffic spread over a pool.
    svgEl('circle', { cx: 4, cy: 12, r: 3.2, class: 'ic-stroke' }, g);
    svgEl('path', { d: 'M7.2 12H12M12 12L21 3.5M12 12h9M12 12l9 8.5', class: 'ic-stroke' }, g);
    for (const y of [3.5, 12, 20.5]) svgEl('circle', { cx: 23.5, cy: y, r: 2.4, class: 'ic-stroke' }, g);
  } else if (type === 'web') {
    svgEl('rect', { x: 6, y: 0, width: 15, height: 24, rx: 2, class: 'ic-web' }, g);
    svgEl('path', { d: 'M9.5 5.5h8M9.5 16.5h8M9.5 20h8', class: 'ic-line' }, g);
  } else if (type === 'cache') {
    // A memory chip: data kept in RAM.
    svgEl('rect', { x: 4, y: 4, width: 18, height: 16, rx: 2, class: 'ic-stroke' }, g);
    svgEl('path', { d: 'M8.5 0.5v3.5M13 0.5v3.5M17.5 0.5v3.5M8.5 20v3.5M13 20v3.5M17.5 20v3.5', class: 'ic-stroke' }, g);
    svgEl('rect', { x: 9, y: 9, width: 8, height: 6, rx: 1, class: 'ic-stroke' }, g);
  } else if (type === 'kv') {
    // Three key-value pairs, each kept on several nodes.
    for (const y of [2, 10, 18]) {
      svgEl('rect', { x: 0, y, width: 8, height: 5, rx: 1, class: 'ic-data' }, g);
      svgEl('rect', { x: 10, y, width: 7, height: 5, rx: 1, class: 'ic-stroke' }, g);
      svgEl('rect', { x: 19, y, width: 7, height: 5, rx: 1, class: 'ic-stroke' }, g);
    }
  } else if (type === 'ring') {
    // A ring with servers on it: keys hashed around a circle.
    svgEl('circle', { cx: 13, cy: 12, r: 9, class: 'ic-stroke' }, g);
    for (const [x, y] of [[13, 3], [21, 15.5], [5, 15.5]]) svgEl('rect', { x: x - 3, y: y - 3, width: 6, height: 6, rx: 1, class: 'ic-data' }, g);
  } else if (type === 'cdn') {
    // A cloud with three edge servers inside: copies kept near users.
    svgEl('path', { d: 'M6.5 21h14a5 5 0 0 0 .4-10A7.5 7.5 0 0 0 6.6 9.6 5.7 5.7 0 0 0 6.5 21z', class: 'ic-stroke' }, g);
    for (const x of [9, 13.5, 18]) svgEl('circle', { cx: x, cy: 15.5, r: 1.6, class: 'ic-stroke' }, g);
  } else if (type === 'session') {
    // A data store with a key on it: values looked up by session ID.
    svgEl('path', { d: 'M3.5 5v14a9.5 4 0 0 0 19 0V5z', class: 'ic-data' }, g);
    svgEl('ellipse', { cx: 13, cy: 5, rx: 9.5, ry: 4, class: 'ic-data-top' }, g);
    svgEl('circle', { cx: 9, cy: 15, r: 2.6, class: 'ic-line', fill: 'none' }, g);
    svgEl('path', { d: 'M11.6 15h7M16.5 15v2.6', class: 'ic-line' }, g);
  } else if (type === 'limiter') {
    // A funnel: only so much gets through.
    svgEl('path', { d: 'M1 3h25l-9.5 10v7.5l-6 3V13z', class: 'ic-stroke' }, g);
  } else if (type === 'counter') {
    // A counter in memory: +1.
    svgEl('rect', { x: 0, y: 4, width: 27, height: 16, rx: 3, class: 'ic-data' }, g);
    svgEl('path', { d: 'M6 12h6M9 9v6M17 9.5l2.5-1.5v8', class: 'ic-line', fill: 'none' }, g);
  } else if (type === 'shards') {
    // Three small databases side by side: one table split across servers.
    for (const x of [0, 9.5, 19]) {
      svgEl('path', { d: `M${x} 7v12a4 2 0 0 0 8 0V7z`, class: 'ic-data' }, g);
      svgEl('ellipse', { cx: x + 4, cy: 7, rx: 4, ry: 2, class: 'ic-data-top' }, g);
    }
  } else if (type === 'nosql') {
    // Key and value pairs: data looked up by key.
    for (const y of [3, 10.5, 18]) {
      svgEl('rect', { x: 1, y, width: 9, height: 5, rx: 1, class: 'ic-data' }, g);
      svgEl('rect', { x: 12, y, width: 14, height: 5, rx: 1, class: 'ic-stroke' }, g);
    }
  } else if (type === 'queue') {
    // Messages lined up in a pipe, oldest first.
    svgEl('rect', { x: 0, y: 6, width: 27, height: 12, rx: 3, class: 'ic-stroke' }, g);
    for (const x of [3.5, 10.5, 17.5]) svgEl('rect', { x, y: 9, width: 5, height: 6, rx: 1, class: 'ic-data' }, g);
  } else if (type === 'worker') {
    // A server with a cog: it does the work.
    svgEl('rect', { x: 2, y: 0, width: 13, height: 24, rx: 2, class: 'ic-web' }, g);
    svgEl('path', { d: 'M5.5 5.5h6M5.5 9.5h6', class: 'ic-line' }, g);
    svgEl('circle', { cx: 21, cy: 16, r: 4.5, class: 'ic-stroke' }, g);
    svgEl('path', { d: 'M21 9.5v2.5M21 20v2.5M14.5 16h2.5M25 16h2.5', class: 'ic-stroke' }, g);
  } else if (type === 'monitor') {
    // A screen with a rising line: metrics.
    svgEl('rect', { x: 0, y: 2, width: 27, height: 18, rx: 2, class: 'ic-stroke' }, g);
    svgEl('path', { d: 'M4 15l5-5 4 3 5-6 5 3M10 24h7', class: 'ic-stroke' }, g);
  } else if (type === 'dc') {
    // A building with server racks: a whole data center.
    svgEl('rect', { x: 1, y: 1, width: 25, height: 22, rx: 2, class: 'ic-stroke' }, g);
    for (const x of [5, 15]) { svgEl('rect', { x, y: 5, width: 7, height: 15, rx: 1, class: 'ic-web' }, g); svgEl('path', { d: `M${x + 1.8} 9h3.4M${x + 1.8} 13h3.4`, class: 'ic-line' }, g); }
  } else if (type === 'idgen') {
    // A tag with a number on it: a new ID.
    svgEl('path', { d: 'M1 6.5 7.5 1h18.5v22H7.5L1 17.5z', class: 'ic-stroke' }, g);
    svgEl('path', { d: 'M12 7v10M17 7v10M10 10.5h9M10 13.5h9', class: 'ic-stroke' }, g);
  } else if (type === 'downloader') {
    // A page with an arrow down: it fetches pages.
    svgEl('path', { d: 'M5 1h12l5 5v17H5z', class: 'ic-stroke' }, g);
    svgEl('path', { d: 'M13.5 7v10M9.5 13l4 4 4-4', class: 'ic-stroke' }, g);
  } else if (type === 'parser') {
    // A page with lines and a link mark: it reads pages and extracts links.
    svgEl('path', { d: 'M3 1h12l5 5v17H3z', class: 'ic-stroke' }, g);
    svgEl('path', { d: 'M7 9h9M7 13h9M7 17h5', class: 'ic-line' }, g);
  } else if (type === 'contentstore') {
    // Stacked disks: pages kept on disk.
    for (const y of [3, 10, 17]) svgEl('rect', { x: 2, y, width: 23, height: 5, rx: 2, class: 'ic-data' }, g);
  } else if (type === 'provider') {
    // An envelope: a message handed to an outside service.
    svgEl('rect', { x: 1, y: 4, width: 25, height: 17, rx: 2, class: 'ic-stroke' }, g);
    svgEl('path', { d: 'M2 5.5l11.5 9 11.5-9', class: 'ic-stroke' }, g);
  } else if (type === 'db') {
    svgEl('path', { d: 'M3.5 5v14a9.5 4 0 0 0 19 0V5z', class: 'ic-data' }, g);
    svgEl('ellipse', { cx: 13, cy: 5, rx: 9.5, ry: 4, class: 'ic-data-top' }, g);
  }
  return g;
}
