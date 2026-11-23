/**
 * The presenter built into an HTML export: a small dependency-free script
 * and stylesheet that scale the deck to the window and play it.
 *
 * Keys: → ↓ PageDown Space Enter N advance; ← ↑ PageUp Backspace P go back;
 * Home / End; F toggles full screen. A click (or a swipe) advances too.
 * `#N` in the address opens slide N.
 *
 * Builds play their entrance and exit effects (the slide stylesheet's
 * `open-artifact-build-*` classes), `auto` steps chain on their own, and slides change
 * with their transition: fade (320 ms), push (420 ms) or magic move (480 ms:
 * elements with the same id move into place while the rest crossfade). A
 * slide's transition plays when it is left; going back plays the earlier
 * slide's transition in reverse and lands on its last build step. Videos
 * start (after their delay, or on a click) as their slide appears and stop
 * when it is left; hosted players are loaded only while their slide shows.
 *
 * The deck's plan (`<script type="application/json" id="open-artifact-plan">`):
 * `{ buildMs, durations, slides: [{ transition, builds, steps }] }`.
 */

import { createCountPlayer } from '../count-player.ts';

/** Stacked slides for portrait screens and readers with scripting disabled. */
export const READER_CSS = `
@media screen {
  html.open-artifact-reader, .open-artifact-reader body{overflow-x:hidden;overflow-y:auto;height:auto}
  .open-artifact-reader .open-artifact-deck{position:static;width:100%;height:auto;transform:none!important;overflow:visible}
  .open-artifact-reader .open-artifact-frame{position:relative;display:block;width:100%;height:auto;aspect-ratio:var(--slide-aspect);margin-bottom:12px}
  .open-artifact-reader .open-artifact-frame:last-child{margin-bottom:max(0px,calc(100vh - var(--reader-slide-height,100vh)))}
  .open-artifact-reader .open-artifact-slide{transform:scale(var(--page-scale));transform-origin:0 0}
  .open-artifact-reader .open-artifact-build-hidden{visibility:visible!important}
  .open-artifact-reader .open-artifact-build-out,.open-artifact-reader .open-artifact-build-in{animation:none!important}
}
`;

/** Styles of the player page (on top of the slide stylesheet). */
export const PLAYER_CSS = `
html,body{margin:0;width:100%;height:100%;background:#000;overflow:hidden}
body{-webkit-tap-highlight-color:transparent;touch-action:pan-y}
body.open-artifact-idle{cursor:none}
.open-artifact-deck{position:absolute;left:50%;top:50%;width:1920px;height:1080px;transform:translate(-50%,-50%) scale(.5);transform-origin:50% 50%;overflow:hidden}
.open-artifact-frame{position:absolute;left:0;top:0;width:1920px;height:1080px;display:none;overflow:hidden}
.open-artifact-frame.open-artifact-on{display:block}
.open-artifact-frame iframe.open-artifact-embed{border:0;background:transparent;display:block}
.open-artifact-hosted-player{position:absolute;inset:0;width:100%;height:100%;border:0}
.open-artifact-play{position:absolute;inset:0;margin:auto;width:144px;height:144px;border-radius:999px;border:0;background:#000000a0;color:#fff;display:flex;align-items:center;justify-content:center;cursor:pointer;z-index:1}
.open-artifact-play[hidden]{display:none}
.open-artifact-hud{position:fixed;right:16px;bottom:12px;font:13px/1.4 system-ui,-apple-system,"Segoe UI",sans-serif;color:#fff;background:#000000b0;padding:4px 10px;border-radius:999px;opacity:0;transition:opacity .3s;pointer-events:none;font-variant-numeric:tabular-nums}
.open-artifact-hud.open-artifact-show{opacity:1}
@media print{
  @page{size:1920px 1080px;margin:0}
  html,body{width:auto;height:auto;overflow:visible;background:#fff}
  .open-artifact-deck{position:static;transform:none!important;width:auto;height:auto;overflow:visible}
  .open-artifact-frame{position:relative;display:block!important;break-after:page;page-break-after:always}
  .open-artifact-frame .open-artifact-build-hidden{visibility:visible!important}
  .open-artifact-hud,.open-artifact-play{display:none!important}
}
`;

