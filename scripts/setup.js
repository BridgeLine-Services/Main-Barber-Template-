const { execFileSync } = require('node:child_process')
const process = require('node:process')

const run = (command, args) => execFileSync(command, args, { stdio: 'inherit' })
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'

function checkNode() {
  const [major] = process.versions.node.split('.').map(Number)
  if (major < 18) throw new Error(`Node.js 18 or newer is required. Found ${process.versions.node}.`)
}

function main() {
  console.log('\n========================================\n BARBER TEMPLATE SETUP\n========================================\n')
  checkNode()
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is missing.\n\nAdd your PostgreSQL/Neon database connection string to the environment before continuing.')
  }
  console.log('Environment ..................... OK')
  console.log('Database connection ............. checking')
  run(npm, ['exec', '--', 'prisma', 'migrate', 'deploy'])
  console.log('Prisma migrations ............... OK')
  run(npm, ['exec', '--', 'prisma', 'generate'])
  console.log('Prisma Client ................... OK')
  run(npm, ['run', 'db:verify'])
  console.log('Database verification ........... OK')
  console.log('\n========================================\n SETUP COMPLETE\n========================================\n\nThe Barber Template is ready. Complete the first-run setup wizard in the application.\n')
}

try { main() } catch (error) {
  console.error(`\nSETUP FAILED\n${error.message}\n\nNo destructive database reset was performed. Check DATABASE_URL and run npm run db:doctor for diagnostics.\n`)
  process.exitCode = 1
}
