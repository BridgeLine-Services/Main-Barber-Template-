import { PrismaClient } from '@prisma/client'
import { provisionBusiness, verifyProvisionedBusiness } from '../src/lib/provision-business'

const prisma = new PrismaClient()
const businessName = process.env.SEED_BUSINESS_NAME ?? 'Your Barber Shop'
const slug = process.env.SEED_BUSINESS_SLUG ?? businessName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
const ownerEmail = process.env.SEED_OWNER_EMAIL ?? `owner@${slug}.com`
const ownerPassword = process.env.SEED_OWNER_PASSWORD

if (!ownerPassword) throw new Error('SEED_OWNER_PASSWORD is required for non-destructive provisioning.')

const result = await provisionBusiness(prisma, {
  business: {
    name: businessName,
    slug,
    email: process.env.SEED_BUSINESS_EMAIL,
    phone: process.env.SEED_BUSINESS_PHONE,
    city: process.env.SEED_BUSINESS_CITY,
    state: process.env.SEED_BUSINESS_STATE,
    timezone: process.env.SEED_TIMEZONE,
  },
  owner: { email: ownerEmail, name: `${businessName} Owner`, password: ownerPassword },
  services: [
    { name: 'Haircut', description: 'Precision haircut including consultation and styling.', duration: 30, price: 35, order: 1 },
    { name: 'Haircut + Beard', description: 'Full haircut combined with beard trim and shaping.', duration: 45, price: 50, order: 2 },
    { name: 'Beard Trim', description: 'Beard sculpting with razor edge-up and hot towel.', duration: 20, price: 25, order: 3 },
  ],
  barbers: [
    { name: 'Barber One', slug: `${slug}-barber-one`, order: 1 },
    { name: 'Barber Two', slug: `${slug}-barber-two`, order: 2 },
  ],
  mode: (process.env.APP_MODE ?? 'production') === 'demo' ? 'demo' : 'production',
})
const verification = await verifyProvisionedBusiness(prisma, result.businessId, { ownerEmail, barberCount: 2, serviceCount: 3 })
console.log(JSON.stringify({ ...result, verification }, null, 2))
if (!verification.success) process.exitCode = 1
await prisma.$disconnect()
