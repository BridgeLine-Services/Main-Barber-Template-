# Dependency audit (Requirement 34)

`npm audit --omit=dev` (2026-09-29, after the Next 16 upgrade):
**0 production vulnerabilities.**

## Upgrades completed (2026-09-29)

| Package | From → To | Advisory cleared |
|---------|-----------|-------------------|
| next | 14.2.35 → **16.3.6** | CRITICAL: self-hosted Image Optimizer DoS via remotePatterns config |
| postcss (via next) | transitive | HIGH: XSS via unescaped `</style>` in stringify output |
| nodemailer | 6.10.1 → **10.0.12** | HIGH: email to an unintended domain via interpretation conflict |
| prisma / @prisma/client | 5.19.0 → **6.19.3** | none (5.x past end-of-support; proactive major) |

## How the upgrade was verified

Framework double-major (next 14 → 16, react 18 → 19) verified with:

- `@next/codemod next-async-request-api` applied (25 files: `params` /
  `searchParams` now awaited in dynamic route handlers and pages).
- ESLint migrated to flat config (`eslint.config.mjs`, eslint 9) with the
  pre-upgrade severity policy preserved; previously-unenforced v16 preset
  rules (`no-explicit-any`, `no-unused-vars`, new react-hooks v6 rules)
  are tracked as follow-up warnings, not hidden.
- `next dev` runtime smoke: credentials login via next-auth, authenticated
  dashboard APIs (`settings`, `services`, `barbers`, `audit-logs`,
  `appointments`), SSR dashboard layout access gate, middleware
  `x-pathname` stamp — all working under async request APIs.
- Full CI battery (23 suites) green; live-server suites green
  (PWA 22/22, notification resilience 16/16 against a running Next 16
  server).
- Production build compiles (24 static pages) with the production env vars.
- next-auth remains on v4 (4.24.x is compatible with Next 16's async
  headers in this codebase's usage); a future v5/Auth.js migration is
  optional, not required for security.

## CI enforcement

`.github/workflows/ci.yml` now runs
`npm audit --omit=dev --audit-level=critical` after `npm ci`, so any new
critical production advisory fails the build. Dev-only advisories are
excluded (`--omit=dev`) as they do not ship to production.


## 2026-11-05 — minimatch denial-of-service (dev toolchain)

**Advisory:** GHSA-g3hv-75wg-m249 / CVE-2026-118764 — denial of service through glob-pattern
expansion. Vulnerable range 7.0.0 - 11.0.0; patched from 11.0.1.

**Where it was:** `eslint-config-next@16.4.2` → `typescript-eslint@8.71.0` →
`@typescript-eslint/typescript-estree@8.71.0` → `minimatch@10.2.6`. Development dependency
only: `npm audit --omit=dev` reported 0 vulnerabilities before and after.

**Why the Dependabot fixes failed:** the only path npm could offer was downgrading
`eslint-config-next` to 15.5.29, a major step backwards. That was refused.

**Why no upstream upgrade exists:** the newest stable
`@typescript-eslint/typescript-estree` (8.72.1, and 8.72.2-alpha.11) still declares
`minimatch: ^10.2.2`, which cannot resolve to 11.x. There is no released version of the
eslint toolchain that accepts the patched line today.

**What was done instead:** a single scoped override, not a flat one:

```json
"overrides": {
  "@typescript-eslint/typescript-estree": { "minimatch": "^11.0.5" }
}
```

A flat `"minimatch"` override was rejected because three other consumers (eslint,
eslint-plugin-import, eslint-plugin-react) legitimately need 3.1.5 and would break.

**Why this override is safe rather than merely accepted by npm:** the entire usage is one
call site.

```
node_modules/@typescript-eslint/typescript-estree/dist/useProgramFromProjectService.js:244
  minimatch(filePath, pattern, { dot: true })
```

The named `minimatch` export and the `{ dot: true }` option are unchanged in v11. Verified
directly against the installed copy (`11.0.5`): `lib/**/*.ts` matches `lib/foo/bar.ts`,
`**/*.ts` matches `src/.hidden/x.ts` with `dot: true`, and literal paths match themselves.
`minimatch@11` requires Node 20 or newer, which is the CI and project floor (`engines.node >= 20`).
Lint then ran over the full codebase with 0 errors.

**Result:** `minimatch@10.2.6` is gone from the tree; `11.0.5` is installed under
`typescript-estree`; `3.1.5` remains for its own consumers. The moderate finding is cleared.

**Remaining dev-tool advisories, deliberately not fixed here:**

| Advisory | Path | Severity | Why not now |
| --- | --- | --- | --- |
| DeepmergeTS stack exhaustion (GHSA-ggr8-5vv4-36mx) | `prisma@6.19.3` → `@prisma/config` → `deepmerge-ts` | high | Only fix is `prisma@7.10.1`, a major ORM upgrade. This release pass may not change the database architecture. Design, migrate and test as its own change. |

Because that high finding remains in the **development** tree, the all-dependency
`npm audit --audit-level=moderate` step was **not** added to CI: it would fail on a
dev-only Prisma advisory unrelated to the minimatch defect. The existing production gate
(`npm audit --omit=dev --audit-level=high`, 0 vulnerabilities) is unchanged.
