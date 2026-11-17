# Accessibility review (automated pass, 2026-11-17)

Status: **automated pass complete, independent human review still outstanding.**
No page markup was changed in this round. Everything below is a finding to act on
deliberately, not a list of things that were "fixed" by guessing at a browser.

## What was run

`npm run test:a11y:static` (`scripts/a11y-static.mjs`) against a production build
on `http://127.0.0.1:3210`, 7 pages that render for a stranger: `/`, `/book`,
`/login`, `/services`, `/shop`, `/terms`, `/privacy`. `/register` was skipped
because it correctly redirects to `/login` for an anonymous visitor.

The audit is browser-free on purpose: it runs in CI and in environments where
Playwright browsers are not installed, so the accessibility gate is never silently
skipped. It checks the failures that make a shop unusable with a screen reader or
keyboard: page language, image `alt`, form-control labels, button and link
accessible names, positive `tabindex`, plus heading and landmark structure.

Result: **0 violations, 7 structural notes.** The notes are all the same shape:
the public template pages do not expose a `<main>` landmark, and `/login` renders
two `<h1>` elements.

## Why the notes are not auto-fixed

Adding a `<main>` wrapper or restyling a heading is a markup change on shared
public layouts, and this work is bound by a zero-regression rule: a wrapper can
change layout through existing child selectors, and nobody has yet seen the pages
in a browser at more than one width. Two of the notes (`/login` two `<h1>`s) also
come from a client component that renders during hydration, so the correct fix is
a design decision (which heading is the page title?) rather than a parser patch.

Recording an honest finding is better than a cosmetic change nobody verified.

## Findings for the accessibility pass

| # | Page | Finding | Suggested fix | Risk |
| --- | --- | --- | --- | --- |
| 1 | `/`, `/book`, `/services`, `/shop`, `/terms`, `/privacy` | no `<main>` landmark, so "skip to content" and landmark navigation do not work | wrap the primary content region in `<main id="main">`, add a skip link | low, but needs a browser check at 360 px and 1280 px |
| 2 | `/login` | two `<h1>` elements | keep one `<h1>` (the form's title) and demote the other to `<h2>` | low |
| 3 | all | no focus-order test yet | Playwright keyboard walk of the booking flow | needs browsers |

## What the automated pass cannot prove

- Contrast: needs the rendered theme, both light and dark.
- Focus visibility, focus order and keyboard traps.
- Screen-reader announcements (order, labels, live regions).
- Zoom to 200% and reflow at 320 px.
- That the plain-language error copy is understood by a real shop owner.

These need a person with a browser and, ideally, a screen reader. `test:a11y` (the
Playwright suite at `e2e/accessibility.spec.ts`) requires browsers that are not
installed here; it was **not** run this round.

## How to close this

1. Run `npm run build && npx next start -p 3210`, then
   `npm run test:a11y:static -- --base http://127.0.0.1:3210` (add `--strict` to
   fail on the structural notes too).
2. Install browsers once (`npx playwright install chromium`) and run
   `npm run test:a11y` plus a manual keyboard walk of booking and cancellation.
3. Fix findings 1 and 2 in one small commit, re-run both suites, and check the
   pages at 360 px and 1280 px before merging.
4. Ask an independent person to attempt a booking with a screen reader. Record the
   date and what they found. Until that happens, this document says automated-only,
   because that is the truth.
