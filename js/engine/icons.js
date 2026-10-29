// Component icons.
import { svgEl } from '../dom.js';

export function drawIcon(type, parent, x, y, scale) {
  const g = svgEl('g', { transform: `translate(${x} ${y})` + (scale ? ` scale(${scale})` : '') }, parent);
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
  } else if (type === 'dc') {
    // A building with server racks: a whole data center.
    svgEl('rect', { x: 1, y: 1, width: 25, height: 22, rx: 2, class: 'ic-stroke' }, g);
    for (const x of [5, 15]) { svgEl('rect', { x, y: 5, width: 7, height: 15, rx: 1, class: 'ic-web' }, g); svgEl('path', { d: `M${x + 1.8} 9h3.4M${x + 1.8} 13h3.4`, class: 'ic-line' }, g); }
  } else if (type === 'db') {
    svgEl('path', { d: 'M3.5 5v14a9.5 4 0 0 0 19 0V5z', class: 'ic-data' }, g);
    svgEl('ellipse', { cx: 13, cy: 5, rx: 9.5, ry: 4, class: 'ic-data-top' }, g);
  }
  return g;
}
