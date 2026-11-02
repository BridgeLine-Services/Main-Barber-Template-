# Content-Security-Policy evaluation — inline allowances

Status: **evaluated, migration NOT shipped.** Reason below. This document is the
evidence trail required before a nonce migration is attempted.

## Current policy (src/proxy.ts)

```
default-src 'self';
script-src 'self' 'unsafe-inline'  (+ 'unsafe-eval' in development only);
style-src 'self' 'unsafe-inline';
img-src 'self' data: https://*.public.blob.vercel-storage.com;
font-src 'self' data:; connect-src 'self';
frame-src 'self' https://www.google.com https://maps.google.com;
frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self';
```

Already tight: no wildcard script hosts, `object-src`/`base-uri` locked down,
`frame-ancestors 'none'` (with a scoped `'self'` exception for the dashboard
preview route only, verified in production).

## What actually depends on the inline allowances

| Allowance | Depended on by | Removable? |
| --- | --- | --- |
| `style-src 'unsafe-inline'` | `ThemeStyle.tsx` and the dashboard layout emit **generated** CSS through `dangerouslySetInnerHTML`; React also writes `style` attributes from props | **No.** The CSS is per-business and regenerated on every save, so there is nothing stable to hash. Removing it breaks all branding, previews and dashboard theming. |
| `script-src 'unsafe-inline'` | Next.js App Router inlines its bootstrap/hydration script in the HTML | **Yes, with a nonce.** Next 16 reads a nonce from the CSP **request** header and stamps its own scripts with it. |
| `script-src 'unsafe-eval'` | React dev-mode JIT only | Already excluded from production. |

## What was implemented (and how it was verified)

`src/lib/csp.ts` now builds the policy for both modes and is covered by
`tests/csp.test.ts` (25 assertions): default mode keeps `'unsafe-inline'` and no
nonce, nonce mode drops `'unsafe-inline'` from `script-src` only and never leaks
a nonce into `style-src`, `frame-ancestors` stays `'none'` except the preview
route, and only the literal string `true` enables the flag.

`src/proxy.ts` generates the nonce per request, puts the same policy on the
**request** header (so Next stamps its inline bootstrap) and on the response,
and keeps the preview route's `X-Frame-Options: SAMEORIGIN` exception.

Executed evidence with the flag ON in this environment:

| Check | Result |
| --- | --- |
| Response policy contains `'nonce-…' 'strict-dynamic'` | yes |
| Nonce in the header equals the nonce on the HTML script tag (single response) | match |
| Static chunks loaded under `strict-dynamic` | 26 resources |
| Scripts carrying the nonce | 15 |
| Browser CSP violations / refused scripts | **0** |
| Default mode (flag off) header on `/` | identical to the previous policy |
| Preview route header (flag off) | `X-Frame-Options: SAMEORIGIN` preserved |

Regression caught during the refactor: the first version of the change dropped
the preview route's `X-Frame-Options` override, which would have re-broken the
dashboard preview iframe. It was caught by comparing live headers before
committing and restored.

## Why the flag is still off in production

A nonce rollout is not a header edit — it requires:

1. Generating a per-request nonce in `src/proxy.ts`.
2. Setting the nonce into **both** the request header (so Next stamps its
   scripts) and the response header.
3. `'strict-dynamic'` so scripts loaded by the nonced bootstrap keep working.
4. Verifying **every** rendering surface: public site, `/book` wizard, customer
   portal, dashboard (all tabs), the website preview iframe, and the print/
   calendar export paths — because a single un-nonced inline script silently
   breaks hydration, and a broken hydration looks exactly like "the page loads".

This environment could not complete step 4 exhaustively: the sandbox tenant
renders "Coming Soon" (unpublished shop), so the booking wizard, customer portal
and published public pages are not reachable here, and there is no staging
deployment available to me. The pages that could be exercised (/login, /,
/services and the dashboard) showed zero refused scripts, which is encouraging
but not the whole surface. Turning the flag on in production needs the staging
pass below.

## Migration plan (for staging)

1. Add the nonce wiring behind an env flag `CSP_NONCE_ENABLED` (default off) so
   it can be switched per environment and reverted by config, not by deploy.
2. Enable in staging; run: full `test:e2e`, the accessibility suite, and a manual
   pass over the surfaces listed above while watching the console for
   `Refused to execute inline script`.
3. Confirm hydration on `/dashboard`, `/book`, `/portal`, the preview iframe and
   the customer site at two viewports.
4. Only then enable in production, and keep the flag so it can be turned off
   without a code change.

## What is not at risk today

- No third-party script hosts are allowed, so there is no supply-chain script
  channel to hijack.
- All outputs that interpolate user data (themes, colours, fonts) are already
  validated (see `tests/theme-sanitization.test.ts`, 64 assertions) — the
  `'unsafe-inline'` allowance is not the only defence against injected CSS.
- `frame-ancestors none`, `object-src none`, `base-uri self` and `form-action
  self` stay as they are.
