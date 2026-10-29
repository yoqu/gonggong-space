# Web prototype layouts

**11 paste-ready section skeletons.** Drop into `<main id="content">` of `assets/template.html`. Don't write sections from scratch — pick the closest layout, paste, swap copy.

## Pre-flight (do this once before pasting anything)

1. **Read `assets/template.html`** through the end of the `<style>` block. Every class used below must exist there. If one is missing, add it to `<style>` rather than inlining it on each section.
2. **Pick a section list before writing copy.** Use the per-template rhythm table in `GUIDE.md`; it is the source of truth.
3. **One accent per screen, used at most twice.** The hero eyebrow and the primary button already use it; budget any third usage carefully.
4. **Every top-level `<section>` carries `data-section="<id>"`** with a short, unique, kebab-case id so people can point at a section when they give feedback.

## Class inventory (must exist in `template.html`)

> `section` `container` `hero` `hero-center` `hero-split` `hero-cta` `eyebrow` `lead` `h1` `h2` `h3` `meta` `num` `btn` `btn-primary` `btn-secondary` `btn-ghost` `btn-arrow` `card` `card-flat` `card-rule` `feature` `feature-mark` `stat` `stat-num` `stat-label` `stat-unit` `quote` `quote-mark` `quote-author` `pill` `tag` `field` `input` `textarea` `ds-table` `num-col` `ph-img` `content-img` `square` `portrait` `wide` `rule` `rule-strong` `grid-2` `grid-3` `grid-4` `grid-2-1` `grid-1-2` `row` `row-between` `stack` `log-row` `pull` `topnav` `pagefoot`

If you reach for a class not on this list, define it in `<style>` first or use `style="…"` inline. Never invent a global class on a `<section>` that isn't backed by CSS.

---

## Layout 1 — Hero, centered

Use when the page leads with a thesis sentence (most landings, most marketing pages). One eyebrow, one h1 (≤14 words), one lead sentence, two CTAs.

```html
<section class="section hero" data-section="hero">
  <div class="container hero-center">
    <p class="eyebrow">EYEBROW · CONTEXT</p>
    <h1>One sharp sentence about what this is.</h1>
    <p class="lead">One concrete-value subhead — what changes for the reader.</p>
    <div class="hero-cta">
      <button class="btn btn-primary">Primary action</button>
      <button class="btn btn-secondary">Secondary</button>
    </div>
  </div>
</section>
```

## Layout 2 — Hero, split (text + visual)

Use when there is a real product visual (product UI, screenshot, photograph). Left half copy, right half a `ph-img` scaffold. During Step 3, replace the entire scaffold with the acquired project-local image using `<img class="content-img" width="[intrinsic width]" height="[intrinsic height]">`. Do not transfer the scaffold's `wide` class or 16:9 ratio to the real image. Retain the scaffold only as a labeled fallback when acquisition genuinely fails.

```html
<section class="section" data-section="hero-split">
  <div class="container hero-split">
    <div>
      <p class="eyebrow">EYEBROW · ROLE</p>
      <h1>Headline that names the change.</h1>
      <p class="lead" style="margin-top: 20px;">A short subhead — concrete, not corporate. Two sentences max.</p>
      <div class="hero-cta" style="margin-top: 28px;">
        <button class="btn btn-primary">Primary action</button>
        <button class="btn btn-ghost btn-arrow">Read the story</button>
      </div>
    </div>
    <div class="ph-img wide" aria-label="Hero visual placeholder">[ Hero visual · 16:9 ]</div>
  </div>
</section>
```

## Layout 3 — Feature triplet

Three feature cells. Lead with a small `<h2>` framing the row. Don't put an icon on every heading — one tasteful mark per cell, monoline.

```html
<section class="section" data-section="features">
  <div class="container stack" style="gap: 56px;">
    <div style="max-width: 36ch;">
      <p class="eyebrow">WHAT'S DIFFERENT</p>
      <h2>Three things you'll notice in the first ten minutes.</h2>
    </div>
    <div class="grid-3">
      <div class="feature card-flat">
        <div class="feature-mark">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M12 3v18M3 12h18"/></svg>
        </div>
        <h3>Specific feature one</h3>
        <p>Two-sentence description that names the user value, not the technology.</p>
      </div>
      <div class="feature card-flat">
        <div class="feature-mark">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/></svg>
        </div>
        <h3>Specific feature two</h3>
        <p>Two-sentence description that names the user value, not the technology.</p>
      </div>
      <div class="feature card-flat">
        <div class="feature-mark">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 7h16M4 12h10M4 17h16"/></svg>
        </div>
        <h3>Specific feature three</h3>
        <p>Two-sentence description that names the user value, not the technology.</p>
      </div>
    </div>
  </div>
</section>
```

