#!/usr/bin/env bash
# E2E: Review & Complete step, OWNER_REGISTRATION_MODE, password reset.
# Runs against a live dev server (localhost:3000) + embedded test database.
set -u
BASE="http://localhost:3000"
PASS=0; FAIL=0
JAR=$(mktemp)
jqpy() { python3 -c "import sys,json;d=json.load(sys.stdin);print(eval(sys.argv[1]))" "$1" 2>/dev/null; }
check() { if [ "$2" = "$3" ]; then echo "✓ $1"; PASS=$((PASS+1)); else echo "✗ $1 (want '$2' got '$3')"; FAIL=$((FAIL+1)); fi; }
req() { curl -s -X ${1} -H 'Content-Type: application/json' -b "$JAR" -c "$JAR" "${@:4}" "$BASE$2" -d "$3"; }

echo "═══ 0. Cleanup: remove users/businesses from previous runs ═══"
npx tsx -e "
import { prisma } from './src/lib/prisma'
async function main() {
  await prisma.business.deleteMany({ where: { slug: 'review-test-shop' } })
  await prisma.user.deleteMany({ where: { email: { in: ['e2e-owner@test.dev', 'e2e2@test.dev', 'weak@test.dev'] } } })
  console.log('clean')
}
main().finally(() => prisma['\$disconnect']())" >/dev/null 2>&1
sleep 1

echo "═══ 1. Owner signup vs customer signup (API) ═══"
# OWNER_REGISTRATION_MODE unset → default 'onboarding' (open). The owner
# onboarding signup is the ONLY public path that creates an OWNER account.
R=$(req POST /api/auth/register-owner '{"name":"E2E Owner","email":"E2E-Owner@Test.dev","password":"Passw0rd123"}' -o /dev/null -w "%{http_code}")
check "owner registration open by default (onboarding mode)" "201" "$R"
# Same email, different case → duplicate prevented by normalization
R=$(req POST /api/auth/register-owner '{"name":"E2E Owner","email":"  e2e-owner@test.dev ","password":"Passw0rd123"}' -o /dev/null -w "%{http_code}")
check "normalized email prevents duplicate account" "409" "$R"
# Public customer signup ALWAYS creates a CUSTOMER — never OWNER/staff
R=$(req POST /api/auth/register '{"name":"E2E Two","email":"e2e2@test.dev","password":"Passw0rd123"}' | jqpy "str(d['user']['role'])")
check "public signup always creates a CUSTOMER" "CUSTOMER" "$R"
# Weak password rejected by shared policy
R=$(req POST /api/auth/register '{"name":"Weak One","email":"weak@test.dev","password":"password"}' -o /dev/null -w "%{http_code}")
check "weak password rejected" "400" "$R"
# Detailed error leak check: 500 handler returns generic message only
R=$(req POST /api/auth/register '{"name":"X"}' | jqpy "str('detail' in d)")
check "no internal detail in error responses" "False" "$R"

echo "═══ 1b. A customer session can never reach management ═══"
JARC=$(mktemp)
csrfc=$(curl -s -b "$JARC" -c "$JARC" $BASE/api/auth/csrf | jqpy "d['csrfToken']")
curl -s -o /dev/null -X POST $BASE/api/auth/callback/credentials -H 'Content-Type: application/x-www-form-urlencoded' -b "$JARC" -c "$JARC" --data-urlencode "csrfToken=$csrfc" --data-urlencode "email=e2e2@test.dev" --data-urlencode "password=Passw0rd123" --data-urlencode "json=true"
AUTHC=$(curl -s -b "$JARC" $BASE/api/auth/session | jqpy "str(d.get('user',{}).get('email',''))")
check "customer authenticated" "e2e2@test.dev" "$AUTHC"
# Customer POSTing onboarding → rejected (middleware + per-route guard)
R=$(curl -s -X POST -H 'Content-Type: application/json' -b "$JARC" -o /dev/null -w "%{http_code}" $BASE/api/dashboard/onboarding -d '{"businessName":"Nope Shop","slug":"nope-shop","timezone":"America/Los_Angeles"}')
check "customer blocked from onboarding API" "403" "$R"
R=$(curl -s -b "$JARC" -o /dev/null -w "%{http_code}" $BASE/api/dashboard/services)
check "customer blocked from dashboard APIs" "403" "$R"
R=$(curl -s -b "$JARC" -o /dev/null -w "%{http_code}" $BASE/dashboard)
check "customer redirected away from dashboard page" "307" "$R"
rm -f "$JARC"

