# Node 24 LTS migration (Phase 2)

Baseline `ad0ddb7` ran Node 20.20.2, which is past end-of-life. Target: Node 24 LTS
("Krypton"), 24.22.3 tested.

Nothing was upgraded. `package.json` dependencies are unchanged, so this is a runtime
change only, which is the smallest possible blast radius for the riskiest class of
change in the program.

## What was verified before any file changed

The 24.22.3 Linux x64 build was installed beside the existing runtime and used to run
the application as-is, against a freshly created database built from the full migration
chain (`prisma migrate deploy`) and seeded in demo mode. Mixing Node 24 with the old
sandbox database was tried first and failed, but the failure was the database: that
cluster no longer held the `barber` database the tests expect. On the clean database
every suite passed, which is what demonstrates runtime compatibility.

| Check | Node 24.22.3 |
| --- | --- |
| `prisma generate` | PASS |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS, 0 errors, 98 warnings |
| `npm run build` | PASS, compiled successfully |
| `npm run architecture:check` | PASS, 626 files |
| `npm run test:architecture` | PASS |
| `npm run test:booking` | 20 passed, 0 failed |
| `npm run test:permissions` | 37 passed, 0 failed |
| `npm run test:tenant` | 22 passed, 0 failed |
| `npm run test:reliability` | 5 passed, 0 failed |
| `npm run test:optional-integrations` | 20 passed, 0 failed |
| theme sanitisation | 64 passed, 0 failed |
| visual config | 78 passed, 0 failed |
| home modules | 50 passed, 0 failed |
| RLS enforcement | 42 passed, 0 failed |

Prisma 6.19.3, Next 16.4.6 and React 19.3.0 all ran unmodified on 24.22.3.

## What changed

- `package.json`: `engines.node` is `>=24`.
- `.github/workflows/ci.yml`: both jobs use `node-version: 24`.
- `.github/workflows/architecture.yml`: `node-version: 24`.
- `README.md`: the requirement line now states Node 24 LTS and explains why.
- `.nvmrc`: `24`.

The three backup workflows already ran Node 22 and were left alone: they are not part of
the build, they were already working, and changing them would be risk without evidence.

## Node 26

Not adopted. Next 16 and Prisma 6 are not documented as supported on 26, and the program
asks for 24 LTS as the initial target. Evaluating 26 later is a separate, isolated
change with the same evidence standard.

## Rollback

Revert this commit. The application code is untouched, so reverting restores Node 20
behaviour exactly, with no database change and no data implication.
