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
    'border-radius:10px;padding:8px 14px;box-shadow:0 8px 30px rgba(0,0,0,.35)}'
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
    ['激光笔', ['L']], ['画笔（C 清除本页）', ['D']], ['黑屏 / 白屏', ['B', 'W']], ['关闭 / 退出', ['Esc']], ['快捷键', ['?']]
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
  function show(layer) { closeAll(); open = layer; document.body.appendChild(layer); }

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
      if (jump || open || laser || inkOn) { own(e); setJump(''); closeAll(); toggleLaser(false); if (ink) togglePen(false); }
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
