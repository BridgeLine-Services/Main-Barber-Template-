# Template versions and controlled updates

Part 8 of the expansion directive. This adds identity and a proposal process to the
existing five-step delivery workflow. It does not replace that workflow and it does not
create any way for a client copy to change on its own.

## 1. Every copy can say what it is running

`TEMPLATE-VERSION.json` at the repository root is the machine-readable identity:

| Field | Meaning |
| --- | --- |
| `version` | Semantic version of the template |
| `releasedAt` | Date of the release |
| `sourceCommit` | Commit the release was cut from, written by `npm run template:stamp` |
| `compatibleAppVersion` | Application version this template release belongs to |
| `requiredNodeMajor` | Minimum Node.js major version |
| `schemaMigrationCount` | How many migrations the release contains |

`src/lib/template-version.ts` mirrors it for the running app; a test fails if the two
disagree. Owners can see it on the Maintenance page, and at
`GET /api/dashboard/template-version` (owner-only).

## 2. Checking for an update

```
npm run template:version     # what this copy is
npm run template:check       # compare with upstream, print a proposal
```

`template:check` reads the upstream `TEMPLATE-VERSION.json`, asks GitHub which files
changed between the two release commits, and classifies them. It writes nothing. If the
upstream cannot be reached it exits non-zero and says so, because "could not check" is not
"up to date".

## 3. What the proposal tells you

- **Migrations** — any `prisma/migrations/` change. Never applied automatically. Risk
  becomes `approval`, and the first step is a backup.
- **Security files** — `src/proxy.ts`, `src/lib/auth-helpers.ts`, `permissions.ts`,
  `tenant.ts`, `passwords.ts`, `auth.ts`, `prisma/rls/`, rate limiting. Also `approval`.
- **Dependencies** — `package.json` and lockfiles. Risk at least `review`; the test suite
  runs after the change.
- **Yours to merge by hand** — `.env*`, `vercel.json`, `next.config`, `config/`, and
  `TEMPLATE-VERSION.json`. These hold a shop's own configuration and are never overwritten.
- **Removals** — a deleted file is always `review`, because something may still import it.

## 4. The order of work, and who says yes

1. Read the changed files.
2. Back up the database if any migration is involved.
3. Apply the change on a branch in the client's own repository.
4. Run `npm run test:ci`, `npm run typecheck`, `npm run build`, `npm run architecture:check`.
5. Get approval for anything classified `approval`.
6. Deploy through the client's normal process.
7. Roll back by reverting the merge commit; a migration is rolled back by restoring the
   backup, never by editing production data.

## 5. What this process will never do

- Never overwrite a client's configuration, branding, services, staff or any business data.
- Never overwrite production secrets.
- Never apply a migration automatically.
- Never merge on its own, and never force-push.
- Never make a client installation depend on the master repository being online: booking,
  payments and the dashboard keep working whether or not anyone checks for updates.
