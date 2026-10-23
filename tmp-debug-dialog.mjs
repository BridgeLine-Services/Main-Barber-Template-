import { chromium } from 'playwright'
const BASE = 'http://localhost:3000'
const browser = await chromium.launch({ headless: true })
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
await page.goto(BASE + '/login', { waitUntil: 'networkidle' })
await page.fill('input[type="email"]', 'verify-owner-419917@test.local')
await page.fill('input[type="password"]', 'Password123!')
await page.click('button[type="submit"]')
await page.waitForURL('**/dashboard**', { timeout: 15000 })
await page.goto(BASE + '/dashboard/calendar', { waitUntil: 'networkidle' })
await page.waitForTimeout(1500)
const slots = await page.locator('button:has-text("AVAILABLE SLOT")').count()
console.log('slot buttons:', slots)
if (slots > 0) {
  await page.locator('button:has-text("AVAILABLE SLOT")').nth(3).click()
  await page.waitForTimeout(2500)
  const dlg = await page.locator('text=Manual Appointment').count()
  console.log('dialog title present:', dlg)
  await page.screenshot({ path: '/tmp/shots/debug-dialog-open.png' })
  const newBtn = await page.locator('button:has-text("+ New Customer")').count()
  console.log('+ New Customer button count:', newBtn)
  if (newBtn > 0) {
    await page.locator('button:has-text("+ New Customer")').click()
    await page.waitForTimeout(800)
    const fn = await page.locator('input[placeholder="First Name *"]').count()
    console.log('First Name field count after toggle:', fn)
  }
  // dump visible dialog text for diagnosis
  const body = await page.evaluate(() => {
    const dlg = document.querySelector('[role="dialog"]')
    return dlg ? dlg.innerText.slice(0, 1200) : 'NO DIALOG ELEMENT'
  })
  console.log('--- dialog text ---'); console.log(body)
}
await browser.close()