/** The player script (plain ES2017, no dependencies). */
export const PLAYER_SCRIPT = String.raw`
(function () {
  'use strict';
  var countPlayer = (${createCountPlayer.toString()})();
  var plan = JSON.parse(document.getElementById('open-artifact-plan').textContent);
  var W = 1920, H = 1080;
  var deck = document.querySelector('.open-artifact-deck');
  var frames = Array.prototype.slice.call(document.querySelectorAll('.open-artifact-frame'));
  var hud = document.querySelector('.open-artifact-hud');
  var reduced = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  var index = 0, done = 0, running = null, autoTimer = 0, scale = 1;
  if (!frames.length) return;

  var portrait = window.matchMedia('(max-aspect-ratio: 1/1)');
  function fit() {
    scale = Math.min(window.innerWidth / W, window.innerHeight / H);
    var width = document.documentElement.clientWidth;
    document.documentElement.style.setProperty('--page-scale', width / W);
    document.documentElement.style.setProperty('--reader-slide-height', width * H / W + 'px');
    deck.style.transform = 'translate(-50%,-50%) scale(' + scale + ')';
  }
  window.addEventListener('resize', fit);
  fit();

  function each(list, fn) { Array.prototype.forEach.call(list, fn); }
  function child(frame, i) { return frame.querySelector('.open-artifact-slide > [data-open-artifact-path="' + i + '"]'); }

  /* Builds ---------------------------------------------------------------- */

  function setBuild(el, state, effect) {
    var drop = [];
    each(el.classList, function (name) { if (name.indexOf('open-artifact-build-') === 0 || name.indexOf('open-artifact-fx-') === 0) drop.push(name); });
    drop.forEach(function (name) { el.classList.remove(name); });
    if (state === 'hidden') el.classList.add('open-artifact-build-hidden');
    else if (state === 'in' || state === 'out') {
      void el.offsetWidth;
      el.classList.add(state === 'in' ? 'open-artifact-build-in' : 'open-artifact-build-out', 'open-artifact-fx-' + (effect || 'fade'));
    }
  }

  /** Shows slide k as it is after n steps; the last step animates when asked. */
  function applySteps(k, n, animate) {
    var frame = frames[k], slide = plan.slides[k];
    each(frame.querySelectorAll('[data-fragment]'), function (el) { el.classList.add('open-artifact-build-hidden'); });
    slide.builds.forEach(function (b) {
      var el = child(frame, b.child);
      if (el) setBuild(el, b.enters ? 'hidden' : 'shown');
    });
    slide.steps.slice(0, n).forEach(function (step, s) {
      var latest = animate && s === n - 1;
      (step.reveal || []).forEach(function (origin) {
        var el = frame.querySelector('[data-fragment="' + origin + '"]');
        if (el) setBuild(el, latest && !reduced ? 'in' : 'shown', 'fade');
      });
      step.enter.forEach(function (c) {
        var el = child(frame, c);
        if (el) setBuild(el, latest ? 'in' : 'shown', el.getAttribute('data-open-artifact-in'));
      });
      step.exit.forEach(function (c) {
        var el = child(frame, c);
        if (el) setBuild(el, latest ? 'out' : 'hidden', el.getAttribute('data-open-artifact-out'));
      });
    });
  }

  function leadingAuto(k) {
    var steps = plan.slides[k].steps, n = 0;
    while (n < steps.length && steps[n].auto) n++;
    return n;
  }

  function scheduleAuto() {
    clearTimeout(autoTimer);
    var steps = plan.slides[index].steps;
    if (done >= steps.length || !steps[done].auto) return;
    autoTimer = setTimeout(function () {
      if (running) return;
      done++;
      applySteps(index, done, true);
      scheduleAuto();
    }, done === 0 ? 0 : plan.buildMs);
  }

  /* Media ----------------------------------------------------------------- */

  function startClip(holder) {
    var button = holder.querySelector('.open-artifact-play');
    if (button) button.hidden = true;
    var video = holder.querySelector('video[data-open-artifact-clip]');
    if (video) {
      var playing = video.play();
      if (playing && playing.catch) playing.catch(function () {
        video.muted = true;
        var retry = video.play();
        if (retry && retry.catch) retry.catch(function () {});
      });
      return;
    }
    var url = holder.getAttribute('data-open-artifact-hosted');
    if (url && !holder.querySelector('.open-artifact-hosted-player')) {
      var frame = document.createElement('iframe');
      frame.className = 'open-artifact-hosted-player';
      frame.src = url;
      frame.title = holder.getAttribute('aria-label') || 'Video';
      frame.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
      frame.setAttribute('allowfullscreen', '');
      holder.appendChild(frame);
    }
  }

  function enterMedia(frame) {
    each(frame.querySelectorAll('[data-open-artifact-media]'), function (holder) {
      if (holder.getAttribute('data-open-artifact-start') === 'click') return;
      var delay = parseFloat(holder.getAttribute('data-open-artifact-delay') || '0') || 0;
      holder._openArtifactTimer = setTimeout(function () { startClip(holder); }, delay * 1000);
    });
  }

  function leaveMedia(frame) {
    each(frame.querySelectorAll('[data-open-artifact-media]'), function (holder) {
      clearTimeout(holder._openArtifactTimer);
      var video = holder.querySelector('video[data-open-artifact-clip]');
      if (video) { try { video.pause(); video.currentTime = 0; } catch (e) {} }
      var player = holder.querySelector('.open-artifact-hosted-player');
      if (player) player.remove();
      var button = holder.querySelector('.open-artifact-play');
      if (button) button.hidden = false;
    });
  }

  each(document.querySelectorAll('.open-artifact-play'), function (button) {
    button.addEventListener('click', function (event) {
      event.stopPropagation();
      startClip(button.closest('[data-open-artifact-media]'));
    });
  });

  /* Transitions ----------------------------------------------------------- */

  function center(rect) { return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }; }

  /** Moves elements with the same id from their old place to their new one. */
  function magic(from, to, ms, anims) {
    var olds = {};
    each(from.querySelectorAll('[data-open-artifact-id]'), function (el) { olds[el.getAttribute('data-open-artifact-id')] = el; });
    var easing = 'cubic-bezier(.4,0,.2,1)';
    each(to.querySelectorAll('[data-open-artifact-id]'), function (el) {
      var old = olds[el.getAttribute('data-open-artifact-id')];
      if (!old) return;
      var a = old.getBoundingClientRect(), b = el.getBoundingClientRect();
      if (!a.width || !a.height || !b.width || !b.height) return;
      var ca = center(a), cb = center(b);
      var dx = (ca.x - cb.x) / scale, dy = (ca.y - cb.y) / scale;
      var sx = a.width / b.width, sy = a.height / b.height;
      anims.push(el.animate([
        { translate: dx + 'px ' + dy + 'px', scale: sx + ' ' + sy },
        { translate: '0px 0px', scale: '1 1' }
      ], { duration: ms, easing: easing }));
      anims.push(old.animate([
        { translate: '0px 0px', scale: '1 1' },
        { translate: -dx + 'px ' + -dy + 'px', scale: (1 / sx) + ' ' + (1 / sy) }
      ], { duration: ms, easing: easing, fill: 'forwards' }));
    });
    anims.push(to.animate([{ opacity: 0 }, { opacity: 1 }], { duration: ms, easing: 'ease' }));
  }

  function finish() {
    if (!running) return;
    var current = running;
    running = null;
    current.anims.forEach(function (anim) { try { anim.finish(); } catch (e) {} });
    current.end();
  }

  function show(frame) { frame.classList.add('open-artifact-on'); }
  function hide(frame) { frame.classList.remove('open-artifact-on'); frame.style.zIndex = ''; }

  var stopMotion = [];
  function clearMotion() {
    stopMotion.forEach(function (stop) { stop(); });
    stopMotion = [];
  }
  function entered() {
    if (portrait.matches) return;
    if (!reduced) each(frames[index].querySelectorAll('[data-animation]'), function (el) {
      el.style.animation = el.dataset.animation;
      var stop = el.dataset.count && countPlayer.countUp(el, JSON.parse(el.dataset.count));
      stopMotion.push(function () { el.style.animation = ''; if (stop) stop(); });
    });
    enterMedia(frames[index]);
    scheduleAuto();
  }

  function go(k, dir, instant) {
    if (k < 0 || k >= frames.length || k === index) return;
    finish();
    clearTimeout(autoTimer);
    var from = frames[index], to = frames[k];
    var kind = instant ? null : (dir > 0 ? plan.slides[index].transition : plan.slides[k].transition);
    clearMotion();
    leaveMedia(from);
    index = k;
    done = dir < 0 ? plan.slides[k].steps.length : 0;
    if (portrait.matches) to.scrollIntoView({ block: 'start' });
    applySteps(k, done, false);
    show(to);
    updateHud(true);
    try { history.replaceState(null, '', '#' + (k + 1)); } catch (e) {}
    var ms = kind && plan.durations[kind];
    if (!ms || reduced || portrait.matches || !to.animate) {
      hide(from);
      entered();
      return;
    }
    from.style.zIndex = '1';
    to.style.zIndex = '2';
    var anims = [];
    if (kind === 'push') {
      anims.push(from.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(' + (-dir * W) + 'px)' }], { duration: ms, easing: 'cubic-bezier(.4,0,.2,1)', fill: 'forwards' }));
      anims.push(to.animate([{ transform: 'translateX(' + (dir * W) + 'px)' }, { transform: 'translateX(0)' }], { duration: ms, easing: 'cubic-bezier(.4,0,.2,1)' }));
    } else if (kind === 'magic') {
      magic(from, to, ms, anims);
    } else {
      anims.push(to.animate([{ opacity: 0 }, { opacity: 1 }], { duration: ms, easing: 'ease' }));
    }
    var state = {
      anims: anims,
      end: function () {
        anims.forEach(function (anim) { try { anim.cancel(); } catch (e) {} });
        hide(from);
        to.style.zIndex = '';
        entered();
      }
    };
    running = state;
    Promise.all(anims.map(function (anim) { return anim.finished; })).then(function () {
      if (running === state) { running = null; state.end(); }
    }, function () {});
  }

  function next() {
    if (portrait.matches) { go(index + 1, 1, true); return; }
    finish();
    var steps = plan.slides[index].steps;
    if (done < steps.length) {
      clearTimeout(autoTimer);
      done++;
      applySteps(index, done, true);
      scheduleAuto();
      return;
    }
    go(index + 1, 1);
  }

  function prev() {
    if (portrait.matches) { go(index - 1, -1, true); return; }
    finish();
    clearTimeout(autoTimer);
    var lead = leadingAuto(index), steps = plan.slides[index].steps;
    if (done > lead) {
      do { done--; } while (done > lead && steps[done].auto);
      applySteps(index, done, false);
      return;
    }
    go(index - 1, -1);
  }

  /* Input ----------------------------------------------------------------- */

  function toggleFullscreen() {
    var doc = document, root = doc.documentElement;
    if (doc.fullscreenElement || doc.webkitFullscreenElement) {
      (doc.exitFullscreen || doc.webkitExitFullscreen).call(doc);
    } else {
      var request = root.requestFullscreen || root.webkitRequestFullscreen;
      if (request) {
        var result = request.call(root);
        if (result && result.catch) result.catch(function () {});
      }
    }
  }

  document.addEventListener('keydown', function (event) {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    var key = event.key;
    if (key === 'ArrowRight' || key === 'ArrowDown' || key === 'PageDown' || key === ' ' || key === 'Enter' || key === 'n' || key === 'N') next();
    else if (key === 'ArrowLeft' || key === 'ArrowUp' || key === 'PageUp' || key === 'Backspace' || key === 'p' || key === 'P') prev();
    else if (key === 'Home') go(0, 1, true);
    else if (key === 'End') go(frames.length - 1, 1, true);
    else if (key === 'f' || key === 'F') toggleFullscreen();
    else return;
    event.preventDefault();
  });

  document.addEventListener('click', function (event) {
    if (portrait.matches || event.button !== 0 || event.target.closest('a, button, iframe, video, .open-artifact-text, .open-artifact-embed') || String(window.getSelection())) return;
    if (event.clientX < window.innerWidth / 2) prev(); else next();
  });

  // Trackpad momentum should advance once per gesture.
  var wheelDelta = 0, wheelUsed = false, wheelTimer = 0;
  window.addEventListener('wheel', function (event) {
    if (portrait.matches || event.ctrlKey || event.metaKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
    event.preventDefault();
    clearTimeout(wheelTimer);
    wheelTimer = setTimeout(function () { wheelDelta = 0; wheelUsed = false; }, 250);
    if (wheelUsed) return;
    wheelDelta += event.deltaMode ? Math.sign(event.deltaY) * 60 : event.deltaY;
    if (Math.abs(wheelDelta) >= 60) {
      wheelUsed = true;
      if (wheelDelta > 0) next(); else prev();
    }
  }, { passive: false });

  var touch = null;
  document.addEventListener('touchstart', function (event) {
    var t = event.changedTouches[0];
    touch = { x: t.clientX, y: t.clientY };
  }, { passive: true });
  document.addEventListener('touchend', function (event) {
    if (!touch || portrait.matches) return;
    var t = event.changedTouches[0], dx = t.clientX - touch.x, dy = t.clientY - touch.y;
    touch = null;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) {
      event.preventDefault();
      if (dx < 0) next(); else prev();
    }
  });

  var idleTimer = 0;
  function updateHud(flash) {
    if (!hud) return;
    hud.textContent = (index + 1) + ' / ' + frames.length;
    if (!flash) return;
    hud.classList.add('open-artifact-show');
    document.body.classList.remove('open-artifact-idle');
    clearTimeout(idleTimer);
    idleTimer = setTimeout(function () {
      hud.classList.remove('open-artifact-show');
      document.body.classList.add('open-artifact-idle');
    }, 1800);
  }
  document.addEventListener('mousemove', function () { updateHud(true); });

  /** Opens the slide the address names; true when it moved. */
  function fromHash() {
    var n = parseInt(String(location.hash).replace('#', ''), 10);
    if (!(n >= 1 && n <= frames.length && n - 1 !== index)) return false;
    go(n - 1, 1, true);
    return true;
  }
  window.addEventListener('hashchange', fromHash);

  function layout() {
    finish();
    clearMotion();
    clearTimeout(autoTimer);
    document.documentElement.classList.toggle('open-artifact-reader', portrait.matches);
    fit();
    if (portrait.matches) {
      leaveMedia(frames[index]);
      frames[index].scrollIntoView({ block: 'start' });
    } else {
      window.scrollTo(0, 0);
      applySteps(index, done, false);
      entered();
    }
  }
  var scrollTimer = 0;
  window.addEventListener('scroll', function () {
    if (!portrait.matches) return;
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(function () {
      if (!portrait.matches) return;
      var nearest = frames.reduce(function (best, frame, i) {
        return Math.abs(frame.getBoundingClientRect().top) < Math.abs(frames[best].getBoundingClientRect().top) ? i : best;
      }, 0);
      if (nearest !== index) {
        hide(frames[index]); leaveMedia(frames[index]);
        index = nearest; done = 0; show(frames[index]);
        history.replaceState(null, '', '#' + (index + 1));
        updateHud(true);
      }
    }, 150);
  }, { passive: true });
  portrait.addEventListener('change', layout);
  document.documentElement.classList.toggle('open-artifact-reader', portrait.matches);
  applySteps(0, 0, false);
  updateHud(false);
  if (!fromHash()) entered();
})();
`;
