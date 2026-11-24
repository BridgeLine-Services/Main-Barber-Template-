import { prisma } from '@/lib/prisma'
import { postgresMajor } from './installed-versions'

/** Returns the actual PostgreSQL server major version, or null when it cannot be read. */
export async function readLivePostgresMajor(): Promise<string | null> {
  try {
    const rows = await prisma.$queryRaw<Array<{ server_version: string }>>`SELECT current_setting('server_version') AS server_version`
    return postgresMajor(rows[0]?.server_version)
  } catch {
    return null
  }
}
