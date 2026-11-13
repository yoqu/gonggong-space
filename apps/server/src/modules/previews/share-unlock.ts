import type { translator } from '../../i18n/index.js'

type Translator = ReturnType<typeof translator>

const SLOTS = 4

const LOCK_ICON =
  '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4.5" y="10.5" width="15" height="10" rx="2.5"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/></svg>'

/** Inline `<script>` data: JSON with `<` escaped, so no string can close the tag. */
const data = (v: unknown) => JSON.stringify(v).replace(/</g, '\\u003c')

/**
 * The page a locked public link shows: 4 digit slots after rare-ui's OtpInput (rolling digits, a caret that glides,
 * a shake on a wrong code, rings drawn on success), self-contained since it is served outside the web app.
 */
export function shareUnlockPage(t: Translator) {
  const cells = Array.from(
    { length: SLOTS },
    (_, i) => `<div class="cell" data-filled="false">
      <input inputmode="numeric" pattern="[0-9]*" maxlength="${SLOTS}" autocomplete="${i === 0 ? 'one-time-code' : 'off'}" aria-label="${t('第 {n} 位，共 4 位', { n: i + 1 })}"${i === 0 ? ' autofocus' : ''}>
      <span class="chars" aria-hidden="true"></span>
      <svg class="ring" viewBox="0 0 56 56" aria-hidden="true"><rect x="1" y="1" width="54" height="54" rx="15" pathLength="1" style="transition-delay:${150 + i * 50}ms"/></svg>
    </div>`,
  ).join('')
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>${t('输入访问密码')}</title>
<style>
:root{color-scheme:light dark;--bg:#fff;--fg:#0a0a0a;--muted:#6e6e78;--slot:#F4F4F9;--focus:rgba(134,133,147,.5);--error:#FF3B30;--success:#34C759}
@media (prefers-color-scheme:dark){:root{--bg:#0a0a0a;--fg:#fff;--muted:#9a9aa3;--slot:#262626}}
*{box-sizing:border-box}
html,body{margin:0;min-height:100%;background:var(--bg);color:var(--fg);font:15px/1.5 -apple-system,BlinkMacSystemFont,"SF Pro Text","PingFang SC","Helvetica Neue",system-ui,sans-serif}
body{display:grid;place-items:center;min-height:100vh;min-height:100dvh;padding:24px}
main{display:flex;flex-direction:column;align-items:center;text-align:center;gap:6px;max-width:340px}
.icon{display:grid;place-items:center;width:48px;height:48px;border-radius:14px;background:var(--slot);color:var(--fg);margin-bottom:10px}
h1{font-size:20px;font-weight:600;margin:0;letter-spacing:-.01em}
.hint{margin:0 0 22px;color:var(--muted);font-size:14px}
.row{position:relative;display:flex;align-items:center;gap:10px}
.row.shake{animation:shake .32s ease-out}
@keyframes shake{20%{transform:translateX(-5px)}45%{transform:translateX(4px)}70%{transform:translateX(-2px)}100%{transform:none}}
.cell{position:relative}
input{display:block;width:56px;height:56px;border:0;border-radius:16px;background:var(--slot);color:transparent;caret-color:transparent;text-align:center;font-size:20px;outline:none;transition:box-shadow .2s;-webkit-appearance:none;appearance:none}
input::selection{background:transparent}
input:focus-visible{box-shadow:0 0 0 2px var(--focus)}
input:disabled{cursor:not-allowed}
.row.error input{box-shadow:0 0 0 2px rgba(255,59,48,.7);transition-delay:.15s}
.chars{position:absolute;inset:0;display:grid;place-items:center;overflow:hidden;pointer-events:none}
.chars span{grid-area:1/1;font-size:20px;font-weight:600;font-variant-numeric:tabular-nums;animation:roll-in .32s cubic-bezier(.2,1.25,.4,1) both}
.chars span.out-up{animation:roll-out-up .22s ease-in both}
.chars span.out-down{animation:roll-out-down .22s ease-in both}
@keyframes roll-in{from{transform:translateY(110%)}}
@keyframes roll-out-up{to{transform:translateY(-110%)}}
@keyframes roll-out-down{to{transform:translateY(110%)}}
.ring{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;overflow:visible}
.ring rect{fill:none;stroke:var(--success);stroke-width:2;stroke-dasharray:1;stroke-dashoffset:1;opacity:0}
.row.success .ring rect{opacity:1;stroke-dashoffset:0;transition-property:stroke-dashoffset;transition-duration:.45s;transition-timing-function:ease-out}
.caret{position:absolute;left:0;top:50%;width:2px;height:28px;margin:-14px 0 0 -1px;border-radius:2px;background:var(--fg);pointer-events:none;transition:transform .22s cubic-bezier(.2,1.1,.4,1);animation:blink 1.1s linear infinite}
.caret[hidden]{display:none}
@keyframes blink{50%{opacity:0}}
.msg{min-height:22px;margin:16px 0 0;font-size:13px;color:var(--error)}
@media (prefers-reduced-motion:reduce){.row.shake,.chars span,.caret{animation:none!important}.caret,.row.success .ring rect{transition:none!important}}
</style></head>
<body><main>
<div class="icon">${LOCK_ICON}</div>
<h1>${t('请输入访问密码')}</h1>
<p class="hint">${t('分享者为这个链接设置了 4 位数字密码')}</p>
<div class="row" role="group" aria-label="${t('访问密码')}">${cells}<span class="caret" hidden></span></div>
<p class="msg" role="alert"></p>
</main>
<script>
(() => {
  const NETWORK = ${data(t('网络出错，再试一次'))}
  const row = document.querySelector('.row')
  const inputs = [...row.querySelectorAll('input')]
  const caret = row.querySelector('.caret')
  const msg = document.querySelector('.msg')
  const slots = inputs.map(() => '')
  let editingAt = null
  let busy = false

  const paint = (i, cleared) => {
    const box = inputs[i].nextElementSibling
    for (const old of box.querySelectorAll('span:not([class])')) {
      old.className = cleared ? 'out-down' : 'out-up'
      setTimeout(() => old.remove(), 240)
    }
    inputs[i].value = slots[i]
    inputs[i].parentElement.dataset.filled = String(!!slots[i])
    if (slots[i]) box.append(Object.assign(document.createElement('span'), { textContent: slots[i] }))
  }
  const placeCaret = () => {
    const i = inputs.indexOf(document.activeElement)
    caret.hidden = i < 0 || !!slots[i]
    if (i >= 0) {
      const cell = inputs[i].parentElement
      caret.style.transform = 'translateX(' + (cell.offsetLeft + cell.offsetWidth / 2) + 'px)'
    }
  }
  const focusAt = (i) => {
    const el = inputs[Math.min(Math.max(i, 0), inputs.length - 1)]
    el.focus()
    el.select()
  }
  const set = (i, ch) => {
    slots[i] = ch
    paint(i, !ch)
    if (msg.textContent) {
      msg.textContent = ''
      row.classList.remove('error')
    }
  }
  const complete = () => slots.every(Boolean) && submit(slots.join(''))
  const fill = (i, chars) => {
    chars.slice(0, inputs.length - i).forEach((ch, k) => set(i + k, ch))
    editingAt = null
    focusAt(i + chars.length)
    complete()
  }

  async function submit(password) {
    if (busy) return
    busy = true
    inputs.forEach((el) => (el.disabled = true))
    caret.hidden = true
    try {
      const res = await fetch(location.pathname, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password }),
        credentials: 'same-origin',
      })
      const body = await res.json().catch(() => ({}))
      if (res.ok && body.location) {
        row.classList.add('success')
        const late = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 700
        return setTimeout(() => location.replace(body.location + location.hash), late)
      }
      fail(body.error || NETWORK)
    } catch {
      fail(NETWORK)
    }
  }
  function fail(text) {
    busy = false
    inputs.forEach((el) => (el.disabled = false))
    slots.forEach((_, i) => set(i, ''))
    msg.textContent = text
    row.classList.remove('shake')
    void row.offsetWidth
    row.classList.add('shake', 'error')
    focusAt(0)
  }

  inputs.forEach((el, i) => {
    el.addEventListener('input', () => {
      const chars = el.value.split('').filter((c) => /^[0-9]$/.test(c))
      if (!chars.length) return paint(i, false)
      const typed = chars.length === 1 ? chars[0] : chars.length === 2 && chars[0] === slots[i] ? chars[1] : null
      if (typed === null) return fill(i, chars)
      if (slots.every(Boolean) && editingAt !== i) return paint(i, false)
      set(i, typed)
      editingAt = null
      focusAt(i + 1)
      complete()
    })
    el.addEventListener('keydown', (e) => {
      const act = {
        ArrowLeft: () => { editingAt = Math.max(i - 1, 0); focusAt(i - 1) },
        ArrowRight: () => { editingAt = Math.min(i + 1, inputs.length - 1); focusAt(i + 1) },
        Backspace: () => {
          if (slots[i]) set(i, '')
          else if (i > 0) { set(i - 1, ''); focusAt(i - 1) }
          placeCaret()
        },
      }[e.key]
      if (!act) return
      e.preventDefault()
      act()
    })
    el.addEventListener('paste', (e) => {
      e.preventDefault()
      const chars = (e.clipboardData.getData('text') || '').split('').filter((c) => /^[0-9]$/.test(c))
      if (chars.length) fill(i, chars)
    })
    el.addEventListener('pointerdown', (e) => {
      const first = slots.indexOf('')
      const target = first === -1 ? i : Math.min(i, first)
      editingAt = target
      if (target === i) return
      e.preventDefault()
      focusAt(target)
    })
    el.addEventListener('focus', () => { el.select(); placeCaret() })
    el.addEventListener('blur', () => setTimeout(placeCaret))
  })
  row.addEventListener('animationend', () => row.classList.remove('shake'))
  focusAt(0)
})()
</script>
</body></html>`
}
