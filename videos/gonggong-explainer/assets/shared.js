// Shared motion vocabulary for every chapter, loaded once by index.html before sub-compositions mount.
window.GG = {
  // Hand-drawn rounded rectangle that overshoots its start like a pen stroke.
  roughRect(w, h) {
    const r = Math.min(28, h / 2)
    return `M ${r + 8} 3 L ${w - r} 1 Q ${w + 2} 2 ${w - 1} ${r} L ${w + 1} ${h - r} Q ${w} ${h + 1} ${w - r} ${h - 1} ` +
      `L ${r} ${h + 1} Q 1 ${h} 2 ${h - r} L 0 ${r} Q 2 0 ${r + 4} 1 L ${r + 40} -2`
  },

  // Position a `.ring` svg around a region given in source-image pixels, displayed at `scale`.
  ring(sel, scale, [x, y, w, h], pad = 14) {
    const el = document.querySelector(sel)
    const W = w * scale + pad * 2
    const H = h * scale + pad * 2
    Object.assign(el.style, { left: `${x * scale - pad}px`, top: `${y * scale - pad}px`, width: `${W}px`, height: `${H}px` })
    el.setAttribute('viewBox', `0 0 ${W} ${H}`)
    el.innerHTML = `<path pathLength="1" stroke-dasharray="1" stroke-dashoffset="1" vector-effect="non-scaling-stroke" d="${this.roughRect(W, H)}"/>`
  },

  draw(tl, sel, t, dur = 0.6) {
    tl.fromTo(`${sel} path`, { strokeDashoffset: 1 }, { strokeDashoffset: 0, duration: dur, ease: 'power2.inOut' }, t)
  },

  // Zoom a `.zoomer` (image + rings) so a source-pixel region fills the viewport.
  focus(tl, sel, scale, [x, y, w, h], vpW, vpH, t, dur = 0.9) {
    const k = Math.min(vpW / (w * scale), vpH / (h * scale), 2.6)
    const cx = (x + w / 2) * scale
    const cy = (y + h / 2) * scale
    const tx = Math.min(0, Math.max(vpW - vpW * k, vpW / 2 - cx * k))
    const ty = Math.min(0, Math.max(vpH - vpH * k, vpH / 2 - cy * k))
    tl.to(sel, { scale: k, x: tx, y: ty, duration: dur, ease: 'power3.inOut', transformOrigin: '0 0' }, t)
  },
  unfocus(tl, sel, t, dur = 0.8) {
    tl.to(sel, { scale: 1, x: 0, y: 0, duration: dur, ease: 'power3.inOut', transformOrigin: '0 0' }, t)
  },

  // Chapter level card: wipe in, title slam, the mascot runs across, wipe out by 1.9s.
  level(tl, sel) {
    tl.fromTo(sel, { clipPath: 'inset(0% 100% 0% 0%)' }, { clipPath: 'inset(0% 0% 0% 0%)', duration: 0.35, ease: 'power3.out' }, 0)
    tl.fromTo(`${sel} .lv-n`, { opacity: 0, y: -40 }, { opacity: 1, y: 0, duration: 0.35, ease: 'back.out(2)' }, 0.15)
    tl.fromTo(`${sel} .lv-t`, { opacity: 0, scale: 1.4 }, { opacity: 1, scale: 1, duration: 0.3, ease: 'back.out(1.6)' }, 0.25)
    tl.fromTo(`${sel} .lv-g`, { x: -260 }, { x: 1940, duration: 1.7, ease: 'none' }, 0.05)
    tl.fromTo(`${sel} .lv-g`, { y: 0 }, { y: -40, duration: 0.17, yoyo: true, repeat: 9, ease: 'sine.out' }, 0.05)
    tl.fromTo(`${sel} .lv-dots .cur`, { scale: 0.6 }, { scale: 1.3, duration: 0.3, yoyo: true, repeat: 3, ease: 'sine.inOut' }, 0.3)
    tl.to(sel, { clipPath: 'inset(0% 0% 0% 100%)', duration: 0.35, ease: 'power3.in' }, 1.55)
  },

  // Right-column header + numbered key points.
  head(tl, sel, t = 1.75) {
    tl.fromTo(`${sel} .kick`, { opacity: 0, x: 30 }, { opacity: 1, x: 0, duration: 0.4, ease: 'power3.out' }, t)
    tl.fromTo(`${sel} .ttl`, { opacity: 0, x: 40 }, { opacity: 1, x: 0, duration: 0.5, ease: 'power3.out' }, t + 0.1)
  },
  kp(tl, sel, t) {
    tl.fromTo(sel, { opacity: 0, x: 40, scale: 0.96 }, { opacity: 1, x: 0, scale: 1, duration: 0.45, ease: 'back.out(1.7)' }, t)
    tl.fromTo(`${sel} .no`, { backgroundColor: '#0a7cff', color: '#ffffff' }, { backgroundColor: '#e6f0ff', color: '#0a7cff', duration: 0.6 }, t + 0.5)
  },

  // Character pops up from below with a speech bubble, wobbles while talking, drops away.
  cameo(tl, sel, tIn, tOut) {
    tl.fromTo(sel, { y: 420, rotation: -8 }, { y: 0, rotation: 0, duration: 0.45, ease: 'back.out(1.8)' }, tIn - 0.25)
    tl.fromTo(`${sel} .say`, { opacity: 0, scale: 0.3 }, { opacity: 1, scale: 1, duration: 0.3, ease: 'back.out(2.6)' }, tIn)
    tl.to(`${sel} img`, { rotation: 5, duration: 0.22, yoyo: true, repeat: Math.max(1, Math.floor((tOut - tIn) / 0.22) - 1), ease: 'sine.inOut', transformOrigin: '50% 90%' }, tIn)
    tl.to(sel, { y: 420, duration: 0.35, ease: 'power2.in' }, tOut)
  },

  // Screen card entrance / exit.
  enter(tl, sel, t, from = 'right') {
    const x = from === 'right' ? 160 : from === 'left' ? -160 : 0
    const y = from === 'up' ? -80 : from === 'down' ? 80 : 0
    tl.fromTo(sel, { opacity: 0, x, y, scale: 0.97 }, { opacity: 1, x: 0, y: 0, scale: 1, duration: 0.6, ease: 'power3.out' }, t)
  },
  leave(tl, sel, t) {
    tl.to(sel, { opacity: 0, scale: 0.94, y: -30, duration: 0.4, ease: 'power2.in' }, t)
  },
}
