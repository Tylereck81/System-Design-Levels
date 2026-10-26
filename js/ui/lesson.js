// Lesson diagram helpers.
import level from '../../levels/level-01.js';
import { $, svgEl } from '../dom.js';
import { drawIcon } from '../engine/icons.js';

export function figNode(svg, type, x, y, name, sub) {
  const w = 188, h = 60;
  const g = svgEl('g', { transform: `translate(${x - w / 2} ${y - h / 2})` }, svg);
  svgEl('rect', { x: 0, y: 0, width: w, height: h, rx: 11, class: 'node-box' }, g);
  drawIcon(type, g, 12, 18);
  const t = svgEl('text', { x: 52, y: 26, class: 'node-name' }, g); t.textContent = name;
  const s = svgEl('text', { x: 52, y: 43, class: 'node-sub' }, g); s.textContent = sub;
}
export function figArrow(svg, x1, y1, x2, y2, label, step, lx, ly, anchor) {
  svgEl('line', { x1, y1, x2, y2, class: 'd-line', 'marker-end': 'url(#figArr)' }, svg);
  if (step) {
    svgEl('circle', { cx: lx - 13, cy: ly - 4, r: 9, class: 'd-step' }, svg);
    const s = svgEl('text', { x: lx - 13, y: ly, class: 'd-step-t', 'text-anchor': 'middle' }, svg); s.textContent = step;
  }
  const t = svgEl('text', { x: lx, y: ly, class: 'd-label', 'text-anchor': anchor || 'start' }, svg); t.textContent = label;
}
export function figDefs(svg) {
  const defs = svgEl('defs', {}, svg);
  const mk = svgEl('marker', { id: 'figArr', viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' }, defs);
  svgEl('path', { d: 'M0 0L10 5L0 10z', class: 'arrowhead' }, mk);
}
export const drawFigures = () => level.drawFigures({ $, svgEl, figNode, figArrow, figDefs });
