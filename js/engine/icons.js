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
  } else if (type === 'web') {
    svgEl('rect', { x: 6, y: 0, width: 15, height: 24, rx: 2, class: 'ic-web' }, g);
    svgEl('path', { d: 'M9.5 5.5h8M9.5 16.5h8M9.5 20h8', class: 'ic-line' }, g);
  } else if (type === 'db') {
    svgEl('path', { d: 'M3.5 5v14a9.5 4 0 0 0 19 0V5z', class: 'ic-data' }, g);
    svgEl('ellipse', { cx: 13, cy: 5, rx: 9.5, ry: 4, class: 'ic-data-top' }, g);
  }
  return g;
}
