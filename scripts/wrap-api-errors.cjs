/* Wraps every exported HTTP handler in dashboard API routes with a shared
 * try/catch that returns valid JSON via handleApiError. Skips handlers that
 * already start with a try statement (already guarded). Idempotent. */
const ts = require('typescript')
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..', 'src', 'app', 'api', 'dashboard')
const HANDLERS = new Set(['GET', 'POST', 'PATCH', 'PUT', 'DELETE'])
const HELP = `import { handleApiError } from '@/lib/api-errors'`

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (e.name === 'route.ts') out.push(p)
  }
  return out
}

let changed = 0, skipped = 0
for (const file of walk(ROOT)) {
  const rel = file.replace(/^.*src\/app\/api\/dashboard\//, '').replace(/\/route\.ts$/, '')
  const src = fs.readFileSync(file, 'utf8')
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true)
  const lines = src.split('\n')

  // collect exported function declarations + their line ranges
  const targets = []
  for (const stmt of sf.statements) {
    const hasExport = stmt.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)
    if (!hasExport || stmt.kind !== ts.SyntaxKind.FunctionDeclaration) continue
    const name = stmt.name?.text
    if (!HANDLERS.has(name)) continue
    const body = stmt.body
    if (!body) continue
    const first = body.statements[0]
    const already = first && first.kind === ts.SyntaxKind.TryStatement
    targets.push({ name, startLine: body.getStart(sf), endLine: body.getEnd(), already })
  }
  if (!targets.some(t => !t.already)) { skipped++; continue }

  // rewrite from the last function to the first
  targets.sort((a, b) => b.startLine - a.startLine)
  for (const t of targets) {
    if (t.already) continue
    const startPos = sf.getLineAndCharacterOfPosition(t.startLine)
    const s = startPos.line // 0-based line of the body's '{'
    const e = sf.getLineAndCharacterOfPosition(t.endLine - 1).line // line of the body's '}'
    const openBrace = startPos.character
    const inner = lines.slice(s, e + 1)
    // body text between the outer braces
    const bodyFirst = inner[0].slice(openBrace + 1)
    const bodyLast = inner[inner.length - 1]
    const closeIdx = bodyLast.lastIndexOf('}')
    const tail = bodyLast.slice(0, closeIdx)
    const core = [bodyFirst, ...inner.slice(1, -1), tail].filter(x => x !== '').join('\n')
    const indented = core.split('\n').map(l => (l.trim() === '' ? '' : '  ' + l)).join('\n')
    const wrapped = [
      lines[s].slice(0, openBrace + 1),
      `  try {`,
      indented,
      `  } catch (error) {`,
      `    return handleApiError(error, '${t.name} /api/dashboard/${rel}')`,
      `  }`,
      bodyLast.slice(closeIdx),
    ].join('\n')
    lines.splice(s, e - s + 1, wrapped)
    changed++
  }

  let out = lines.join('\n')
  if (!out.includes("@/lib/api-errors'")) {
    // insert after the last top-level import
    const importEnd = Math.max(...out.split('\n').map((l, i) => (/^import .*from .*$/.test(l) ? i : -1)))
    const importLines = out.split('\n')
    importLines.splice(importEnd + 1, 0, HELP)
    out = importLines.join('\n')
  }
  fs.writeFileSync(file, out)
}
console.log(`wrapped handlers: ${changed}, files untouched(already guarded): ${skipped}`)
