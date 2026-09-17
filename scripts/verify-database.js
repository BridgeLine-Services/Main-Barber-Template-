const { PrismaClient } = require('@prisma/client')

const prisma = new PrismaClient()

const requiredTables = {
  User: ['id', 'email', 'passwordHash', 'role'],
  Business: ['id', 'name', 'slug', 'onboardingCompleted'],
  Barber: ['id', 'businessId'],
  Customer: ['id', 'businessId'],
  Appointment: ['id', 'startTime', 'endTime', 'status', 'businessId', 'barberId'],
}

async function main() {
  console.log('\nDatabase Verification\n')
  const tables = await prisma.$queryRaw`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
  `
  const available = new Set(tables.map(({ table_name, column_name }) => `${table_name}.${column_name}`))
  let failed = false

  for (const [table, columns] of Object.entries(requiredTables)) {
    const tableExists = [...available].some((entry) => entry.startsWith(`${table}.`))
    if (!tableExists) {
      console.log(`${table.padEnd(24, '.')} MISSING`)
      failed = true
      continue
    }
    console.log(`${table.padEnd(24, '.')} OK`)
    for (const column of columns) {
      const ok = available.has(`${table}.${column}`)
      console.log(`  ${`${table}.${column}`.padEnd(22, '.')} ${ok ? 'OK' : 'MISSING'}`)
      failed ||= !ok
    }
  }

  if (failed) {
    throw new Error('Database verification failed. Run npm run db:doctor for diagnostics.')
  }
  console.log('\nDatabase verification successful.\n')
}

main().catch((error) => {
  console.error(`\nDatabase verification failed: ${error.message}\n`)
  process.exitCode = 1
}).finally(() => prisma.$disconnect())