## Layout 4 — Stat row (data billboard)

Use when there are real numbers. Three stats max — four feels like a brochure. **Don't invent metrics.** If you don't have a number, use a different layout.

```html
<section class="section" data-section="stats">
  <div class="container">
    <p class="eyebrow" style="margin-bottom: 40px;">BY THE NUMBERS · 2026</p>
    <div class="grid-3">
      <div class="stat">
        <div class="stat-num num">38<span class="stat-unit">×</span></div>
        <p class="stat-label">less data moved over the wire vs. naive sync, on real customer workloads.</p>
      </div>
      <div class="stat">
        <div class="stat-num num">3,184</div>
        <p class="stat-label">paying teams, including 14 of the YC W26 batch.</p>
      </div>
      <div class="stat">
        <div class="stat-num num">$0.04<span class="stat-unit">/GB</span></div>
        <p class="stat-label">average egress saved — typical $1,800/mo bill drops to $200.</p>
      </div>
    </div>
  </div>
</section>
```

## Layout 5 — Pull quote (testimonial)

A single decisive quote with attribution. Use sparingly — one per page, never two in a row.

```html
<section class="section" data-section="quote">
  <div class="container" style="max-width: 800px;">
    <div class="quote-mark">"</div>
    <blockquote class="quote">Filebase pays for itself in the first month. We were going to hire a dedicated DevOps person to babysit our sync — instead we just switched.</blockquote>
    <p class="quote-author">— Mira Hassan, CTO at Northwind Studios</p>
  </div>
</section>
```

## Layout 6 — CTA strip (closing)

End the page on one decisive ask. Centered, generous whitespace, one primary button. No secondary unless the page has zero other buttons.

```html
<section class="section" data-section="cta-strip" style="text-align: center;">
  <div class="container" style="max-width: 600px;">
    <h2>Stop measuring meetings. Start measuring focus.</h2>
    <p class="lead" style="margin: 16px auto 32px;">Free for solo. $4/mo per teammate after that.</p>
    <button class="btn btn-primary">Start free</button>
  </div>
</section>
```

## Layout 7 — Log list (changelog / blog index / posts)

Editorial layout for a list of dated entries. Date in mono on the left, title + dek in the middle, optional pull stat on the right. Borders on top, never around — boxes feel like a brochure.

```html
<section class="section" data-section="log">
  <div class="container">
    <div class="row-between" style="margin-bottom: 32px;">
      <h2>Recent changes</h2>
      <a class="btn btn-ghost btn-arrow" href="#">View all</a>
    </div>
    <div>
      <article class="log-row">
        <span class="meta">Apr 27, 2026</span>
        <div>
          <h3>Sync engine v3 — half the wire bytes</h3>
          <p style="margin: 4px 0 0; color: var(--muted); font-size: 14px;">A new content-defined chunker that produces 38× fewer post-edit changes on Final Cut projects.</p>
        </div>
        <span class="pull meta">Engineering</span>
      </article>
      <article class="log-row">
        <span class="meta">Apr 19, 2026</span>
        <div>
          <h3>Per-folder bandwidth budgets</h3>
          <p style="margin: 4px 0 0; color: var(--muted); font-size: 14px;">Cap how much a single project can pull each month — useful for archive folders.</p>
        </div>
        <span class="pull meta">Product</span>
      </article>
      <article class="log-row">
        <span class="meta">Apr 04, 2026</span>
        <div>
          <h3>S3 + R2 dual-region replication</h3>
          <p style="margin: 4px 0 0; color: var(--muted); font-size: 14px;">Two providers, automatic failover. Enterprise tier only for now.</p>
        </div>
        <span class="pull meta">Infra</span>
      </article>
    </div>
  </div>
</section>
```

## Layout 8 — Comparison table (pricing, plan matrix, before/after)

Hairline borders, mono numerics, one column highlighted via an accent border. Don't put the whole row in surface-color — that screams "table".