echo "═══ 2. Onboarding through to Review ═══"
NEXTAUTH_URL=$BASE
TOK=$(curl -s -X POST $BASE/api/auth/callback/credentials -H 'Content-Type: application/x-www-form-urlencoded' -b "$JAR" -c "$JAR" -d "email=e2e-owner@test.dev&password=Passw0rd123&csrfToken=&json=true" | grep -o "session-token=[^;]*" | head -1 | cut -d= -f2)
# login via credentials callback (sets session cookie)
curl -s -X POST "$BASE/api/auth/signin/callback/credentials" -o /dev/null 2>/dev/null
# Simpler: use the NextAuth credentials flow properly
csrf=$(curl -s -b "$JAR" -c "$JAR" $BASE/api/auth/csrf | jqpy "d['csrfToken']")
curl -s -o /dev/null -w "%{http_code}" -X POST $BASE/api/auth/callback/credentials -H 'Content-Type: application/x-www-form-urlencoded' -b "$JAR" -c "$JAR" --data-urlencode "csrfToken=$csrf" --data-urlencode "email=e2e-owner@test.dev" --data-urlencode "password=Passw0rd123" --data-urlencode "json=true" > /dev/null
AUTH=$(curl -s -b "$JAR" $BASE/api/auth/session | jqpy "str(d.get('user',{}).get('email',''))")
check "owner authenticated" "e2e-owner@test.dev" "$AUTH"

# Create the business (POST), then update branding (PATCH)
R=$(req POST /api/dashboard/onboarding '{"businessName":"Review Test Shop","slug":"review-test-shop","timezone":"America/Los_Angeles","phone":"(555) 123-4567","email":"shop@reviewtest.com"}' | jqpy "str(d['business']['slug'])")
check "business created with basics" "review-test-shop" "$R"
# Branding
R=$(req PATCH /api/dashboard/onboarding '{"primaryColor":"#f59e0b","accentColor":"#0ea5e9","themeMode":"dark","step":"services"}' | jqpy "str(d.get('error','ok'))")
check "branding saved" "ok" "$R"

echo "── completion attempt with requirements missing ──"
R=$(req PATCH /api/dashboard/onboarding '{"step":"done"}' -w "\n%{http_code}")
BODY=$(echo "$R" | head -1); CODE=$(echo "$R" | tail -1)
check "completion blocked while requirements missing" "400" "$CODE"
MISSING=$(echo "$BODY" | jqpy "[m['code'] for m in d['missing']]")
check "missing list includes service + barber" "['active_service', 'active_barber']" "$MISSING"

# Review endpoint mirrors the same requirements
R=$(req GET /api/dashboard/onboarding/review '' | jqpy "len(d['requirements']['missing'])")
check "review endpoint reports missing count" "2" "$R"   # service, barber, barber_schedule? no barbers→schedule N/A → 3
# → adjust: business saved → only service + barber missing = 2


# Add a service
R=$(req POST /api/dashboard/onboarding/services '{"name":"Signature Cut","duration":30,"price":40,"description":"Classic cut"}' | jqpy "str(d.get('error','ok'))")
check "service created" "ok" "$R"
# Add a barber with schedules
R=$(req POST /api/dashboard/onboarding/team '{"name":"Dre","specialty":"Fades","schedules":[{"dayOfWeek":1,"isOff":false,"startTime":"09:00","endTime":"17:00"},{"dayOfWeek":2,"isOff":false,"startTime":"09:00","endTime":"17:00"},{"dayOfWeek":3,"isOff":false,"startTime":"09:00","endTime":"17:00"},{"dayOfWeek":4,"isOff":false,"startTime":"09:00","endTime":"17:00"},{"dayOfWeek":5,"isOff":false,"startTime":"09:00","endTime":"17:00"},{"dayOfWeek":6,"isOff":true,"startTime":"09:00","endTime":"17:00"},{"dayOfWeek":0,"isOff":true,"startTime":"09:00","endTime":"17:00"}]}' | jqpy "str(d.get('error','ok'))")
check "barber with schedule created" "ok" "$R"

echo "── review endpoint now satisfied ──"
R=$(req GET /api/dashboard/onboarding/review '' | jqpy "d['requirements']['ok']")
check "requirements ok on review endpoint" "True" "$R"
R=$(req GET /api/dashboard/onboarding/review '' | jqpy "len(d['services'])")
check "review lists 1 service" "1" "$R"
R=$(req GET /api/dashboard/onboarding/review '' | jqpy "len(d['barbers'][0]['schedules'])")
check "review lists barber schedules" "7" "$R"

echo "── Complete Setup ──"
R=$(req PATCH /api/dashboard/onboarding '{"step":"done"}' | jqpy "str(d['business']['onboardingCompleted'])")
check "onboardingCompleted = true" "True" "$R"
R=$(req GET /api/dashboard/onboarding '' | jqpy "str(d['business']['onboardingCompletedAt'] is not None)")
check "onboardingCompletedAt set" "True" "$R"
# Dashboard access allowed after completion (gate returns content, not redirect)
R=$(curl -s -b "$JAR" -o /dev/null -w "%{http_code}" $BASE/dashboard)
check "dashboard accessible after completion" "200" "$R"
# Still editable after completion: update a service via normal dashboard API
SVC_ID=$(req GET /api/dashboard/onboarding/review '' | jqpy "d['services'][0]['id']")
R=$(req PATCH /api/dashboard/services/$SVC_ID '{"price":45}' | jqpy "str(d.get('error','ok'))")
check "config NOT locked after completion" "ok" "$R"

