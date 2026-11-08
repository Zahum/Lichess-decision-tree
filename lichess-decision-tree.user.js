// ==UserScript==
// @name         Lichess decision tree
// @namespace    lichess-decision-tree
// @version      1.0.0
// @description  Shows the move list of Lichess analysis and studies as a decision tree: every option at a branch point on the same level, leader lines, one comment per row (switches to the active move's comment). A button switches back to Lichess's normal list.
// @author       Zahum
// @homepageURL  https://github.com/Zahum/lichess-decision-tree
// @supportURL   https://github.com/Zahum/lichess-decision-tree/issues
// @updateURL    https://raw.githubusercontent.com/Zahum/lichess-decision-tree/main/lichess-decision-tree.user.js
// @downloadURL  https://raw.githubusercontent.com/Zahum/lichess-decision-tree/main/lichess-decision-tree.user.js
// @license      MIT
// @match        https://lichess.org/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const STORE_KEY = 'ldt-tree-on';
  let treeOn = readSetting();
  let lastSignature = '';
  let lastActive = null;
  let scheduled = false;

  // ---------- styles ----------
  const style = document.createElement('style');
  style.textContent = `
    .analyse__moves.ldt-on .tview2 { display: none !important; }
    .ldt-box { font-size: 14px; }
    .ldt-bar {
      position: sticky; top: 0; z-index: 2;
      display: flex; justify-content: space-between; align-items: center;
      padding: 4px 8px; font-size: 11px;
      color: var(--c-font-dim, #8a8a8a);
      background: var(--c-bg-box, #262421);
      border-bottom: 1px solid rgba(128, 128, 128, 0.25);
    }
    .ldt-bar button {
      font-size: 11px; padding: 2px 8px; border-radius: 4px; cursor: pointer;
      border: 1px solid rgba(128, 128, 128, 0.45); background: transparent;
      color: var(--c-font, #bababa);
    }
    .ldt-bar button:hover { background: rgba(128, 128, 128, 0.18); }
    .ldt-tree { padding: 8px 10px 14px; line-height: 1.55; }
    .ldt-tree ul { list-style: none; margin: 0; padding: 0 0 0 10px; }
    .ldt-tree li { position: relative; padding-left: 16px; }
    .ldt-tree li::before {
      content: ''; position: absolute; left: 0; top: 0; bottom: 0;
      border-left: 2px solid rgba(140, 140, 140, 0.45);
    }
    .ldt-tree li:last-child::before { bottom: auto; height: 0.85em; }
    .ldt-tree li::after {
      content: ''; position: absolute; left: 0; top: 0.85em; width: 11px;
      border-top: 2px solid rgba(140, 140, 140, 0.45);
    }
    .ldt-row { padding: 1px 0 4px; }
    .ldt-mv {
      display: inline-block; padding: 0 5px; margin: 0 2px 0 0; border-radius: 4px;
      font-weight: 600; white-space: nowrap; cursor: pointer;
      color: var(--c-font-clear, #dddddd);
    }
    .ldt-mv:hover { background: rgba(128, 128, 128, 0.2); }
    .ldt-mv.active { background: var(--c-primary, #3692e7); color: #fff; }
    .ldt-ix { color: var(--c-font-dim, #8a8a8a); font-weight: 400; margin-right: 3px; }
    .ldt-mv.active .ldt-ix { color: rgba(255, 255, 255, 0.85); }
    .ldt-gl { margin-left: 2px; }
    .ldt-gl.good { color: var(--c-good, #22ac38); }
    .ldt-gl.brilliant { color: var(--c-brilliant, #168226); }
    .ldt-gl.interesting { color: var(--c-interesting, #ea45d8); }
    .ldt-gl.inaccuracy { color: var(--c-inaccuracy, #56b4e9); }
    .ldt-gl.mistake { color: var(--c-mistake, #e69d00); }
    .ldt-gl.blunder { color: var(--c-blunder, #df5353); }
    .ldt-more { font-size: 9px; margin-left: 2px; opacity: 0.7; vertical-align: super; }
    .ldt-cm {
      font-size: 12.5px; line-height: 1.35; padding: 1px 5px 3px;
      color: var(--c-font-dim, #9a9a9a); overflow-wrap: break-word;
    }
  `;
  document.head.appendChild(style);

  const GLYPH_CLASS = { '!': 'good', '!!': 'brilliant', '!?': 'interesting', '?!': 'inaccuracy', '?': 'mistake', '??': 'blunder' };

  // ---------- watch the page ----------
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      try { update(); } catch (e) { console.warn('[decision tree]', e); }
    });
  }
  new MutationObserver(schedule).observe(document.body, {
    childList: true, subtree: true, characterData: true,
    attributes: true, attributeFilter: ['class', 'p'],
  });
  schedule();

  function update() {
    const host = document.querySelector('.analyse__moves');
    const tview = host && host.querySelector('.tview2');
    if (!host || !tview) return;

    let box = host.querySelector(':scope > .ldt-box');
    if (!box) {
      box = document.createElement('div');
      box.className = 'ldt-box';
      lastSignature = '';
    }
    if (host.firstElementChild !== box) host.insertBefore(box, host.firstElementChild);
    if (host.classList.contains('ldt-on') !== treeOn) host.classList.toggle('ldt-on', treeOn);

    const data = parseMoveList(tview);
    const signature = (treeOn ? '1' : '0') + data.signature;
    if (signature === lastSignature) return;
    lastSignature = signature;

    render(box, data);
    if (treeOn && data.active !== lastActive) scrollToActive(box, host);
    lastActive = data.active;
  }

  // ---------- read Lichess's move list ----------
  function parseMoveList(tview) {
    const root = { p: '', children: [], comments: [], depth: 0 };
    const nodes = new Map();
    const order = [];
    let active = null;
    let last = root;
    let rootPly = null;

    for (const el of tview.querySelectorAll('move, comment')) {
      if (el.tagName === 'MOVE') {
        const p = el.getAttribute('p');
        if (p === null) continue; // the empty "..." placeholders
        let node = nodes.get(p);
        if (!node) {
          const sanEl = el.querySelector('san');
          node = {
            p,
            san: sanEl ? sanEl.textContent.trim() : '',
            glyphs: [...el.querySelectorAll('glyph')].map(g => g.textContent.trim()).filter(Boolean),
            children: [],
            comments: [],
            depth: p.length / 2,
          };
          nodes.set(p, node);
          order.push(node);
          const idx = el.querySelector('index');
          const m = idx && idx.textContent.trim().match(/^(\d+)(\.+)$/);
          if (m && rootPly === null) {
            const ply = m[2].length === 1 ? 2 * +m[1] - 1 : 2 * +m[1];
            rootPly = ply - node.depth;
          }
        }
        if (el.classList.contains('active')) active = p;
        last = node;
      } else {
        const parts = [...el.querySelectorAll(':scope > span:not(.by)')].map(s => s.textContent.trim());
        const text = (parts.join(' ').trim() || el.textContent.trim());
        if (text) last.comments.push(text);
      }
    }

    // parent/child links from the position paths (each move adds 2 characters)
    for (const node of order) {
      let parentPath = node.p.slice(0, -2);
      let parent = parentPath === '' ? root : nodes.get(parentPath);
      while (!parent && parentPath.length) {
        parentPath = parentPath.slice(0, -2);
        parent = parentPath === '' ? root : nodes.get(parentPath);
      }
      (parent || root).children.push(node);
    }

    // move numbers when no move carried a numbered index (two-column main line only)
    if (rootPly === null) {
      const firstIndex = tview.querySelector(':scope > index');
      const n = firstIndex ? parseInt(firstIndex.textContent, 10) : NaN;
      if (!isNaN(n)) {
        const next = firstIndex.nextElementSibling;
        const blackStarts = next && next.tagName === 'MOVE' && next.classList.contains('empty');
        rootPly = (blackStarts ? 2 * n : 2 * n - 1) - 1;
      } else rootPly = 0;
    }

    const signature = order
      .map(n => n.p + '\u0001' + n.san + '\u0001' + n.glyphs.join('') + '\u0001' + n.comments.join('\u0002'))
      .join('\u0003') + '\u0004' + active + '\u0004' + root.comments.join('\u0002') + '\u0004' + rootPly;

    return { root, active, rootPly, signature };
  }

  // ---------- draw the tree ----------
  function render(box, data) {
    box.textContent = '';
    const bar = document.createElement('div');
    bar.className = 'ldt-bar';
    const label = document.createElement('span');
    label.textContent = treeOn ? 'Decision tree' : '';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = treeOn ? 'Show Lichess list' : 'Show decision tree';
    btn.addEventListener('click', () => {
      treeOn = !treeOn;
      writeSetting(treeOn);
      lastSignature = '';
      schedule();
    });
    bar.append(label, btn);
    box.appendChild(bar);
    if (!treeOn) return;

    const tree = document.createElement('div');
    tree.className = 'ldt-tree';
    if (data.root.comments.length) tree.appendChild(commentEl(data.root.comments));
    const first = data.root.children;
    if (first.length === 1) tree.append(...segment(first[0], data));
    else if (first.length > 1) tree.appendChild(branchList(first, data));
    box.appendChild(tree);
  }

  // one row = a run of moves until the next choice; then the choices as a list
  function segment(start, data) {
    const moves = [];
    let cur = start;
    for (;;) {
      moves.push(cur);
      if (cur.children.length === 1) cur = cur.children[0];
      else break;
    }

    const withComments = moves.filter(m => m.comments.length);
    const activeWithComment = withComments.find(m => m.p === data.active);
    const shown = activeWithComment || withComments[0] || null;

    const row = document.createElement('div');
    row.className = 'ldt-row';
    moves.forEach((m, i) => row.appendChild(moveEl(m, i === 0, data, shown)));
    const out = [row];
    if (shown) out.push(commentEl(shown.comments));
    if (cur.children.length > 1) out.push(branchList(cur.children, data));
    return out;
  }

  function branchList(children, data) {
    const ul = document.createElement('ul');
    for (const child of children) {
      const li = document.createElement('li');
      li.append(...segment(child, data));
      ul.appendChild(li);
    }
    return ul;
  }

  function moveEl(m, firstInRow, data, shown) {
    const ply = data.rootPly + m.depth;
    const white = ply % 2 === 1;
    const num = Math.ceil(ply / 2);
    const el = document.createElement('span');
    el.className = 'ldt-mv' + (m.p === data.active ? ' active' : '');
    el.setAttribute('p', m.p); // lets Lichess handle clicks and right-clicks natively
    const indexText = white ? num + '.' : firstInRow ? num + '...' : '';
    if (indexText) {
      const ix = document.createElement('span');
      ix.className = 'ldt-ix';
      ix.textContent = indexText;
      el.appendChild(ix);
    }
    el.appendChild(document.createTextNode(m.san));
    for (const g of m.glyphs) {
      const gl = document.createElement('span');
      gl.className = 'ldt-gl ' + (GLYPH_CLASS[g] || '');
      gl.textContent = g;
      el.appendChild(gl);
    }
    if (m.comments.length && m !== shown) {
      const more = document.createElement('span');
      more.className = 'ldt-more';
      more.textContent = '💬';
      el.appendChild(more);
      el.title = m.comments.join('\n');
    }
    return el;
  }

  function commentEl(comments) {
    const el = document.createElement('div');
    el.className = 'ldt-cm';
    el.textContent = comments.join(' · ');
    return el;
  }

  function scrollToActive(box, host) {
    const a = box.querySelector('.ldt-mv.active');
    if (!a) return;
    const view = host.getBoundingClientRect();
    const r = a.getBoundingClientRect();
    if (r.top < view.top + 30 || r.bottom > view.bottom - 10) {
      host.scrollTop += r.top - view.top - (view.height - r.height) / 2;
    }
  }

  function readSetting() {
    try { return localStorage.getItem(STORE_KEY) !== '0'; } catch (e) { return true; }
  }
  function writeSetting(on) {
    try { localStorage.setItem(STORE_KEY, on ? '1' : '0'); } catch (e) { /* ignore */ }
  }
})();
