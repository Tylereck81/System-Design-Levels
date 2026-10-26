// DOM and SVG helpers.

export const NS = 'http://www.w3.org/2000/svg';
export const $ = (id) => document.getElementById(id);
export const svgEl = (tag, attrs, parent) => {
  const e = document.createElementNS(NS, tag);
  if (attrs) for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(e);
  return e;
};

export function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

/**
 * Re-render a panel without losing keyboard focus. If focus was inside `container`, the same control
 * (matched by data-focus-key, else id) gets it back afterwards; if that control is gone, `fallback()` does.
 */
export function keepFocus(container, render, fallback) {
  const a = document.activeElement;
  const inside = !!a && a !== document.body && container.contains(a);
  const key = inside ? (a.dataset.focusKey || a.id) : null;
  render();
  if (!inside || (document.activeElement && document.activeElement !== document.body)) return;
  const again = key && (container.querySelector(`[data-focus-key="${CSS.escape(key)}"]`) || document.getElementById(key));
  const target = again || (fallback && fallback());
  if (target) target.focus({ preventScroll: true });
}