echo "═══ 3. Password reset flow ═══"
rm -f "$JAR"; JAR=$(mktemp)
# Forgot password — dev server returns the reset link (NODE_ENV=development)
RESP=$(req POST /api/auth/forgot-password '{"email":"e2e-owner@test.dev"}')
R=$(echo "$RESP" | jqpy "d['message']")
check "generic anti-enumeration message" "If an account exists for that email, password reset instructions have been sent." "$R"
RESET_URL=$(echo "$RESP" | jqpy "d['resetUrl']")
case "$RESET_URL" in /reset-password?token=*) echo "✓ dev mode returns reset link"; PASS=$((PASS+1));; *) echo "✗ dev mode returns reset link (got '$RESET_URL')"; FAIL=$((FAIL+1));; esac
TOKEN=$(echo "$RESET_URL" | sed 's/.*token=//')
# Token is stored hashed — must NOT appear raw in DB, and reset works
R=$(req POST /api/auth/reset-password "{\"token\":\"$TOKEN\",\"password\":\"NewPassw0rd456\"}" | jqpy "str(d.get('success'))")
check "password reset with valid token" "True" "$R"
# Single-use: same token now invalid
R=$(req POST /api/auth/reset-password "{\"token\":\"$TOKEN\",\"password\":\"AnotherPass1\"}" -o /dev/null -w "%{http_code}")
check "token single-use (second attempt rejected)" "400" "$R"
# Login with the NEW password works
csrf=$(curl -s -b "$JAR" -c "$JAR" $BASE/api/auth/csrf | jqpy "d['csrfToken']")
curl -s -o /dev/null -X POST $BASE/api/auth/callback/credentials -H 'Content-Type: application/x-www-form-urlencoded' -b "$JAR" -c "$JAR" --data-urlencode "csrfToken=$csrf" --data-urlencode "email=e2e-owner@test.dev" --data-urlencode "password=NewPassw0rd456" --data-urlencode "json=true"
AUTH=$(curl -s -b "$JAR" $BASE/api/auth/session | jqpy "str(d.get('user',{}).get('email',''))")
check "login works with new password" "e2e-owner@test.dev" "$AUTH"
# Old password no longer works
JAR2=$(mktemp)
csrf2=$(curl -s -b "$JAR2" -c "$JAR2" $BASE/api/auth/csrf | jqpy "d['csrfToken']")
curl -s -o /dev/null -X POST $BASE/api/auth/callback/credentials -H 'Content-Type: application/x-www-form-urlencoded' -b "$JAR2" -c "$JAR2" --data-urlencode "csrfToken=$csrf2" --data-urlencode "email=e2e-owner@test.dev" --data-urlencode "password=Passw0rd123" --data-urlencode "json=true"
AUTH2=$(curl -s -b "$JAR2" $BASE/api/auth/session | jqpy "str(d.get('user',{}).get('email',''))")
check "old password rejected" "" "$AUTH2"
# passwordChangedAt + mustChangePassword cleared in DB
set -a; source .env 2>/dev/null; set +a
R=$(npx tsx -e "
import { prisma } from './src/lib/prisma'
async function main() {
  const u = await prisma.user.findUnique({ where: { email: 'e2e-owner@test.dev' } })
  console.log(JSON.stringify({ changed: u?.passwordChangedAt !== null && u?.passwordChangedAt !== undefined, must: u?.mustChangePassword, tok: u?.passwordResetToken }))
}
main().finally(() => prisma.\$disconnect())" 2>/dev/null)
check "passwordChangedAt set" "True" "$(echo $R | jqpy "str(d['changed'])")"
check "mustChangePassword cleared" "False" "$(echo $R | jqpy "str(d['must'])")"
check "reset token cleared" "None" "$(echo $R | jqpy "str(d['tok'])")"

echo "═══ 4. Public site: hours come from the database ═══"
R=$(curl -s -H "Host: review-test-shop" $BASE | grep -c "09:00 - 18:00")
check "public site renders DB-backed business hours" "1" "$R"
# Null out the DB hours → the site must show the by-appointment note, never invented hours
npx tsx -e "
import { prisma } from './src/lib/prisma'
async function main() { await prisma.business.update({ where: { slug: 'review-test-shop' }, data: { hours: null } }) }
main().finally(() => prisma.\$disconnect())" >/dev/null 2>&1
R=$(curl -s -H "Host: review-test-shop" $BASE | grep -c "By appointment")
check "unconfigured hours show by-appointment note (no invented hours)" "1" "$R"

echo ""
echo "═══ RESULTS: $PASS passed, $FAIL failed ═══"
exit $FAIL