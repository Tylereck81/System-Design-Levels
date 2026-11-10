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

// HTML built from strings. Every value put into an `html` template is escaped, so a quote, `<` or `&` in level text
// shows as written and cannot break the markup. Markup a level writes on purpose (a lesson, a gate prompt) is marked
// with raw(). This file is the only one that writes innerHTML (eslint.config.js enforces it).
const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ESCAPES[c]);

/** Markup that is already safe: made by `html` or marked with raw(). */
class SafeHtml {
  constructor(s) { this.__html = s; }
  toString() { return this.__html; }
}

/** Authored markup, inserted as it is. Never pass it text a player typed. */
export const raw = (s) => new SafeHtml(s == null ? '' : String(s));

// One interpolated value: safe markup as it is, an array as its parts joined, null/undefined/false as nothing, else text.
const part = (v) => v instanceof SafeHtml ? v.__html
  : Array.isArray(v) ? v.map(part).join('')
    : v == null || v === false ? '' : escapeHtml(v);

/** Tagged template: html`<b>${name}</b>` escapes `name`. Nest html results, or arrays of them, without escaping twice. */
export const html = (strings, ...values) => new SafeHtml(strings.reduce((out, s, i) => out + part(values[i - 1]) + s));

// The markup each live panel was last given by setHtmlIfChanged (compared as written, not as the browser reads it back).
const lastHtml = new WeakMap();

/** Replace an element's contents. Anything but `html`/raw() output is shown as text. */
export function setHtml(e, h) {
  lastHtml.delete(e);
  e.innerHTML = part(h); // eslint-disable-line no-restricted-syntax -- the one place
}

/**
 * setHtml for a panel repainted while the game plays: skips the write when the markup is the same as last time, so a
 * hover, a text selection or a screen reader's place inside it survives.
 */
export function setHtmlIfChanged(e, h) {
  const s = part(h);
  if (lastHtml.get(e) === s) return;
  e.innerHTML = s; // eslint-disable-line no-restricted-syntax -- the one place
  lastHtml.set(e, s);
}

/** Put markup at the start of an element, before what is already there. */
export function prependHtml(e, h) { e.insertAdjacentHTML('afterbegin', part(h)); } // eslint-disable-line no-restricted-syntax -- the one place

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