```html
<section class="section" data-section="pricing">
  <div class="container">
    <div style="text-align: center; max-width: 36ch; margin: 0 auto 56px;">
      <p class="eyebrow">PRICING</p>
      <h2>One row of features. Three lines of pricing.</h2>
    </div>
    <table class="ds-table">
      <thead>
        <tr>
          <th>Feature</th>
          <th class="num-col">Solo</th>
          <th class="num-col">Team</th>
          <th class="num-col">Enterprise</th>
        </tr>
      </thead>
      <tbody>
        <tr><td>Sync engine v3</td><td class="num-col">✓</td><td class="num-col">✓</td><td class="num-col">✓</td></tr>
        <tr><td>Per-folder budgets</td><td class="num-col">—</td><td class="num-col">✓</td><td class="num-col">✓</td></tr>
        <tr><td>SAML / SCIM</td><td class="num-col">—</td><td class="num-col">—</td><td class="num-col">✓</td></tr>
        <tr><td>Dedicated infra</td><td class="num-col">—</td><td class="num-col">—</td><td class="num-col">✓</td></tr>
        <tr style="border-top: 1px solid var(--fg);">
          <td><strong>Monthly</strong></td>
          <td class="num-col"><strong>$0</strong></td>
          <td class="num-col"><strong>$4 / seat</strong></td>
          <td class="num-col"><strong>Talk to us</strong></td>
        </tr>
      </tbody>
    </table>
  </div>
</section>
```

## Layout 9 — Split detail (story / how it works)

Text on one side, a real visual or a short ordered list on the other. Flip `grid-1-2` ↔ `grid-2-1` when used twice on one page so the weight alternates.

```html
<section class="section" data-section="detail">
  <div class="container grid-1-2">
    <div>
      <p class="eyebrow">HOW IT WORKS</p>
      <h2>Name the one mechanism that makes this work.</h2>
    </div>
    <div class="stack">
      <div class="card-rule">
        <h3>Step one, in the reader's words</h3>
        <p style="margin: 6px 0 0; color: var(--muted);">One or two sentences with a concrete example.</p>
      </div>
      <div class="card-rule">
        <h3>Step two</h3>
        <p style="margin: 6px 0 0; color: var(--muted);">One or two sentences with a concrete example.</p>
      </div>
      <div class="card-rule">
        <h3>Step three</h3>
        <p style="margin: 6px 0 0; color: var(--muted);">One or two sentences with a concrete example.</p>
      </div>
    </div>
  </div>
</section>
```

## Layout 10 — Registration form (event sign-up, waitlist)

Facts on the left (date, place, agenda in `.meta`), the form on the right in one `.card`. Ask only for what the organiser actually needs — every extra field costs sign-ups. The form is a mock: no `action`, no script.

```html
<section class="section" data-section="register">
  <div class="container grid-2" style="align-items: start;">
    <div class="stack">
      <p class="eyebrow">REGISTER</p>
      <h2>Save your seat.</h2>
      <p class="lead">Who it is for and what they leave with, in one sentence.</p>
      <div>
        <p class="meta" style="margin: 0;">DATE · [REPLACE]</p>
        <p class="meta" style="margin: 4px 0 0;">VENUE · [REPLACE]</p>
        <p class="meta" style="margin: 4px 0 0;">SEATS · [REPLACE]</p>
      </div>
    </div>
    <form class="card stack" onsubmit="return false">
      <div class="field"><label for="f-name">Name</label><input class="input" id="f-name" /></div>
      <div class="field"><label for="f-mail">Email</label><input class="input" id="f-mail" type="email" /></div>
      <div class="field"><label for="f-note">What do you want to get out of it?</label><textarea class="textarea" id="f-note"></textarea></div>
      <button class="btn btn-primary" type="submit">Register</button>
    </form>
  </div>
</section>
```

## Layout 11 — Entry grid (docs sections, product lines)

Hairline-topped cells, no boxes. Each cell is a destination: a title, one line of what you find there, and a ghost link. Use `grid-3` for 3 or 6 entries, `grid-2` for 4.

```html
<section class="section" data-section="entries">
  <div class="container stack" style="gap: 40px;">
    <h2>Start where you are.</h2>
    <div class="grid-3">
      <a class="card-rule" href="#">
        <h3>Get started</h3>
        <p style="margin: 6px 0 12px; color: var(--muted);">Install, sign in, ship the first thing in ten minutes.</p>
        <span class="meta">Read →</span>
      </a>
      <a class="card-rule" href="#">
        <h3>Guides</h3>
        <p style="margin: 6px 0 12px; color: var(--muted);">Task-shaped walkthroughs for the common jobs.</p>
        <span class="meta">Read →</span>
      </a>
      <a class="card-rule" href="#">
        <h3>API reference</h3>
        <p style="margin: 6px 0 12px; color: var(--muted);">Every endpoint, parameter and error code.</p>
        <span class="meta">Read →</span>
      </a>
    </div>
  </div>
</section>
```

---

## Section rhythm — when in doubt

Two stat rows in a row, two quote blocks in a row, two feature triplets in a row — all visual fatigue. Alternate dense and breathing sections. The per-template rhythms live in `GUIDE.md`.
