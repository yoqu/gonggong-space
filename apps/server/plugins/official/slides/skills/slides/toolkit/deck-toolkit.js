/* deck-toolkit.js — shared presenting tools for every slides template.
 *
 * Keys: ? help · O overview · S presenter window · L laser · D pen (C clears) ·
 *       B / W black / white screen · digits + Enter jump · Esc closes.
 *
 * Contract with the deck kernel (all optional):
 *   window.deck = { slides: Element[], index: number, go(i) }   // 0-based
 * Without it the toolkit finds slides by [data-section] (or .slide), reads the
 * visible one, and steps there with ArrowLeft/ArrowRight key events.
 * #N in the URL (or #/N) opens slide N. ?gg-slide=N renders slide N alone
 * (used for overview and presenter thumbnails).
 */
(function () {
  'use strict';
  if (window.__deckToolkit) return;
  window.__deckToolkit = true;

  var params = new URLSearchParams(location.search);
  var thumbAt = parseInt(params.get('gg-slide') || '', 10);
  var isThumb = thumbAt > 0;
  function ready(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(fn, 0); });
    else setTimeout(fn, 0);
  }

  /* ---------- deck adapter ---------- */
  function topLevel(list) {
    return list.filter(function (el) {
      return !list.some(function (o) { return o !== el && o.contains(el); });
    });
  }
  function stageEl() { return document.querySelector('deck-stage'); }
  function slides() {
    if (window.deck && window.deck.slides) return Array.from(window.deck.slides);
    var st = stageEl();
    if (st && st._slides) return Array.from(st._slides);
    var s = Array.from(document.querySelectorAll('[data-section]'));
    if (s.length < 2) s = Array.from(document.querySelectorAll('.slide'));
    return topLevel(s);
  }
  function visibleIndex(list) {
    var vw = innerWidth, vh = innerHeight, best = -1, bestScore = 0;
    list.forEach(function (el, i) {
      var r = el.getBoundingClientRect();
      var w = Math.max(0, Math.min(r.right, vw) - Math.max(r.left, 0));
      var h = Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 0));
      if (!w || !h) return;
      var cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') return;
      var score = (w * h) / (vw * vh) * parseFloat(cs.opacity || '1');
      if (/\b(is-)?(active|current|present)\b/.test(el.className)) score += 0.01;
      if (score >= bestScore) { best = i; bestScore = score; }
    });
    if (best < 0) best = list.findIndex(function (el) { return /\b(is-)?(active|current|present)\b/.test(el.className); });
    return best < 0 ? 0 : best;
  }
  function index() {
    if (window.deck && typeof window.deck.index === 'number') return window.deck.index;
    var st = stageEl();
    if (st && typeof st.index === 'number') return st.index;
    return visibleIndex(slides());
  }
  var synthetic = false;
  function press(key) {
    synthetic = true;
    try {
      var ev = { key: key, code: key, bubbles: true, cancelable: true };
      (document.activeElement || document.body).dispatchEvent(new KeyboardEvent('keydown', ev));
      (document.activeElement || document.body).dispatchEvent(new KeyboardEvent('keyup', ev));
    } finally { synthetic = false; }
  }
  var stepping = 0;
  function go(n) {
    var total = slides().length;
    n = Math.max(0, Math.min(total - 1, n));
    if (window.deck && typeof window.deck.go === 'function') return window.deck.go(n);
    var st = stageEl();
    if (st && typeof st.goTo === 'function') return st.goTo(n);
    var run = stepping = (stepping || 0) + 1, tries = 0;
    (function step() {
      if (run !== stepping) return;
      var cur = index();
      if (cur === n || tries++ > total * 4) { stepping = 0; return; }
      press(cur < n ? 'ArrowRight' : 'ArrowLeft');
      var start = Date.now();
      (function wait() {
        if (run !== stepping) return;
        if (index() !== cur || Date.now() - start > 900) return step();
        setTimeout(wait, 40);
      })();
    })();
  }
  function notesOf(i) {
    var el = slides()[i];
    var n = el && el.querySelector('.notes, aside.notes, .speaker-notes, [data-notes]');
    if (n) return n.getAttribute('data-notes') || n.innerHTML;
    var tag = document.getElementById('speaker-notes');
    if (tag) {
      try {
        var arr = JSON.parse(tag.textContent || '[]');
        if (arr[i]) return String(arr[i]).replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; });
      } catch (_) {}
    }
    return '';
  }
  function titleOf(i) {
    var el = slides()[i];
    if (!el) return '';
    var t = el.getAttribute('data-title') || (el.querySelector('h1,h2,h3') || {}).textContent || '';
    return t.replace(/\s+/g, ' ').trim().slice(0, 60);
  }
  function thumbUrl(i) {
    var u = new URL(location.href);
    u.hash = '';
    u.searchParams.set('gg-slide', String(i + 1));
    return u.href;
  }

  /* ---------- thumbnail mode ---------- */
  if (isThumb) {
    var still = document.createElement('style');
    still.textContent = '*,*::before,*::after{transition-duration:0s!important;transition-delay:0s!important;animation-duration:0s!important;animation-delay:0s!important;scroll-behavior:auto!important}' +
      '.notes,aside.notes,.speaker-notes{display:none!important}html,body{cursor:default!important}';
    (document.head || document.documentElement).appendChild(still);
    // Thumbnails are extra copies of the deck: keep them from syncing with the real one.
    window.BroadcastChannel = function () { return { postMessage: function () {}, close: function () {}, addEventListener: function () {} }; };
    try { Storage.prototype.setItem = function () {}; } catch (_) {}
    window.focus = HTMLElement.prototype.focus = function () {};
    var target = thumbAt - 1;
    var until = Date.now() + 8000;
    ready(function settle() {
      if (index() !== target && !stepping) go(target);
      if (Date.now() < until) setTimeout(settle, 250);
    });
    addEventListener('message', function (e) {
      if (e.data && typeof e.data.ggGo === 'number') { target = e.data.ggGo; go(target); }
    });
    addEventListener('keydown', function (e) { if (!synthetic) { e.stopImmediatePropagation(); e.preventDefault(); } }, true);
    window.deckToolkit = { go: go, index: index, slides: slides };
    return;
  }

  /* ---------- UI ---------- */
  var css = [
    '.ggt{all:initial;font:14px/1.5 -apple-system,BlinkMacSystemFont,"PingFang SC","Noto Sans SC","Microsoft YaHei",sans-serif;color:#f5f5f5}',
    '.ggt *{box-sizing:border-box}',
    '.ggt-layer{position:fixed;inset:0;z-index:2147483600}',
    '.ggt-help{display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.55)}',
    '.ggt-card{background:#1c1c1e;border-radius:14px;padding:22px 26px;min-width:360px;box-shadow:0 20px 60px rgba(0,0,0,.5)}',
    '.ggt-card h3{margin:0 0 12px;font-size:16px;font-weight:600}',
    '.ggt-row{display:flex;justify-content:space-between;gap:28px;padding:5px 0;border-top:1px solid rgba(255,255,255,.08)}',
    '.ggt kbd{font:12px/1 ui-monospace,Menlo,monospace;background:#3a3a3c;border-radius:5px;padding:4px 7px;margin-left:4px;color:#fff}',
    '.ggt-ov{background:rgba(12,12,14,.97);backdrop-filter:blur(8px);overflow:auto;padding:28px 32px}',
    '.ggt-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:18px}',
    '.ggt-tile{cursor:pointer;border-radius:8px;outline:2px solid rgba(255,255,255,.12);overflow:hidden;background:#000}',
    '.ggt-tile:hover{outline-color:rgba(255,255,255,.5)}.ggt-tile.on{outline:3px solid #0a84ff}',
    '.ggt-frame{position:relative;width:100%;overflow:hidden}',
    '.ggt-frame iframe{position:absolute;left:0;top:0;border:0;transform-origin:0 0;pointer-events:none;background:#fff}',
    '.ggt-cap{display:flex;gap:8px;padding:6px 10px;font-size:12px;color:#c7c7cc;background:#1c1c1e;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.ggt-screen{cursor:none}.ggt-black{background:#000}.ggt-white{background:#fff}',
    '.ggt-ink{pointer-events:none}.ggt-ink.on{pointer-events:auto;cursor:crosshair}',
    '.ggt-laser{position:fixed;width:18px;height:18px;margin:-9px 0 0 -9px;border-radius:50%;pointer-events:none;z-index:2147483646;',
    'background:radial-gradient(circle,#fff 0 18%,#ff2d2d 35%,rgba(255,45,45,.35) 60%,transparent 72%);box-shadow:0 0 14px 4px rgba(255,40,40,.55)}',
    'html.ggt-nocursor,html.ggt-nocursor *{cursor:none!important}',
    '.ggt-badge{position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:2147483647;background:rgba(28,28,30,.92);',
    'border-radius:10px;padding:8px 14px;box-shadow:0 8px 30px rgba(0,0,0,.35)}',
    '.ggt-bar{position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:2147483646;display:flex;gap:8px;align-items:center;flex-wrap:wrap;max-width:calc(100vw - 24px);',
    'background:rgba(28,28,30,.94);border-radius:12px;padding:8px 10px 8px 14px;box-shadow:0 10px 36px rgba(0,0,0,.35)}',
    '.ggt-bar button{all:unset;cursor:pointer;background:#3a3a3c;color:#fff;border-radius:7px;padding:5px 11px;font-size:13px}.ggt-bar button:hover{background:#48484a}',
    '.ggt-bar .pri{background:#0a84ff}.ggt-bar .pri:hover{background:#2491ff}',
    '.ggt-bar input{all:unset;background:#fff;color:#111;border-radius:6px;padding:4px 8px;width:140px;font-size:13px}',
    '.ggt-bar input[type=color]{all:revert;width:34px;height:24px;padding:0;border:0;background:none;vertical-align:middle}',
    '.ggt-bar .msg{color:#c7c7cc;font-size:12px}.ggt-panel{display:flex;gap:8px;align-items:center;flex-wrap:wrap;width:100%;border-top:1px solid rgba(255,255,255,.1);padding-top:8px}',
    '.ggt-panel label{display:flex;gap:4px;align-items:center;font:12px ui-monospace,Menlo,monospace;color:#e5e5ea}',
    'html.ggt-editing [data-ggt-p=slide] *:hover{outline:1px dashed rgba(10,132,255,.7);outline-offset:2px;cursor:text}',
    '[data-ggt-edit]{outline:2px solid #0a84ff!important;outline-offset:2px}',
    // Print: every slide on its own 1920×1080 page, whatever the template's paging model (see markPrint).
    '@media print{@page{size:1920px 1080px;margin:0}*{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}',
    'html,body{width:1920px!important;height:auto!important;min-height:0!important;overflow:visible!important;transform:none!important}body{display:block!important}',
    '[data-ggt-p=path]{display:block!important;position:static!important;transform:none!important;width:auto!important;height:auto!important;min-height:0!important;max-height:none!important;overflow:visible!important;margin:0!important;padding:0!important}',
    '[data-ggt-p=hide],.ggt,.ggt-laser,.ggt-ink{display:none!important}',
    '[data-ggt-p=slide]{display:var(--ggt-print-display,block)!important;position:relative!important;inset:auto!important;transform:none!important;opacity:1!important;visibility:visible!important;width:1920px!important;height:1080px!important;min-height:0!important;max-height:none!important;margin:0!important;overflow:hidden!important;box-sizing:border-box!important;break-inside:avoid;break-after:auto!important}',
    '[data-ggt-p=slide]~[data-ggt-p=slide]{break-before:page}',
    '[data-ggt-p=slide] *{animation-duration:0s!important;animation-delay:0s!important;transition:none!important}',
    '.notes,aside.notes,.speaker-notes{display:none!important}}'
  ].join('\n');
  var style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }
  var open = null;
  function closeAll() {
    if (open) { open.remove(); open = null; }
  }

  var KEYS = [
    ['翻页', ['←', '→']], ['跳到第 N 页', ['数字', 'Enter']], ['总览', ['O']], ['演讲者窗口', ['S']],
    ['激光笔', ['L']], ['画笔（C 清除本页）', ['D']], ['黑屏 / 白屏', ['B', 'W']], ['编辑文字、替换、主题色', ['E']], ['关闭 / 退出', ['Esc']], ['快捷键', ['?']]
  ];
  function help() {
    var card = el('div', 'ggt-card');
    card.appendChild(el('h3', null, '放映快捷键'));
    KEYS.forEach(function (k) {
      card.appendChild(el('div', 'ggt-row', '<span>' + k[0] + '</span><span>' + k[1].map(function (x) { return '<kbd>' + x + '</kbd>'; }).join('') + '</span>'));
    });
    var layer = el('div', 'ggt ggt-layer ggt-help');
    layer.setAttribute('data-ggt', 'help');
    layer.appendChild(card);
    layer.addEventListener('click', closeAll);
    show(layer);
  }
  // Clicks on toolkit layers must not reach templates that page on any click.
  function quiet(node) {
    if (node._quiet) return;
    node._quiet = true;
    node.addEventListener('click', function (e) { e.stopPropagation(); });
  }
  function show(layer) { closeAll(); open = layer; quiet(layer); document.body.appendChild(layer); }

  function frame(i, width) {
    var f = el('div', 'ggt-frame');
    var vw = innerWidth, vh = innerHeight;
    f.style.paddingTop = (vh / vw * 100) + '%';
    var ifr = document.createElement('iframe');
    ifr.loading = 'lazy';
    ifr.tabIndex = -1;
    ifr.src = thumbUrl(i);
    ifr.style.width = vw + 'px';
    ifr.style.height = vh + 'px';
    f.appendChild(ifr);
    var fit = function () { ifr.style.transform = 'scale(' + (f.clientWidth / vw) + ')'; };
    requestAnimationFrame(fit);
    f._fit = fit;
    return f;
  }
  var ovCache = null;
  function overview() {
    var cur = index();
    var list = slides();
    if (!ovCache || ovCache.count !== list.length || ovCache.w !== innerWidth || ovCache.h !== innerHeight) {
      var layer = el('div', 'ggt ggt-layer ggt-ov');
      layer.setAttribute('data-ggt', 'overview');
      var grid = el('div', 'ggt-grid');
      list.forEach(function (_, i) {
        var tile = el('div', 'ggt-tile');
        tile.appendChild(frame(i));
        tile.appendChild(el('div', 'ggt-cap'));
        tile.querySelector('.ggt-cap').textContent = (i + 1) + '  ' + titleOf(i);
        tile.addEventListener('click', function () { closeAll(); go(i); });
        grid.appendChild(tile);
      });
      layer.appendChild(grid);
      ovCache = { layer: layer, count: list.length, w: innerWidth, h: innerHeight };
    }
    show(ovCache.layer);
    var tiles = ovCache.layer.querySelectorAll('.ggt-tile');
    tiles.forEach(function (t, i) {
      t.classList.toggle('on', i === cur);
      t.querySelector('.ggt-frame')._fit();
    });
    if (tiles[cur]) tiles[cur].scrollIntoView({ block: 'center' });
  }

  function screen(color) {
    var layer = el('div', 'ggt ggt-layer ggt-screen ggt-' + color);
    layer.setAttribute('data-ggt', color);
    layer.addEventListener('click', closeAll);
    show(layer);
  }

  /* laser */
  var laser = null;
  function moveLaser(e) { if (laser) { laser.style.left = e.clientX + 'px'; laser.style.top = e.clientY + 'px'; } }
  function toggleLaser(on) {
    if (on === undefined) on = !laser;
    if (on && !laser) {
      laser = el('div', 'ggt-laser');
      laser.setAttribute('data-ggt', 'laser');
      laser.style.left = '-50px';
      document.body.appendChild(laser);
      document.documentElement.classList.add('ggt-nocursor');
      addEventListener('mousemove', moveLaser, true);
    } else if (!on && laser) {
      laser.remove();
      laser = null;
      document.documentElement.classList.remove('ggt-nocursor');
      removeEventListener('mousemove', moveLaser, true);
    }
  }

  /* pen: strokes kept per slide in viewport-relative coordinates */
  var ink = null, inkCtx = null, strokes = {}, drawing = null, inkOn = false;
  function ensureInk() {
    if (ink) return;
    ink = el('canvas', 'ggt-ink ggt-layer');
    ink.setAttribute('data-ggt', 'ink');
    quiet(ink);
    document.body.appendChild(ink);
    inkCtx = ink.getContext && ink.getContext('2d');
    sizeInk();
    addEventListener('resize', sizeInk);
    ink.addEventListener('pointerdown', function (e) {
      drawing = [[e.clientX / innerWidth, e.clientY / innerHeight]];
      (strokes[index()] = strokes[index()] || []).push(drawing);
      ink.setPointerCapture && ink.setPointerCapture(e.pointerId);
    });
    ink.addEventListener('pointermove', function (e) {
      if (!drawing) return;
      drawing.push([e.clientX / innerWidth, e.clientY / innerHeight]);
      paint();
    });
    var end = function () { drawing = null; };
    ink.addEventListener('pointerup', end);
    ink.addEventListener('pointercancel', end);
  }
  function sizeInk() {
    var dpr = devicePixelRatio || 1;
    ink.width = innerWidth * dpr;
    ink.height = innerHeight * dpr;
    ink.style.width = innerWidth + 'px';
    ink.style.height = innerHeight + 'px';
    if (inkCtx) inkCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    paint();
  }
  function paint() {
    if (!inkCtx) return;
    inkCtx.clearRect(0, 0, innerWidth, innerHeight);
    inkCtx.strokeStyle = '#ff2d55';
    inkCtx.lineWidth = 4;
    inkCtx.lineCap = inkCtx.lineJoin = 'round';
    (strokes[index()] || []).forEach(function (s) {
      inkCtx.beginPath();
      s.forEach(function (p, i) { inkCtx[i ? 'lineTo' : 'moveTo'](p[0] * innerWidth, p[1] * innerHeight); });
      inkCtx.stroke();
    });
  }
  function togglePen(on) {
    ensureInk();
    inkOn = on === undefined ? !inkOn : on;
    ink.classList.toggle('on', inkOn);
    if (inkOn) toggleLaser(false);
  }

  /* edit (E): click text to change it, replace across slides, theme colours, save a copy */
  var editing = false, bar = null, edits = [], colors = {};
  function textNodes(root) {
    var w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null), out = [];
    while (w.nextNode()) {
      var n = w.currentNode, p = n.parentElement;
      if (n.nodeValue.trim() && p && !p.closest('script,style,.notes,.speaker-notes,[data-ggt]')) out.push(n);
    }
    return out;
  }
  function slideOf(node) {
    var list = slides();
    for (var i = 0; i < list.length; i++) if (list[i].contains(node)) return i;
    return -1;
  }
  function say(t) { if (bar) bar.querySelector('.msg').textContent = t; }
  function startEdit(el, at) {
    var before = textNodes(el).map(function (n) { return n.nodeValue; });
    var whole = el.textContent;
    el.setAttribute('data-ggt-edit', '');
    el.setAttribute('contenteditable', 'true');
    el.focus({ preventScroll: true });
    var done = function () {
      el.removeEventListener('blur', done);
      el.removeEventListener('keydown', keys);
      el.removeAttribute('contenteditable');
      el.removeAttribute('data-ggt-edit');
      var after = textNodes(el);
      if (after.length === before.length) {
        after.forEach(function (n, i) { if (n.nodeValue !== before[i]) edits.push({ slide: at, from: before[i], to: n.nodeValue }); });
      } else if (el.textContent !== whole) edits.push({ slide: at, from: whole, to: el.textContent, whole: true });
      say(edits.length ? '已改 ' + edits.length + ' 处，记得「保存副本」' : '点页面上的文字直接改');
    };
    var keys = function (e) {
      if (e.key === 'Escape' || (e.key === 'Enter' && !e.shiftKey)) { e.preventDefault(); el.blur(); }
      e.stopPropagation();
    };
    el.addEventListener('blur', done);
    el.addEventListener('keydown', keys);
  }
  function editClick(e) {
    if (!editing || e.target.closest && e.target.closest('[data-ggt]')) return;
    var at = slideOf(e.target);
    if (at < 0) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.type !== 'click') return;
    var el = e.target;
    var own = Array.prototype.some.call(el.childNodes, function (n) { return n.nodeType === 3 && n.nodeValue.trim(); });
    if (own && !el.isContentEditable) startEdit(el, at);
  }
  ['click', 'mousedown', 'pointerdown', 'touchstart'].forEach(function (t) { document.addEventListener(t, editClick, true); });

  function themeVars() {
    var roots = [document.documentElement, document.body], out = {};
    Array.prototype.forEach.call(document.styleSheets, function (sh) {
      var rules;
      try { rules = sh.cssRules; } catch (_) { return; }
      Array.prototype.forEach.call(rules || [], function (r) {
        if (!r.style || !r.selectorText) return;
        var hit = roots.some(function (el) { try { return el && el.matches(r.selectorText); } catch (_) { return false; } });
        if (!hit) return;
        for (var i = 0; i < r.style.length; i++) {
          var name = r.style[i];
          if (name.indexOf('--') === 0 && /^\s*(#[0-9a-f]{3,8}|rgba?\(|hsla?\()/i.test(r.style.getPropertyValue(name))) out[name] = 1;
        }
      });
    });
    return Object.keys(out);
  }
  function hex(v) {
    var c = document.createElement('canvas').getContext('2d');
    if (!c) return '#000000';
    c.fillStyle = '#000';
    c.fillStyle = v;
    var x = c.fillStyle;
    if (x[0] === '#') return x;
    var m = /(\d+),\s*(\d+),\s*(\d+)/.exec(x);
    return m ? '#' + [m[1], m[2], m[3]].map(function (d) { return ('0' + (+d).toString(16)).slice(-2); }).join('') : '#000000';
  }
  function setColor(name, v) {
    colors[name] = v;
    document.documentElement.style.setProperty(name, v);
    document.body.style.setProperty(name, v);
  }
  function panel(html) {
    var old = bar.querySelector('.ggt-panel');
    if (old) old.remove();
    if (html == null) return null;
    var p = el('div', 'ggt-panel', html);
    bar.appendChild(p);
    return p;
  }
  function replacePanel() {
    var p = panel('<input class="q" placeholder="查找"><input class="r" placeholder="替换为"><button class="pri go">全部替换</button>');
    var q = p.querySelector('.q');
    q.focus();
    p.querySelector('.go').onclick = function () {
      var from = q.value, to = p.querySelector('.r').value, n = 0;
      if (!from) return;
      slides().forEach(function (sl) {
        textNodes(sl).forEach(function (t) {
          var parts = t.nodeValue.split(from);
          if (parts.length > 1) { n += parts.length - 1; t.nodeValue = parts.join(to); }
        });
      });
      if (n) edits.push({ all: true, from: from, to: to });
      say(n ? '替换了 ' + n + ' 处' : '没找到「' + from + '」');
    };
  }
  function themePanel() {
    var names = themeVars();
    if (!names.length) { panel(null); say('这套模板没有可调的颜色变量'); return; }
    var p = panel('');
    var cs = getComputedStyle(document.body);
    names.forEach(function (name) {
      var l = el('label');
      l.textContent = name.slice(2);
      var input = document.createElement('input');
      input.type = 'color';
      input.value = hex(colors[name] || cs.getPropertyValue(name).trim());
      input.oninput = function () { setColor(name, input.value); };
      l.appendChild(input);
      p.appendChild(l);
    });
  }
  function docSlides(doc) {
    var s = Array.from(doc.querySelectorAll('[data-section]'));
    if (s.length < 2) s = Array.from(doc.querySelectorAll('.slide'));
    return topLevel(s);
  }
  function applyEdits(doc) {
    var list = docSlides(doc), missed = 0;
    edits.forEach(function (ed) {
      var scope = ed.all ? list : [list[ed.slide]];
      scope.forEach(function (sl) {
        if (!sl) { missed++; return; }
        if (ed.all) {
          textNodes(sl).forEach(function (t) { t.nodeValue = t.nodeValue.split(ed.from).join(ed.to); });
        } else if (ed.whole) {
          var hit = Array.from(sl.querySelectorAll('*')).reverse().find(function (e) { return e.textContent === ed.from; });
          if (hit) hit.textContent = ed.to; else missed++;
        } else {
          var t = textNodes(sl).find(function (n) { return n.nodeValue === ed.from; }) ||
            textNodes(sl).find(function (n) { return n.nodeValue.trim() === ed.from.trim(); });
          if (t) t.nodeValue = ed.to; else missed++;
        }
      });
    });
    var names = Object.keys(colors);
    var old = doc.getElementById('ggt-theme');
    if (old) old.remove();
    if (names.length) {
      var st = doc.createElement('style');
      st.id = 'ggt-theme';
      st.textContent = 'html,body{' + names.map(function (n) { return n + ':' + colors[n] + '!important'; }).join(';') + '}';
      doc.head.appendChild(st);
    }
    return missed;
  }
  function download(html) {
    var a = document.createElement('a');
    var name = (decodeURIComponent(location.pathname.split('/').pop() || 'index.html')).replace(/\.html?$/i, '');
    a.download = name + '-edited.html';
    a.href = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }
  function save() {
    var url = location.href.split('#')[0];
    fetch(url).then(function (r) { if (!r.ok) throw new Error(); return r.text(); }).then(function (src) {
      var doc = new DOMParser().parseFromString(src, 'text/html');
      var missed = applyEdits(doc);
      download('<!doctype html>\n' + doc.documentElement.outerHTML);
      say(missed ? '已保存副本；' + missed + ' 处改动没对上原文件，请检查' : '已保存副本（放回原文件夹替换 index.html 即可）');
    }).catch(function () {
      say('读不到原文件（本地直接打开时浏览器不允许），请在预览链接里保存');
    });
  }
  function toggleEdit(on) {
    editing = on === undefined ? !editing : on;
    document.documentElement.classList.toggle('ggt-editing', editing);
    if (!editing) {
      var cur = document.querySelector('[data-ggt-edit]');
      if (cur) cur.blur();
      if (bar) bar.remove();
      bar = null;
      return;
    }
    markPrint();
    toggleLaser(false);
    if (ink) togglePen(false);
    bar = el('div', 'ggt ggt-bar', '<span class="msg">点页面上的文字直接改</span><button class="rep">替换</button><button class="theme">主题色</button><button class="pri save">保存副本</button><button class="exit">退出编辑</button>');
    bar.setAttribute('data-ggt', 'edit');
    bar.querySelector('.rep').onclick = replacePanel;
    bar.querySelector('.theme').onclick = themePanel;
    bar.querySelector('.save').onclick = save;
    bar.querySelector('.exit').onclick = function () { toggleEdit(false); };
    quiet(bar);
    document.body.appendChild(bar);
  }

  /* jump: digits then Enter */
  var jump = '', jumpBadge = null, jumpTimer = 0;
  function setJump(v) {
    jump = v;
    clearTimeout(jumpTimer);
    if (!jump) { if (jumpBadge) jumpBadge.remove(); jumpBadge = null; return; }
    if (!jumpBadge) {
      jumpBadge = el('div', 'ggt ggt-badge');
      jumpBadge.setAttribute('data-ggt', 'jump');
      document.body.appendChild(jumpBadge);
    }
    jumpBadge.innerHTML = '跳到第 <b>' + jump + '</b> 页 <kbd>Enter</kbd>';
    jumpTimer = setTimeout(function () { setJump(''); }, 3000);
  }

  /* presenter window */
  var presenter = null, started = Date.now();
  function presenterHtml() {
    return '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>演讲者视图</title><style>' +
      'body{margin:0;background:#111;color:#eee;font:15px/1.6 -apple-system,"PingFang SC","Noto Sans SC",sans-serif;display:grid;grid-template-columns:62% 1fr;grid-template-rows:auto 1fr auto;gap:14px;padding:14px;height:100vh;box-sizing:border-box}' +
      '.lbl{font-size:12px;color:#8e8e93;margin-bottom:6px}.box{min-height:0;display:flex;flex-direction:column}' +
      '.f{position:relative;width:100%;overflow:hidden;background:#000;border-radius:8px}.f iframe{position:absolute;left:0;top:0;border:0;transform-origin:0 0;pointer-events:none}' +
      '#cur{grid-row:1/3}#notes{overflow:auto;background:#1c1c1e;border-radius:8px;padding:12px 16px;font-size:18px;flex:1}' +
      'footer{grid-column:1/3;display:flex;gap:18px;align-items:center;font-size:20px}footer button{font:inherit;font-size:15px;background:#2c2c2e;color:#eee;border:0;border-radius:6px;padding:6px 14px;cursor:pointer}' +
      '#clock{font-variant-numeric:tabular-nums;font-weight:600}</style></head><body>' +
      '<div class="box" id="cur"><div class="lbl">当前</div><div class="f"><iframe></iframe></div></div>' +
      '<div class="box"><div class="lbl">下一页</div><div class="f" id="nxt"><iframe></iframe></div></div>' +
      '<div class="box"><div class="lbl">演讲者备注</div><div id="notes"></div></div>' +
      '<footer><span id="page"></span><span id="clock">00:00</span><button id="reset">重置计时</button><button id="prev">← 上一页</button><button id="next">下一页 →</button></footer>' +
      '</body></html>';
  }
  function openPresenter() {
    if (presenter && !presenter.closed) { presenter.focus(); return; }
    presenter = window.open('', 'gg-deck-presenter', 'width=1280,height=800');
    if (!presenter) return;
    var d = presenter.document;
    d.open(); d.write(presenterHtml()); d.close();
    var vw = innerWidth, vh = innerHeight;
    var frames = d.querySelectorAll('.f');
    var cur = index();
    frames.forEach(function (f, k) {
      f.style.paddingTop = (vh / vw * 100) + '%';
      var ifr = f.querySelector('iframe');
      ifr.style.width = vw + 'px';
      ifr.style.height = vh + 'px';
      ifr.src = thumbUrl(Math.min(cur + k, slides().length - 1));
    });
    var fit = function () {
      frames.forEach(function (f) { f.querySelector('iframe').style.transform = 'scale(' + (f.clientWidth / vw) + ')'; });
    };
    presenter.addEventListener('resize', fit);
    setTimeout(fit, 0);
    d.getElementById('reset').onclick = function () { started = Date.now(); };
    d.getElementById('prev').onclick = function () { go(index() - 1); };
    d.getElementById('next').onclick = function () { go(index() + 1); };
    presenter.addEventListener('keydown', function (e) {
      var k = e.key;
      if (k === 'ArrowRight' || k === 'PageDown' || k === ' ') { e.preventDefault(); go(index() + 1); }
      else if (k === 'ArrowLeft' || k === 'PageUp') { e.preventDefault(); go(index() - 1); }
      else if (k === 'Escape') presenter.close();
    });
    // A backgrounded audience tab gets its timers throttled; the presenter window keeps the sync going.
    presenter.setInterval(watch, 200);
    presenter.setInterval(tick, 1000);
    last = -1;
    watch();
  }
  function syncPresenter(i) {
    if (!presenter || presenter.closed) return;
    var d = presenter.document, total = slides().length;
    var ifr = d.querySelectorAll('.f iframe');
    [i, Math.min(i + 1, total - 1)].forEach(function (n, k) {
      if (ifr[k] && ifr[k].contentWindow) ifr[k].contentWindow.postMessage({ ggGo: n }, '*');
    });
    d.getElementById('nxt').style.opacity = i + 1 < total ? '1' : '.25';
    d.getElementById('page').textContent = (i + 1) + ' / ' + total;
    d.getElementById('notes').innerHTML = notesOf(i) || '<span style="color:#636366">（本页没有备注）</span>';
  }
  function tick() {
    if (!presenter || presenter.closed) return;
    var s = Math.floor((Date.now() - started) / 1000);
    var c = presenter.document.getElementById('clock');
    if (c) c.textContent = String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
  }

  /* print: tag the slides, the elements around them, and the chrome to hide */
  function markPrint() {
    var list = slides();
    if (!list.length) return;
    Array.prototype.forEach.call(document.querySelectorAll('[data-ggt-p]'), function (e) { e.removeAttribute('data-ggt-p'); });
    var path = [];
    list.forEach(function (sl) {
      sl.setAttribute('data-ggt-p', 'slide');
      for (var a = sl.parentElement; a && a !== document.documentElement; a = a.parentElement) if (path.indexOf(a) < 0) path.push(a);
    });
    path.forEach(function (a) {
      if (a !== document.body) a.setAttribute('data-ggt-p', 'path');
      Array.prototype.forEach.call(a.children, function (c) {
        if (path.indexOf(c) < 0 && !c.hasAttribute('data-ggt-p') && !/^(SCRIPT|STYLE|LINK|TEMPLATE)$/.test(c.tagName)) c.setAttribute('data-ggt-p', 'hide');
      });
    });
    var cur = list[index()], d = cur && getComputedStyle(cur).display;
    document.documentElement.style.setProperty('--ggt-print-display', d && d !== 'none' ? d : 'block');
  }
  // Templates that reveal content only on the current slide get that class on every slide while printing.
  var printCls = [], printAt = 0;
  addEventListener('beforeprint', function () {
    markPrint();
    printAt = index();
    var list = slides(), cur = list[printAt];
    printCls = cur ? Array.prototype.filter.call(cur.classList, function (c) { return /^(is-)?(active|current|present|visible)$/.test(c); }) : [];
    list.forEach(function (sl) {
      printCls.forEach(function (c) { if (!sl.classList.contains(c)) { sl.classList.add(c); sl.setAttribute('data-ggt-printcls', ''); } });
    });
  });
  addEventListener('afterprint', function () {
    Array.prototype.forEach.call(document.querySelectorAll('[data-ggt-printcls]'), function (sl) {
      printCls.forEach(function (c) { sl.classList.remove(c); });
      sl.removeAttribute('data-ggt-printcls');
    });
    // Some templates follow the class change and jump; put the deck back where printing started.
    setTimeout(function () { if (index() !== printAt) go(printAt); }, 0);
    setTimeout(function () { if (index() !== printAt) go(printAt); }, 300);
  });
  ready(markPrint);

  /* follow the kernel */
  var last = -1;
  function watch() {
    var i = index();
    if (i === last) return;
    last = i;
    if (ink) paint();
    syncPresenter(i);
    var h = '#' + (i + 1);
    if (location.hash !== h && location.hash !== '#/' + (i + 1)) history.replaceState(null, '', h);
  }
  setInterval(watch, 200);

  function typing(t) {
    return t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
  }
  function own(e) { e.preventDefault(); e.stopImmediatePropagation(); }
  addEventListener('keydown', function (e) {
    if (synthetic || e.isComposing || e.metaKey || e.ctrlKey || e.altKey || typing(e.target)) return;
    var k = e.key, kind = open && open.getAttribute('data-ggt');
    if (kind === 'black' || kind === 'white') { own(e); closeAll(); return; }
    if (/^[0-9]$/.test(k)) { own(e); setJump((jump + k).replace(/^0+/, '').slice(0, 3)); return; }
    if (jump && k === 'Enter') { own(e); var n = parseInt(jump, 10); setJump(''); closeAll(); go(n - 1); return; }
    if (jump && k === 'Backspace') { own(e); setJump(jump.slice(0, -1)); return; }
    if (k === 'Escape') {
      if (jump || open || laser || inkOn || editing) { own(e); setJump(''); closeAll(); toggleLaser(false); if (ink) togglePen(false); toggleEdit(false); }
      return;
    }
    var low = k.length === 1 ? k.toLowerCase() : k;
    if (k === '?' || (k === '/' && e.shiftKey)) { own(e); kind === 'help' ? closeAll() : help(); }
    else if (low === 'o') { own(e); kind === 'overview' ? closeAll() : overview(); }
    else if (low === 's') { own(e); openPresenter(); }
    else if (low === 'l') { own(e); toggleLaser(); if (laser && inkOn) togglePen(false); }
    else if (low === 'd') { own(e); togglePen(); }
    else if (low === 'c' && inkOn) { own(e); strokes[index()] = []; paint(); }
    else if (low === 'b') { own(e); screen('black'); }
    else if (low === 'w') { own(e); screen('white'); }
    else if (low === 'e') { own(e); toggleEdit(); }
    else if (open && kind !== 'help') own(e);
    else if (open) closeAll();
  }, true);

  /* #N deep link */
  var m = /^#\/?(\d+)$/.exec(location.hash);
  if (m) {
    var want = parseInt(m[1], 10) - 1, stop = Date.now() + 4000;
    ready(function land() {
      if (index() !== want && !stepping) go(want);
      if (index() !== want && Date.now() < stop) setTimeout(land, 250);
    });
  }

  window.deckToolkit = { go: go, index: index, slides: slides };
})();
