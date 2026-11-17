// @ts-check
// Drawing pieces that several levels' lesson pictures use. Each takes `f`, the drawing helpers `drawFigures` is given,
// so it draws with the page's own classes and needs no imports.

/**
 * A dashed frame with its label, for one panel of a two-panel picture.
 * @param {Record<string, Function>} f the drawing helpers `drawFigures` is given
 * @param {SVGSVGElement} svg
 * @param {number} y
 * @param {number} height
 * @param {string} label
 */
export function panel(f, svg, y, height, label) {
  f.svgEl('rect', { x: 10, y, width: 620, height, rx: 12, class: 'tier-box' }, svg);
  f.figLabel(svg, 24, y + 20, label, 'start', 'tier-label');
}

/**
 * A queue drawn as a row of labelled cells, tail on the left and head on the right.
 * @param {Record<string, Function>} f the drawing helpers `drawFigures` is given
 * @param {SVGSVGElement} svg
 * @param {number} x left edge
 * @param {number} y centre line
 * @param {string[]} labels one per cell, tail first
 * @param {number} [cell] width of one cell
 */
export function queueCells(f, svg, x, y, labels, cell = 40) {
  labels.forEach((label, i) => {
    f.svgEl('rect', { x: x + cell * i, y: y - 14, width: cell, height: 28, rx: 5, class: 'node-box' }, svg);
    f.figLabel(svg, x + cell * i + cell / 2, y + 4, label);
  });
}

/**
 * One lane of a timeline: its name on the left and a faint line along it, from `x1` to `x2`.
 * @param {Record<string, Function>} f the drawing helpers `drawFigures` is given
 * @param {SVGSVGElement} svg
 * @param {number} y the lane's line
 * @param {string} name
 * @param {number} x1
 * @param {number} x2
 */
export function lane(f, svg, y, name, x1, x2) {
  f.figLabel(svg, 24, y + 4, name, 'start', 'tier-label');
  f.svgEl('line', { x1, y1: y, x2, y2: y, class: 'tier-box' }, svg);
}
