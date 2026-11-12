// The header's level picker. Needs no level loaded, so the home page uses it too.
import { $, el } from '../dom.js';
import { LEVELS, MOCK } from '../../levels/index.js';
import { routeHash } from '../route.js';

const btn = $('lvlBtn'), menu = $('lvlMenu');

/** Fill the picker's list; `currentId` (a level id, 'mock', or null on the home page) is marked as the current page. */
export function renderPicker(currentId) {
  const list = $('lvlList'); list.textContent = '';
  const item = (id, chip, name) => {
    const a = el('a'); a.href = routeHash(id, 'lesson');
    if (id === currentId) a.setAttribute('aria-current', 'page');
    a.append(el('span', 'chip', chip), el('span', null, name));
    a.addEventListener('click', () => setOpen(false));
    list.appendChild(el('li')).appendChild(a);
  };
  for (const l of LEVELS) item(l.id, `Level ${l.id}`, l.title);
  item(MOCK.id, 'Mock', 'Mock interview: a timed problem');
}

function setOpen(open, focusButton) {
  menu.hidden = !open;
  btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  if (open) (menu.querySelector('[aria-current]') || menu.querySelector('a')).focus();
  else if (focusButton) btn.focus();
}
btn.addEventListener('click', () => setOpen(menu.hidden));
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !menu.hidden) { e.stopPropagation(); setOpen(false, true); } }, true);
document.addEventListener('pointerdown', (e) => { if (!menu.hidden && !e.target.closest('.lvl-wrap')) setOpen(false); });
