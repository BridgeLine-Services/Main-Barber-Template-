#!/usr/bin/env bash
# E2E: forced password change flow.
# Covers: DB flag → server-side dashboard block → /change-password validation
# (wrong current, same password, weak passwords, mismatched confirm) →
# success (flags cleared, audit row, re-auth redirect) → old session invalidated → access restored via new login.
set -u
BASE="http://localhost:3000"
PASS=0; FAIL=0
jqpy() { python3 -c "import sys,json;d=json.load(sys.stdin);print(eval(sys.argv[1]))" "$1" 2>/dev/null; }
check() { if [ "$2" = "$3" ]; then echo "✓ $1"; PASS=$((PASS+1)); else echo "✗ $1 (want '$2' got '$3')"; FAIL=$((FAIL+1)); fi; }
login() { # $1 email, $2 password → sets $JAR
  sleep 3 # respect AUTH rate limit
  JAR=$(mktemp)
  csrf=$(curl -s -b "$JAR" -c "$JAR" $BASE/api/auth/csrf | jqpy "d['csrfToken']")
  curl -s -o /dev/null -X POST $BASE/api/auth/callback/credentials -H 'Content-Type: application/x-www-form-urlencoded' -b "$JAR" -c "$JAR" --data-urlencode "csrfToken=$csrf" --data-urlencode "email=$1" --data-urlencode "password=$2" --data-urlencode "json=true"
}
chg() { curl -s -X POST $BASE/api/auth/change-password -H 'Content-Type: application/json' -b "$JAR" -d "$1"; }

echo "═══ 0. Setup: fresh user forced to change password ═══"
npx tsx -e "
import { prisma } from './src/lib/prisma'
import bcrypt from 'bcryptjs'
async function main() {
  await prisma.user.deleteMany({ where: { email: 'forced@test.dev' } })
  await prisma.user.create({
    data: {
      email: 'forced@test.dev', name: 'Forced Owner', role: 'OWNER',
      passwordHash: await bcrypt.hash('TempPass123', 10),
      mustChangePassword: true,
      temporaryPasswordExpiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
    },
  })
  console.log('user ready')
}
main().finally(() => prisma['\$disconnect']())" 2>/dev/null | tail -1

login forced@test.dev TempPass123
AUTH=$(curl -s -b "$JAR" $BASE/api/auth/session | jqpy "str(d.get('user',{}).get('email',''))")
check "login succeeds for flagged user" "forced@test.dev" "$AUTH"

echo "═══ 1. Server-side route protection ═══"
R=$(curl -s -b "$JAR" -o /dev/null -w "%{redirect_url}" $BASE/dashboard)
check "/dashboard redirects to change-password" "$BASE/change-password" "$R"
R=$(curl -s -b "$JAR" -o /dev/null -w "%{redirect_url}" $BASE/dashboard/appointments)
check "/dashboard/* redirects too (manual URL entry blocked)" "$BASE/change-password" "$R"
R=$(curl -s -b "$JAR" -o /dev/null -w "%{http_code}" $BASE/change-password)
check "/change-password accessible" "200" "$R"
R=$(curl -s -b "$JAR" -o /dev/null -w "%{redirect_url}" $BASE/api/auth/session)
check "auth endpoints still accessible" "" "$R"

echo "═══ 2. Validation ═══"
R=$(chg '{"currentPassword":"WRONGpass1","newPassword":"BrandNewPass123","confirmPassword":"BrandNewPass123"}' | jqpy "str(d['error'])")
check "wrong current password rejected" "Current password is incorrect" "$R"
R=$(chg '{"currentPassword":"TempPass123","newPassword":"TempPass123","confirmPassword":"TempPass123"}' | jqpy "str(d['error'])")
check "new == current rejected" "New password must be different from the current password" "$R"
R=$(chg '{"currentPassword":"TempPass123","newPassword":"short12A","confirmPassword":"short12A"}' | jqpy "d['details']['fieldErrors']['newPassword'][0]")
check "under 10 chars rejected" "Password must be at least 10 characters" "$R"
R=$(chg '{"currentPassword":"TempPass123","newPassword":"alllowercase123","confirmPassword":"alllowercase123"}' | jqpy "d['details']['fieldErrors']['newPassword'][0]")
check "missing uppercase rejected" "Password must contain at least one uppercase letter" "$R"
R=$(chg '{"currentPassword":"TempPass123","newPassword":"ALLUPPERCASE123","confirmPassword":"ALLUPPERCASE123"}' | jqpy "d['details']['fieldErrors']['newPassword'][0]")
check "missing lowercase rejected" "Password must contain at least one lowercase letter" "$R"
R=$(chg '{"currentPassword":"TempPass123","newPassword":"NoNumbersHere","confirmPassword":"NoNumbersHere"}' | jqpy "d['details']['fieldErrors']['newPassword'][0]")
check "missing number rejected" "Password must contain at least one number" "$R"
R=$(chg '{"currentPassword":"TempPass123","newPassword":"BrandNewPass123","confirmPassword":"DifferentPass123"}' | jqpy "d['details']['fieldErrors']['confirmPassword'][0]")
check "confirm mismatch rejected server-side" "Passwords do not match" "$R"

