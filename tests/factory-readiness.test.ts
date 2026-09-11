import { evaluateFactoryReadiness, type FactorySnapshot } from '../src/lib/production-readiness'

let passed = 0
let failed = 0
function assert(condition: boolean, message: string) {
  if (condition) { console.log(`  PASS ${message}`); passed++ }
  else { console.error(`  FAIL ${message}`); failed++ }
}

function snapshot(overrides: Partial<FactorySnapshot> = {}): FactorySnapshot {
  return {
    databaseAvailable: true,
    business: {
      name: 'Example Cuts', slug: 'example-cuts', timezone: 'America/Los_Angeles',
      phone: '5555555555', email: 'owner@example.com', primaryColor: '#111111',
      accentColor: '#d4af37', secondaryColor: '#222222', onboardingCompleted: true,
      customerRescheduleMinNoticeHours: 24, customerRescheduleWindowDays: 30,
    },
    services: [{ isActive: true, price: 35, duration: 30 }],
    barbers: [{ isActive: true, schedules: [{ isOff: false, startTime: '09:00', endTime: '17:00' }] }],
    app: { production: true, databaseConfigured: true, authConfigured: true, appUrlConfigured: true },
    features: {
      email: { enabled: false, configured: false, missing: [] },
      sms: { enabled: false, configured: false, missing: [] },
      google: { enabled: false, configured: false, missing: [] },
      reminders: { enabled: false, configured: false, missing: [] },
    },
    ...overrides,
  }
}

const checks = (input: FactorySnapshot) => evaluateFactoryReadiness(input)
const has = (input: FactorySnapshot, check: string, status: string) => checks(input).some((item) => item.check === check && item.status === status)

assert(!checks(snapshot()).some((item) => item.status === 'FAIL'), 'valid client configuration passes')
assert(has(snapshot({ business: null }), 'Business information', 'FAIL'), 'missing business information fails')
assert(has(snapshot({ services: [] }), 'Active services', 'FAIL'), 'no services fails readiness')
assert(has(snapshot({ barbers: [] }), 'Active barber', 'FAIL'), 'no active barber fails readiness')
assert(has(snapshot({ barbers: [{ isActive: true, schedules: [] }] }), 'Weekly schedules', 'FAIL'), 'missing barber schedules fails readiness')
assert(has(snapshot(), 'email', 'WARN'), 'disabled email does not block readiness')
assert(has(snapshot({ features: { ...snapshot().features, email: { enabled: true, configured: false, missing: ['SMTP_HOST'] } } }), 'email', 'FAIL'), 'enabled email without credentials blocks readiness')
assert(has(snapshot(), 'sms', 'WARN'), 'disabled SMS does not block readiness')
assert(has(snapshot({ features: { ...snapshot().features, sms: { enabled: true, configured: false, missing: ['TWILIO_AUTH_TOKEN'] } } }), 'sms', 'FAIL'), 'enabled SMS without credentials blocks readiness')
assert(has(snapshot({ app: { ...snapshot().app, production: false } }), 'Production mode', 'FAIL'), 'demo mode cannot be production-ready')
assert(!JSON.stringify(checks(snapshot())).match(/SECRET|TOKEN|PASSWORD|SMTP_PASS/i), 'readiness results contain no secret values')

console.log(`\nFactory readiness tests: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
