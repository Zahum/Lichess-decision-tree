// ==UserScript==
// @name         Lichess decision tree
// @namespace    lichess-decision-tree
// @version      2.5.0
// @description  Shows the move list of Lichess analysis and studies as a decision tree (every option at a branch point on the same level, leader lines, one comment per row) and adds a practice mode that drills every line of a chapter.
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

  // ---------- settings ----------
  const store = {
    get: (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } },
    del: k => { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } },
  };
  const KEYS = {
    treeOn: 'ldt-tree-on',
    order: 'ldt-order',
    comments: 'ldt-comments',
    recRestore: 'ldt-rec-restore',
    collapsed: 'ldt-collapsed:',
    sr: 'ldt-sr:',
  };
  const ORDERS = { tree: 'Tree order', shuffle: 'Shuffled', sr: 'Spaced repetition' };
  const SR_INTERVALS_MIN = [0, 10, 1440, 4320, 10080, 30240]; // 0, 10 min, 1 d, 3 d, 7 d, 21 d
  const VERSION = '2.5.0';
  const OPPONENT_DELAY = 450;
  const RESET_TIMEOUT = 1200;
  const NEXT_LINE_DELAY = 1500;

  let treeOn = store.get(KEYS.treeOn, '1') !== '0';
  let practice = null; // practice session state, null when not practising
  let lastSignature = '';
  let lastActive = null;
  let scheduled = false;

  // ---------- styles ----------
  const style = document.createElement('style');
  style.textContent = `
    .analyse__moves.ldt-on .tview2 { display: none !important; }
    body.ldt-practicing .analyse__fork { display: none !important; }
    .ldt-forktag {
      pointer-events: none; display: inline-block; margin-left: 8px; padding: 0 7px; border-radius: 9px;
      font-size: 11px; font-weight: 600; line-height: 1.6; align-self: center;
      background: rgba(128, 128, 128, 0.22); color: var(--c-font, #bababa);
    }
    .ldt-forktag.ldt-colored { background: color-mix(in srgb, var(--ldt-lv) 20%, transparent); color: var(--ldt-lv); }
    .ldt-box { font-size: 14px; }
    .ldt-bar {
      position: sticky; top: 0; z-index: 2;
      display: flex; flex-wrap: wrap; gap: 6px; justify-content: space-between; align-items: center;
      padding: 4px 8px; font-size: 11px;
      color: var(--c-font-dim, #8a8a8a);
      background: var(--c-bg-box, #262421);
      border-bottom: 1px solid rgba(128, 128, 128, 0.25);
    }
    .ldt-bar b { color: var(--c-font-clear, #ddd); font-size: 12px; }
    .ldt-bar .ldt-grp { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
    .ldt-box button, .ldt-box select {
      font-size: 11px; padding: 2px 8px; border-radius: 4px; cursor: pointer;
      border: 1px solid rgba(128, 128, 128, 0.45); background: transparent;
      color: var(--c-font, #bababa);
    }
    .ldt-box select { padding: 1px 4px; background: var(--c-bg-box, #262421); }
    .ldt-box button:hover { background: rgba(128, 128, 128, 0.18); }
    .ldt-box label { display: inline-flex; gap: 3px; align-items: center; cursor: pointer; }
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

    /* practice */
    .ldt-prog { display: flex; flex-wrap: wrap; gap: 4px; padding: 8px 10px 2px; }
    .ldt-seg { width: 14px; height: 6px; border-radius: 3px; background: rgba(128, 128, 128, 0.3); cursor: pointer; }
    .ldt-seg.ok { background: #629924; }
    .ldt-seg.bad { background: #cc3333; }
    .ldt-seg.cur { background: var(--c-primary, #3692e7); }
    .ldt-lbl { padding: 2px 10px 4px; font-size: 11px; color: var(--c-font-dim, #8a8a8a); }
    .ldt-line { padding: 6px 12px 2px; line-height: 1.9; }
    .ldt-q {
      display: inline-block; padding: 0 7px; border-radius: 4px; font-weight: 700;
      border: 1px dashed var(--c-primary, #3692e7); color: var(--c-primary, #3692e7);
    }
    .ldt-pcm { padding: 0 17px 6px; }
    .ldt-fb { margin: 4px 12px 10px; padding: 7px 10px; border-radius: 5px; font-size: 13px; line-height: 1.35; }
    .ldt-fb.info { background: rgba(54, 146, 231, 0.12); color: #8fc3f5; border-left: 3px solid #3692e7; }
    .ldt-fb.good { background: rgba(98, 153, 36, 0.18); color: #9fd36a; border-left: 3px solid #629924; }
    .ldt-fb.bad { background: rgba(204, 51, 51, 0.15); color: #f08a8a; border-left: 3px solid #cc3333; }
    .ldt-fb.warn { background: rgba(230, 157, 0, 0.14); color: #f0c060; border-left: 3px solid #e69d00; }
    .ldt-fb button { margin-left: 6px; }
    .ldt-btns { display: flex; flex-wrap: wrap; gap: 6px; padding: 8px 10px 10px; border-top: 1px solid rgba(128, 128, 128, 0.25); }
    .ldt-btns button { flex: 1 1 22%; font-size: 12px; padding: 5px 4px; }
    .ldt-ptree { border-top: 1px solid rgba(128, 128, 128, 0.25); }
    .ldt-ver { font-weight: 400; font-size: 10px; color: var(--c-font-dimmer, #777); }
    .ldt-tag {
      display: inline-block; margin-left: 6px; padding: 0 8px; border-radius: 9px;
      font-size: 11px; font-weight: 600; line-height: 1.65; vertical-align: 1px;
      background: rgba(128, 128, 128, 0.18); color: var(--c-font, #bababa);
    }
    .ldt-row.ldt-colored .ldt-tag {
      background: color-mix(in srgb, var(--ldt-lv) 18%, transparent); color: var(--ldt-lv);
    }
    .ldt-row.ldt-colored > .ldt-mv:first-child:not(.active) .ldt-ix { color: var(--ldt-lv); font-weight: 700; }
    .ldt-fold {
      display: inline-block; margin-left: 6px; padding: 0 6px; border-radius: 4px; cursor: pointer;
      font-size: 11px; line-height: 1.55; vertical-align: 1px; user-select: none;
      color: var(--c-font-dim, #8a8a8a); border: 1px solid rgba(128, 128, 128, 0.35);
    }
    .ldt-fold:hover { background: rgba(128, 128, 128, 0.18); }
    .ldt-fold.open { opacity: 0.25; transition: opacity 0.15s; }
    .ldt-row:hover .ldt-fold.open { opacity: 1; }
  `;
  document.head.appendChild(style);

  // one colour per tree level, starting below the top row (cycles after the last one)
  const LEVEL_COLORS = ['#4f9cf0', '#3db36f', '#d65cd6', '#e8833a', '#e05555', '#2bb3b3'];
  const levelColor = lv => (lv < 1 ? null : LEVEL_COLORS[(lv - 1) % LEVEL_COLORS.length]);

  const GLYPH_CLASS = { '!': 'good', '!!': 'brilliant', '!?': 'interesting', '?!': 'inaccuracy', '?': 'mistake', '??': 'blunder' };

  // ---------- watch the page ----------
  function schedule(force) {
    if (force) lastSignature = '';
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      try { update(); } catch (e) { console.warn('[decision tree]', e); }
    });
  }
  new MutationObserver(() => schedule()).observe(document.body, {
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
    const hide = treeOn || !!practice;
    if (host.classList.contains('ldt-on') !== hide) host.classList.toggle('ldt-on', hide);

    if (!practice) restoreRecIfPending();

    const data = parseMoveList(tview);
    if (document.body.classList.contains('ldt-practicing') !== !!practice) document.body.classList.toggle('ldt-practicing', !!practice);
    if (!practice) decorateFork(data);
    if (practice) practiceTick(data);

    const signature = (practice ? 'P' + practice.version : treeOn ? '1' : '0') + data.signature;
    if (signature === lastSignature) return;
    lastSignature = signature;

    if (practice) renderPractice(box, data);
    else render(box, data);
    if (!practice && treeOn && data.active !== lastActive) scrollToActive(box, host);
    lastActive = data.active;
  }

  // ---------- read Lichess's move list ----------
  function parseMoveList(tview) {
    const root = { p: '', san: '', glyphs: [], children: [], comments: [], label: '', depth: 0 };
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
            label: '',
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
        let text = parts.join(' ').trim() || el.textContent.trim();
        // a comment starting with [Name] names the line: "[Scotch game] White pushes..."
        const named = text.match(/^\[([^\[\]]{1,60})\]\s*([\s\S]*)$/);
        if (named) { last.label = named[1].trim(); text = named[2].trim(); }
        if (text) last.comments.push(text);
      }
    }

    for (const node of order) {
      let parentPath = node.p.slice(0, -2);
      let parent = parentPath === '' ? root : nodes.get(parentPath);
      while (!parent && parentPath.length) {
        parentPath = parentPath.slice(0, -2);
        parent = parentPath === '' ? root : nodes.get(parentPath);
      }
      node.parent = parent || root;
      node.parent.children.push(node);
    }

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
      .map(n => n.p + '\u0001' + n.san + '\u0001' + n.glyphs.join('') + '\u0001' + n.label + '\u0001' + n.comments.join('\u0002'))
      .join('\u0003') + '\u0004' + active + '\u0004' + root.comments.join('\u0002') + '\u0004' + rootPly;

    return { root, nodes, active, rootPly, signature };
  }

  // ---------- tree view ----------
  function render(box, data) {
    box.textContent = '';
    const bar = el('div', 'ldt-bar');
    bar.appendChild(el('span', '', treeOn ? 'Decision tree' : ''));
    const grp = el('span', 'ldt-grp');
    const foldable = treeOn ? foldablePaths(data) : [];
    if (foldable.length) {
      grp.appendChild(button('▸ Collapse all', () => setCollapsed(foldable)));
      grp.appendChild(button('▾ Expand all', () => setCollapsed([])));
    }
    if (data.root.children.length) {
      const sc = practiceScope(data);
      const all = sc.leaves.length === countLeaves(data, data.root);
      const txt = all ? '▶ Practice all' : `▶ Practice: ${sc.name} (${sc.leaves.length} ${sc.leaves.length === 1 ? 'line' : 'lines'})`;
      const btn = button(txt, () => startPractice(data));
      btn.title = all ? 'Practise every line of this chapter' : 'Practise only the lines below the move you are on. Go to the first move to practise everything.';
      grp.appendChild(btn);
    }
    grp.appendChild(button(treeOn ? 'Show Lichess list' : 'Show decision tree', () => {
      treeOn = !treeOn;
      store.set(KEYS.treeOn, treeOn ? '1' : '0');
      schedule(true);
    }));
    bar.appendChild(grp);
    box.appendChild(bar);
    if (treeOn) box.appendChild(treeEl(data, data.active));
  }

  function collapsedKey() { return KEYS.collapsed + location.pathname; }
  function loadCollapsed() {
    try { return new Set(JSON.parse(store.get(collapsedKey(), '[]'))); } catch (e) { return new Set(); }
  }
  function setCollapsed(paths) {
    store.set(collapsedKey(), JSON.stringify(paths));
    schedule(true);
  }
  // every row that has choices below it (rows are keyed by their first move)
  function foldablePaths(data) {
    const out = [];
    (function walk(children) {
      for (const start of children) {
        let end = start;
        while (end.children.length === 1) end = end.children[0];
        if (end.children.length > 1) { out.push(start.p); walk(end.children); }
      }
    })(data.root.children.length === 1 ? [data.root.children[0]] : data.root.children);
    return out;
  }
  function toggleCollapsed(path) {
    const set = loadCollapsed();
    if (set.has(path)) set.delete(path); else set.add(path);
    store.set(collapsedKey(), JSON.stringify([...set]));
    schedule(true);
  }

  function treeEl(data, active) {
    data.collapsed = loadCollapsed();
    const tree = el('div', 'ldt-tree');
    if (data.root.comments.length) tree.appendChild(commentEl(data.root.comments));
    const first = data.root.children;
    if (first.length === 1) tree.append(...segment(first[0], data, active, 0));
    else if (first.length > 1) tree.appendChild(branchList(first, data, active, 0));
    return tree;
  }

  // one row = a run of moves until the next choice; then the choices as a list
  function segment(start, data, active, level) {
    const moves = [];
    let cur = start;
    for (;;) {
      moves.push(cur);
      if (cur.children.length === 1) cur = cur.children[0];
      else break;
    }
    const withComments = moves.filter(m => m.comments.length);
    const shown = withComments.find(m => m.p === active) || withComments[0] || null;

    const row = el('div', 'ldt-row');
    const color = levelColor(level);
    if (color) { row.classList.add('ldt-colored'); row.style.setProperty('--ldt-lv', color); }
    moves.forEach((m, i) => row.appendChild(moveEl(m, i === 0, data.rootPly, active, shown)));
    // line names as labels at the end of the row
    for (const m of moves) if (m.label) row.appendChild(el('span', 'ldt-tag', m.label));
    // collapse / expand the choices below this row (stays open while you are inside it)
    const hasChoices = cur.children.length > 1;
    const insideNow = !!active && active.length > cur.p.length && active.startsWith(cur.p);
    const folded = hasChoices && data.collapsed && data.collapsed.has(start.p) && !insideNow;
    if (hasChoices) {
      const n = countLines(cur);
      const fold = el('span', 'ldt-fold' + (folded ? '' : ' open'), folded ? '▸ ' + n + (n === 1 ? ' line' : ' lines') : '▾');
      fold.title = folded ? 'Show the lines below' : 'Hide the lines below';
      fold.addEventListener('click', e => { e.stopPropagation(); toggleCollapsed(start.p); });
      row.appendChild(fold);
    }
    const out = [row];
    if (shown) out.push(commentEl(shown.comments));
    if (hasChoices && !folded) out.push(branchList(cur.children, data, active, level + 1));
    return out;
  }

  function countLines(node) {
    return node.children.length ? node.children.reduce((s, c) => s + countLines(c), 0) : 1;
  }

  function branchList(children, data, active, level) {
    const ul = el('ul');
    for (const child of children) {
      const li = el('li');
      li.append(...segment(child, data, active, level));
      ul.appendChild(li);
    }
    return ul;
  }

  function moveEl(m, firstInRow, rootPly, active, shown) {
    const ply = rootPly + m.depth;
    const white = ply % 2 === 1;
    const num = Math.ceil(ply / 2);
    const node = el('span', 'ldt-mv' + (m.p === active ? ' active' : ''));
    node.setAttribute('p', m.p); // lets Lichess handle clicks and right-clicks natively
    const indexText = white ? num + '.' : firstInRow ? num + '...' : '';
    if (indexText) node.appendChild(el('span', 'ldt-ix', indexText));
    node.appendChild(document.createTextNode(m.san));
    for (const g of m.glyphs) node.appendChild(el('span', 'ldt-gl ' + (GLYPH_CLASS[g] || ''), g));
    if (shown !== undefined && m.comments.length && m !== shown) {
      node.appendChild(el('span', 'ldt-more', '💬'));
      node.title = m.comments.join('\n');
    }
    return node;
  }

  function commentEl(comments, extraClass) {
    return el('div', 'ldt-cm' + (extraClass ? ' ' + extraClass : ''), comments.join(' · '));
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

  // ---------- names on Lichess's variation buttons (under the move list) ----------
  function rowName(node) {
    for (let n = node; ; n = n.children[0]) {
      if (n.label) return n.label;
      if (n.children.length !== 1) return '';
    }
  }
  // tree level of the row that starts with `node` (same numbering as the tree view)
  function rowLevel(node, data) {
    let lv = 0;
    for (let a = node.parent; a && a !== data.root; a = a.parent) if (a.children.length > 1) lv++;
    return lv;
  }
  function decorateFork(data) {
    const fork = document.querySelector('.analyse__fork');
    if (!fork) return;
    const here = data.active ? data.nodes.get(data.active) : data.root;
    if (!here) return;
    fork.querySelectorAll(':scope > move[data-it]').forEach(mv => {
      const child = here.children[parseInt(mv.getAttribute('data-it'), 10)];
      const name = child ? rowName(child) : '';
      let tag = mv.querySelector(':scope > .ldt-forktag');
      if (!name) { if (tag) tag.remove(); return; }
      if (!tag) {
        tag = el('span', 'ldt-forktag');
        const san = mv.querySelector(':scope > san');
        if (san) san.after(tag); else mv.appendChild(tag); // keeps the eval at the right edge
      }
      if (tag.textContent !== name) tag.textContent = name;
      const color = levelColor(rowLevel(child, data));
      const want = color ? 'ldt-forktag ldt-colored' : 'ldt-forktag';
      if (tag.className !== want) tag.className = want;
      if (color && tag.style.getPropertyValue('--ldt-lv') !== color) tag.style.setProperty('--ldt-lv', color);
    });
  }

  // =====================================================================
  // PRACTICE MODE
  // =====================================================================
  // the lines below the move you are on (all lines when you are on the first row's start)
  function leavesUnder(data, node) {
    const out = [];
    (function collect(n) {
      if (!n.children.length) { if (n !== data.root) out.push(n.p); return; }
      n.children.forEach(collect);
    })(node);
    return out;
  }
  function countLeaves(data, node) { return leavesUnder(data, node).length; }
  function practiceScope(data) {
    let path = data.active || '';
    let node = path ? data.nodes.get(path) : data.root;
    if (!node) { path = ''; node = data.root; }
    const leaves = leavesUnder(data, node);
    if (leaves.length === countLeaves(data, data.root)) return { path: '', leaves, name: 'all lines' };
    // 1) a name in the move's own row (the run of moves between two branch points)
    let rowStart = node;
    while (rowStart.parent && rowStart.parent !== data.root && rowStart.parent.children.length === 1) rowStart = rowStart.parent;
    let name = '';
    for (let n = rowStart; ; n = n.children[0]) {
      if (n.label) { name = n.label; break; }
      if (n.children.length !== 1) break;
    }
    // 2) otherwise the nearest name above, plus the move that starts this row
    if (!name) {
      let above = '';
      for (let n = rowStart.parent; n && n !== data.root; n = n.parent) if (n.label) { above = n.label; break; }
      const mv = moveText(rowStart.san, data.rootPly + rowStart.depth);
      name = above ? above + ' · ' + mv : 'after ' + mv;
    }
    return { path, leaves, name };
  }

  function startPractice(data) {
    const wrap = document.querySelector('.main-board .cg-wrap') || document.querySelector('.cg-wrap');
    const side = wrap && wrap.classList.contains('orientation-black') ? 'black' : 'white';
    const scope = practiceScope(data);
    const leaves = scope.leaves;
    if (!leaves.length) return;

    practice = {
      snap: data, side, leaves, scope,
      order: ORDERS[store.get(KEYS.order, 'tree')] ? store.get(KEYS.order, 'tree') : 'tree',
      comments: store.get(KEYS.comments, '1') !== '0',
      queue: [], idx: 0, results: new Map(),
      target: null, cur: '', mistakes: 0, revealed: false,
      expecting: null, feedback: null, browsing: false, showTree: false,
      roundDone: false, junk: false, recRestore: false, timer: 0, version: 0, keepFeedback: false, resetStuck: false,
    };
    switchRecOff();
    buildQueue();
    startLine(0);
  }

  function exitPractice() {
    const p = practice;
    if (!p) return;
    clearTimeout(p.timer);
    practice = null;
    const reload = p.junk;
    if (p.recRestore) {
      const rec = recButton();
      if (rec && !rec.classList.contains('on')) rec.click();
      store.del(KEYS.recRestore);
    }
    if (reload) location.reload(); // clears the wrong practice moves from the page
    else schedule(true);
  }

  function bump() { if (practice) { practice.version++; schedule(true); } }

  function buildQueue() {
    const p = practice;
    let q = p.leaves.slice();
    if (p.order === 'shuffle') {
      for (let i = q.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [q[i], q[j]] = [q[j], q[i]];
      }
    } else if (p.order === 'sr') {
      const rec = srLoad();
      const pos = new Map(q.map((l, i) => [l, i]));
      q.sort((a, b) => ((rec[a] && rec[a].due) || 0) - ((rec[b] && rec[b].due) || 0) || pos.get(a) - pos.get(b));
    }
    p.queue = q;
    p.results = new Map();
    p.roundDone = false;
  }

  function startLine(i) {
    const p = practice;
    clearTimeout(p.timer);
    p.idx = Math.max(0, Math.min(i, p.queue.length - 1));
    p.target = p.queue[p.idx];
    p.mistakes = 0;
    p.revealed = false;
    p.feedback = null;
    p.keepFeedback = false;
    p.browsing = false;
    p.roundDone = false;
    p.cur = '';
    jumpTo('');
    bump();
  }

  function nextPending(from) {
    const p = practice;
    for (let k = 1; k <= p.queue.length; k++) {
      const i = (from + k) % p.queue.length;
      if (!p.results.has(p.queue[i])) return i;
    }
    return -1;
  }

  const nodeOf = path => (path === '' ? practice.snap.root : practice.snap.nodes.get(path));
  const plyOf = path => practice.snap.rootPly + path.length / 2;
  const userToMove = path => {
    const whiteToMove = plyOf(path) % 2 === 0;
    return (practice.side === 'white') === whiteToMove;
  };

  // reacts to what happened on the board
  function practiceTick(data) {
    const p = practice;
    const active = data.active || '';
    if (p.expecting !== null) {
      if (active !== p.expecting) return; // still waiting for Lichess to get there
      p.expecting = null;
      p.resetStuck = false;
      p.cur = active;
      p.browsing = false;
      arrive();
      return;
    }
    if (active === p.cur) {
      if (p.browsing) { p.browsing = false; bump(); }
      return;
    }
    const isChild = active.length === p.cur.length + 2 && active.startsWith(p.cur);
    if (isChild && !p.browsing && !p.roundDone && nodeOf(p.cur).children.length) {
      if (p.snap.nodes.has(active) && !p.queue.some(l => l === active || l.startsWith(active))) {
        // in the repertoire, but outside the lines being practised
        p.keepFeedback = true;
        p.feedback = { type: 'warn', text: '↩ That move is in your repertoire, but outside "' + p.scope.name + '". Play the move for this line.' };
        jumpTo(p.cur);
        bump();
      } else if (p.snap.nodes.has(active)) {
        // a move from the repertoire: follow it (and switch lines if it is another branch)
        p.cur = active;
        if (!p.target.startsWith(active)) retarget(active);
        if (!userToMove(p.cur.slice(0, -2))) p.feedback = null;
        else p.feedback = { type: 'good', text: '✓ Correct' };
        arrive();
      } else {
        // not in the repertoire: count it, take it back
        const wrong = data.nodes.get(active);
        p.mistakes++;
        p.junk = true;
        p.keepFeedback = true;
        p.feedback = {
          type: 'bad',
          text: '✗ ' + (wrong ? moveText(wrong.san, plyOf(active)) + ' isn\'t' : 'That move isn\'t') +
            ' in your repertoire. The move was taken back, try again.',
        };
        jumpTo(p.cur);
        bump();
      }
      return;
    }
    if (!p.browsing) { p.browsing = true; bump(); }
  }

  // the board reached p.cur: decide what comes next
  function arrive() {
    const p = practice;
    const node = nodeOf(p.cur);
    if (!node || !node.children.length) {
      const ok = p.mistakes === 0 && !p.revealed;
      p.results.set(p.target, ok ? 'ok' : 'bad');
      srRecord(p.target, ok);
      const next = nextPending(p.idx);
      if (next === -1) {
        p.roundDone = true;
        const good = [...p.results.values()].filter(v => v === 'ok').length;
        p.feedback = { type: 'good', text: `🏁 Round complete: ${good} of ${p.queue.length} lines on the first try.` };
      } else {
        p.feedback = ok
          ? { type: 'good', text: '✓ Line complete, first try. Next line in a moment…' }
          : { type: 'warn', text: `Line complete with ${p.mistakes || 'a revealed'} ${p.mistakes > 1 ? 'mistakes' : p.mistakes ? 'mistake' : 'answer'}. Next line in a moment…` };
        p.timer = setTimeout(() => { if (practice === p) startLine(next); }, NEXT_LINE_DELAY);
      }
      bump();
      return;
    }
    if (!userToMove(p.cur)) {
      let child = node.children.find(c => p.target.startsWith(c.p));
      if (!child) { retarget(node.children[0].p); child = node.children.find(c => p.target.startsWith(c.p)); }
      p.timer = setTimeout(() => { if (practice === p && p.cur === node.p) jumpTo(child.p); }, OPPONENT_DELAY);
    } else if (p.keepFeedback) {
      p.keepFeedback = false; // keep the "wrong move" / "answer" message until the next move
    } else {
      const praise = p.feedback && p.feedback.type === 'good' ? '✓ Correct. ' : '';
      p.feedback = { type: 'info', text: praise + 'Your move: play it on the board.' };
    }
    bump();
  }

  // pick another line that runs through `path` (first one not done yet in this round)
  function retarget(path) {
    const p = practice;
    const under = p.queue.filter(l => l === path || l.startsWith(path));
    const pick = under.find(l => !p.results.has(l)) || under[0];
    if (pick) { p.target = pick; p.idx = p.queue.indexOf(pick); }
  }

  function showAnswer() {
    const p = practice;
    const node = nodeOf(p.cur);
    if (!node || !node.children.length || !userToMove(p.cur)) return;
    p.revealed = true;
    const ply = plyOf(p.cur) + 1;
    p.feedback = {
      type: 'warn',
      text: '👁 Answer: ' + node.children.map(c => moveText(c.san, ply)).join(' or '),
    };
    bump();
  }

  // ---------- practice panel ----------
  function renderPractice(box, data) {
    const p = practice;
    box.textContent = '';

    const bar = el('div', 'ldt-bar');
    const title = el('b', '', 'Practice · ' + (p.side === 'white' ? 'White' : 'Black') + (p.scope.path ? ' · ' + p.scope.name : ''));
    title.appendChild(el('span', 'ldt-ver', ' v' + VERSION));
    bar.appendChild(title);
    const grp = el('span', 'ldt-grp');
    const sel = el('select');
    for (const [k, v] of Object.entries(ORDERS)) {
      const o = el('option', '', v);
      o.value = k;
      if (k === p.order) o.selected = true;
      sel.appendChild(o);
    }
    sel.addEventListener('change', () => {
      p.order = sel.value;
      store.set(KEYS.order, sel.value);
      buildQueue();
      startLine(0);
    });
    grp.appendChild(sel);
    const lab = el('label');
    const cb = el('input');
    cb.type = 'checkbox';
    cb.checked = p.comments;
    cb.addEventListener('change', () => { p.comments = cb.checked; store.set(KEYS.comments, cb.checked ? '1' : '0'); bump(); });
    lab.append(cb, document.createTextNode('Comments'));
    grp.appendChild(lab);
    grp.appendChild(button(p.junk ? 'Exit (reloads page)' : 'Exit practice', exitPractice));
    bar.appendChild(grp);
    box.appendChild(bar);

    // progress
    const prog = el('div', 'ldt-prog');
    p.queue.forEach((leaf, i) => {
      const r = p.results.get(leaf);
      const seg = el('span', 'ldt-seg' + (r ? ' ' + r : i === p.idx && !p.roundDone ? ' cur' : ''));
      // details only for finished lines, so hovering doesn't give answers away
      const nm = r ? lineName(leaf) : '';
      seg.title = 'Line ' + (i + 1) + (nm ? ' · ' + nm : '') + (r ? ': ' + lineText(leaf) : '');
      seg.addEventListener('click', () => startLine(i));
      prog.appendChild(seg);
    });
    box.appendChild(prog);
    const name = lineName(p.target, p.cur);
    let label = `Line ${p.idx + 1} of ${p.queue.length}${name ? ' · ' + name : ''} · ${ORDERS[p.order]}`;
    if (p.order === 'sr') {
      const rec = srLoad();
      const now = Date.now();
      label += ` · due now: ${p.leaves.filter(l => !rec[l] || rec[l].due <= now).length}`;
    }
    box.appendChild(el('div', 'ldt-lbl', label));

    // the line played so far
    const line = el('div', 'ldt-line');
    const path = [];
    for (let k = 2; k <= p.cur.length; k += 2) path.push(p.snap.nodes.get(p.cur.slice(0, k)));
    path.filter(Boolean).forEach((m, i) => line.appendChild(moveEl(m, i === 0, p.snap.rootPly, null, undefined)));
    const node = nodeOf(p.cur);
    if (node && node.children.length && userToMove(p.cur) && !p.roundDone) {
      const ply = plyOf(p.cur) + 1;
      const num = Math.ceil(ply / 2);
      line.appendChild(el('span', 'ldt-q', (ply % 2 === 1 ? num + '.' : num + '...') + ' ?'));
    }
    if (!path.length && !(node && node.children.length && userToMove(p.cur))) {
      line.appendChild(el('span', 'ldt-lbl', 'Starting position'));
    }
    box.appendChild(line);
    if (p.comments && node && node.comments.length) box.appendChild(commentEl(node.comments, 'ldt-pcm'));

    // feedback
    if (p.resetStuck && p.expecting === '') {
      const fb = el('div', 'ldt-fb warn', 'The board didn\'t go back to the start. Click ⏮ under the board (or press Home) and practice continues.');
      fb.appendChild(button('Retry', () => { p.resetStuck = false; jumpTo(''); bump(); }));
      box.appendChild(fb);
    } else if (p.browsing) {
      const fb = el('div', 'ldt-fb warn', 'You\'re looking at another position.');
      fb.appendChild(button('Continue practice', () => { p.browsing = false; jumpTo(p.cur); bump(); }));
      box.appendChild(fb);
    } else if (p.feedback) {
      box.appendChild(el('div', 'ldt-fb ' + p.feedback.type, p.feedback.text));
    }

    // buttons
    const btns = el('div', 'ldt-btns');
    btns.appendChild(button('◀ Previous line', () => startLine(p.idx - 1)));
    if (node && !node.children.length) btns.appendChild(button('↺ Repeat line', () => startLine(p.idx)));
    else btns.appendChild(button('👁 Show answer', showAnswer));
    btns.appendChild(button(p.showTree ? '🌳 Hide tree' : '🌳 Show tree', () => { p.showTree = !p.showTree; bump(); }));
    if (p.roundDone) btns.appendChild(button('↻ New round', () => { buildQueue(); startLine(0); }));
    else btns.appendChild(button('Next line ▶', () => startLine(p.idx + 1 >= p.queue.length ? 0 : p.idx + 1)));
    box.appendChild(btns);

    if (p.showTree) {
      const t = treeEl(p.snap, data.active);
      t.classList.add('ldt-ptree');
      box.appendChild(t);
    }
  }

  // the most specific name along the line (e.g. "Scotch game" → "Scotch, 4...Qh4 line")
  function lineName(leaf, upTo) {
    let name = '';
    const end = upTo === undefined ? leaf.length : Math.min(leaf.length, upTo.length);
    for (let k = 2; k <= end; k += 2) {
      const n = practice.snap.nodes.get(leaf.slice(0, k));
      if (n && n.label) name = n.label;
    }
    return name;
  }

  function lineText(leaf) {
    const parts = [];
    for (let k = 2; k <= leaf.length; k += 2) {
      const n = practice.snap.nodes.get(leaf.slice(0, k));
      if (n) parts.push(moveText(n.san, plyOf(n.p)));
    }
    return parts.slice(-4).join(' ');
  }

  function moveText(san, ply) {
    const num = Math.ceil(ply / 2);
    return (ply % 2 === 1 ? num + '.' : num + '...') + san;
  }

  // ---------- driving Lichess ----------
  function jumpTo(path) {
    if (!practice) return;
    practice.expecting = path;
    if (path === '') {
      const p = practice;
      const atStart = () => {
        const tview = document.querySelector('.analyse__moves .tview2');
        return tview && !tview.querySelector('move.active');
      };
      if (atStart()) return; // nothing to do, the next update sees we are there
      // 1) the Home key, sent from <body> (Lichess's shortcut handler inspects the element the key came from)
      const ae = document.activeElement;
      const keyTarget = ae && ae !== document.body && ae.hasAttribute &&
        !/^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName) ? ae : document.body;
      for (const type of ['keydown', 'keyup']) {
        keyTarget.dispatchEvent(new KeyboardEvent(type, { key: 'Home', code: 'Home', bubbles: true, cancelable: true }));
      }
      // 2) Lichess's "first move" button, if the board hasn't moved yet
      setTimeout(() => {
        if (practice !== p || p.expecting !== '' || atStart()) return;
        const first = document.querySelector('.analyse__controls [data-act="first"]');
        if (first) {
          const opts = { bubbles: true, cancelable: true, button: 0, pointerId: 1, pointerType: 'mouse', isPrimary: true };
          first.dispatchEvent(new PointerEvent('pointerdown', opts));
          first.dispatchEvent(new PointerEvent('pointerup', opts));
        }
      }, 400);
      // 3) still not there: ask the user (practice continues as soon as the board is at the start)
      setTimeout(() => {
        if (practice !== p || p.expecting !== '' || atStart()) return;
        console.warn('[decision tree] could not return the board to the start automatically');
        p.resetStuck = true;
        bump();
      }, RESET_TIMEOUT);
      return;
    }
    const target = [...document.querySelectorAll('.analyse__moves .tview2 move[p]')]
      .find(m => m.getAttribute('p') === path);
    if (!target) { practice.expecting = null; return; }
    target.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, button: 0, pointerType: 'mouse' }));
  }

  function recButton() {
    return document.querySelector('.study__buttons a.mode.write') || document.querySelector('a.mode.write');
  }
  function studyKey() {
    const m = location.pathname.match(/^\/study\/([^/]+)/);
    return m ? m[1] : '';
  }
  function switchRecOff() {
    const rec = recButton();
    if (rec && rec.classList.contains('on')) {
      rec.click();
      practice.recRestore = true;
      store.set(KEYS.recRestore, studyKey());
    }
  }
  // if the page was reloaded during practice, switch REC back on
  function restoreRecIfPending() {
    const pending = store.get(KEYS.recRestore, '');
    if (!pending || pending !== studyKey()) return;
    const rec = recButton();
    if (!rec) return;
    if (!rec.classList.contains('on')) rec.click();
    store.del(KEYS.recRestore);
  }

  // ---------- spaced repetition ----------
  function srKey() { return KEYS.sr + location.pathname; }
  function srLoad() {
    try { return JSON.parse(store.get(srKey(), '{}')) || {}; } catch (e) { return {}; }
  }
  function srRecord(leaf, ok) {
    const rec = srLoad();
    const r = rec[leaf] || { box: 0, due: 0 };
    r.box = ok ? Math.min(r.box + 1, SR_INTERVALS_MIN.length - 1) : 0;
    r.due = Date.now() + SR_INTERVALS_MIN[r.box] * 60000;
    rec[leaf] = r;
    store.set(srKey(), JSON.stringify(rec));
  }

  // ---------- helpers ----------
  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }
  function button(text, onClick) {
    const b = el('button', '', text);
    b.type = 'button';
    b.addEventListener('click', onClick);
    return b;
  }
})();