echo "═══ 3. Success ═══"
R=$(chg '{"currentPassword":"TempPass123","newPassword":"BrandNewPass123","confirmPassword":"BrandNewPass123"}' | jqpy "str(d['success'])")
check "password change succeeds" "True" "$R"
R=$(chg '{"currentPassword":"TempPass123","newPassword":"BrandNewPass123","confirmPassword":"BrandNewPass123"}' >/dev/null; echo done)
DB=$(npx tsx -e "
import { prisma } from './src/lib/prisma'
async function main() {
  const u = await prisma.user.findUnique({ where: { email: 'forced@test.dev' } })
  const audit = await prisma.auditLog.findFirst({ where: { action: 'USER_PASSWORD_CHANGED', entityId: u!.id }, orderBy: { createdAt: 'desc' } })
  console.log(JSON.stringify({
    must: u?.mustChangePassword,
    changedAt: u?.passwordChangedAt !== null,
    tempExp: u?.temporaryPasswordExpiresAt === null,
    audit: audit !== null,
  }))
}
main().finally(() => prisma['\$disconnect']())" 2>/dev/null)
check "mustChangePassword cleared" "False" "$(echo $DB | jqpy "str(d['must'])")"
check "passwordChangedAt set" "True" "$(echo $DB | jqpy "str(d['changedAt'])")"
check "temporaryPasswordExpiresAt cleared" "True" "$(echo $DB | jqpy "str(d['tempExp'])")"
check "USER_PASSWORD_CHANGED audit recorded" "True" "$(echo $DB | jqpy "str(d['audit'])")"

echo "═══ 4. Redirect target + access restored ═══"
# Flag again: owner with NO business → change must redirect to onboarding
npx tsx -e "
import { prisma } from './src/lib/prisma'
async function main() { await prisma.user.update({ where: { email: 'forced@test.dev' }, data: { mustChangePassword: true } }) }
main().finally(() => prisma['\$disconnect']())" >/dev/null 2>&1
login forced@test.dev BrandNewPass123
R=$(chg '{"currentPassword":"BrandNewPass123","newPassword":"FinalPass789","confirmPassword":"FinalPass789"}' | jqpy "str(d.get('redirectTo'))")
check "password change redirects to login (re-authenticate)" "/login?passwordChanged=1" "$R"
# Session security: the pre-change session cookie must now be fully dead
AUTH=$(curl -s -b "$JAR" $BASE/api/auth/session | jqpy "str(d.get('user',{}).get('email',''))")
check "old session cookie invalidated after password change" "" "$AUTH"
R=$(curl -s -b "$JAR" -o /dev/null -w "%{redirect_url}" $BASE/dashboard)
check "old session bounced from /dashboard to /login" "$BASE/login" "$R"
# Password gate passed; onboarding gate now correctly applies to this owner
login forced@test.dev FinalPass789
R=$(curl -s -b "$JAR" -o /dev/null -w "%{redirect_url}" $BASE/dashboard)
check "password gate cleared (onboarding gate applies next)" "$BASE/dashboard/onboarding" "$R"
# Old password no longer works
login forced@test.dev BrandNewPass123
AUTH=$(curl -s -b "$JAR" $BASE/api/auth/session | jqpy "str(d.get('user',{}).get('email',''))")
check "old password rejected after change" "" "$AUTH"

echo ""
echo "═══ RESULTS: $PASS passed, $FAIL failed ═══"
exit $FAIL