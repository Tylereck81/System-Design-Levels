// js/dom.js: the html tagged template escapes every value; raw() marks authored markup.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { html, raw, escapeHtml, setHtml, setHtmlIfChanged } from '../../js/dom.js';

test('escapeHtml escapes the five characters that can break markup', () => {
  assert.equal(escapeHtml(`a "b" 'c' <d> & e`), 'a &quot;b&quot; &#39;c&#39; &lt;d&gt; &amp; e');
  assert.equal(escapeHtml(42), '42');
});

test('html escapes values in text and in attributes', () => {
  const t = 'A "quoted" <b>&</b> title';
  assert.equal(String(html`<p title="${t}">${t}</p>`),
    '<p title="A &quot;quoted&quot; &lt;b&gt;&amp;&lt;/b&gt; title">A &quot;quoted&quot; &lt;b&gt;&amp;&lt;/b&gt; title</p>');
});

test('raw() and nested html are inserted as they are, never escaped twice', () => {
  const inner = html`<i>${'1 < 2'}</i>`;
  assert.equal(String(html`<p>${inner}${raw('<b>bold</b>')}</p>`), '<p><i>1 &lt; 2</i><b>bold</b></p>');
});

test('arrays join their parts; null, undefined and false add nothing; 0 is kept', () => {
  assert.equal(String(html`<ul>${['<a>', html`<li>b</li>`]}</ul>`), '<ul>&lt;a&gt;<li>b</li></ul>');
  assert.equal(String(html`${null}${undefined}${false}${0}`), '0');
  assert.equal(String(raw(null)), '');
});

test('setHtmlIfChanged writes only when the markup differs from what it last wrote', () => {
  const writes = [];
  const e = { set innerHTML(s) { writes.push(s); } };
  setHtmlIfChanged(e, html`<b>${1}</b>`);
  setHtmlIfChanged(e, html`<b>${1}</b>`); // same: skipped
  setHtmlIfChanged(e, html`<b>${2}</b>`);
  setHtml(e, html`<i>x</i>`); // another writer: what setHtmlIfChanged remembers no longer holds
  setHtmlIfChanged(e, html`<b>${2}</b>`);
  assert.deepEqual(writes, ['<b>1</b>', '<b>2</b>', '<i>x</i>', '<b>2</b>']);
});
