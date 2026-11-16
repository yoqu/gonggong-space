# Chat Story

A story told through a chat thread: each act is a group-chat screen whose bubbles appear one by one on →, broken up by big-type narration slides and a data slide. For user stories, interview recaps, support cases, product-usage scenarios and team conversations.

`example.html` is a finished example of this template (10 slides: 青舟客服 × 禾丰生鲜, from a complaint to a three-year renewal) — study its structure, density and finish, do not copy its copy.

## Start here

1. Copy `example.html` to `design/<slug>/index.html`.
2. Keep the whole "Stage kernel" CSS block and the kernel `<script>` byte-for-byte. The template needs no script of its own: bubbles are kernel `data-step` items.
3. Keep `<script src="…/deck-toolkit.js"></script>` as the last element of `<head>`; SKILL.md Step 3 rewrites its path to `./assets/deck-toolkit.js` and copies the file.
4. Replace the cast, the chat header and each act, slide by slide.

## Visual system

Original warm palette — do not imitate any real messenger's colours, icons or layout chrome.

| Token | Value | Use |
| --- | --- | --- |
| `--paper` | `#F7F1E8` | page background |
| `--panel` | `#FFFCF7` | chat panel |
| `--ink` | `#2B2520` | text; narration slide background |
| `--muted` | `#776B60` | names, timestamps, captions |
| `--rule` | `#E3D8CA` | panel border, hairlines |
| `--in` | `#EEE3D4` | incoming bubble (the customer / interviewee side) |
| `--out` / `--out-ink` | `#22665E` / `#FFFFFF` | outgoing bubble (our side) |
| `--clay` | `#C2603A` | the one accent: act label, cover highlight, one avatar |
| `--olive` | `#7D7230` | third avatar only |

- **Type:** headings in `--serif` (Georgia → `"Songti SC","Noto Serif SC",serif`), UI and body in `--sans` (ends `"PingFang SC","Noto Sans SC","Microsoft YaHei",sans-serif`). Cover 124px, narration 104px, slide titles 72px, act titles 54px, bubbles 30px, names/timestamps 20–22px.
- **Grid:** chat slides = caption column at x 140–670 + chat panel at x 720–1800 (top/bottom 44px). Other slides use 140px side margins.
- **Avatars:** a circle with the person's first character (`.av.p-zhou` etc.); one colour per person, kept across the deck. Never use photos or logos.
- **Decoration rules:** no emoji, no brand icons; charts inside messages are inline SVG; one accent per screen.

## Slide vocabulary

| Slide (`data-section` in the example) | Class / blocks | Use |
| --- | --- | --- |
| cover | `.cover` + `.cover-chat` | Title with one highlighted phrase, a 2-bubble teaser of the first and last moments (no steps). |
| cast | `.title` + `.cast > .person` | Who is in the story: avatar, name, role, one line on their part. |
| act (×5) | `.cap` + `.chat` → `.chat-head`, `.thread`, `.chat-foot` | One scene: act label + time, a claim title, one context line, and the conversation. |
| narration | `.slide.narr` + `.inner` | Big-type turning point between acts. |
| data | `.title` + `.rows > .row` | Before → after bars with big value; one `data-step` per row; label data 示例 unless sourced. |
| lessons | `.slide.narr` + `.lessons` | Closing: three takeaways (one `data-step` each). |

Thread items (children of `.thread`, in order):

```html
<div class="sys">3 月 8 日 22:14</div>                          <!-- no data-step: visible on entry -->
<div class="msg in" data-step><span class="av p-zhou">周</span><div><b class="who">周岚 · 禾丰生鲜</b><p class="bub">…</p></div></div>
<div class="msg in" data-step>…<div class="bub card">title + inline SVG or dl/ol</div>…</div>
<div class="msg out typing" data-step><span class="av p-lu">陆</span><div><p class="bub"><i></i><i></i><i></i></p></div></div>
<div class="msg out" data-step>…<p class="bub">…</p><small class="read">已读</small></div></div>
<div class="sys" data-step>程远 加入了对话</div>
```

- `.msg.in` left (other party), `.msg.out` right (our side). `.bub.card` = card/image message (500px wide).
- `.typing` shows only while it is the latest shown step; the next step replaces it. Put it right before the reply it announces.
- Typical 10-slide deck: cover → cast → act 1 → act 2 → narration → act 3 → data → act 4 → act 5 → lessons.

## Interaction

- → reveals the next bubble (`data-step`); hidden steps take no space, so the thread is bottom-anchored and earlier bubbles move up and fade out under the top mask instead of overflowing.
- ← steps back; entering a slide backwards shows the full thread.
- `prefers-reduced-motion: reduce` turns off the bubble pop and typing-dot animation.

## Linked edits

- **Bubble budget per act:** the thread area is about 880px tall. Final state (all steps shown, typing hidden) should fit: roughly 1 timestamp + 5 messages, at most one card and at most two 2-line bubbles. Keep bubbles ≤ 26 Chinese characters for one line. If an act needs more, split it into two acts rather than shrinking text.
- **People:** a person's initial, avatar class (`p-*`) and `who` label must match across cast, cover teaser and every act; add a new `.p-name{--c:…}` rule for a new person.
- **Chat header** (`.chat-head`: group name, member count) is repeated on every act slide — change all of them together; member count must match the cast.
- **Act numbering:** `.cap .act` labels (第 N 幕) and the cover meta ("5 幕对话") must match the number of act slides.
- **Dates and durations:** the cover subtitle ("117 天"), act timestamps and the data slide's comparison dates must agree.
- Accent colours live only in `:root`; inline SVG charts inside cards repeat `#C2603A` / `#22665E` / `#D9CCBB` — update them too when re-theming.

## Print

Supported: browser print, one 1920×1080 page per slide. Act slides print the final state of the conversation (all messages shown, typing indicators hidden); if an act exceeds the bubble budget its earliest messages print faded under the top mask, so keep to the budget. Data and lessons rows print fully revealed.

## Speaker notes

Put 60–120 characters of notes in `<aside class="notes">…</aside>` as the last child of each slide; the kernel hides them and the S presenter window shows them. On act slides, tell the presenter what to point at while stepping through.

## Checklist

- [ ] Every slide has a unique `data-section` and a short `data-title`; the cover has no `data-step`.
- [ ] Every act opens with one non-step item (timestamp) so the panel is never empty on entry.
- [ ] Each act's final state fits the thread without the first message being cut (check at 1920×1080 and 1280×720).
- [ ] Each `.typing` sits directly before the reply it announces.
- [ ] Names are fictional; no real messenger branding, logos or photos.
- [ ] Data slide numbers come from the brief or are marked 示例.
- [ ] Bubble text ≥ 30px, captions ≥ 20px, nothing overflows the slide.
