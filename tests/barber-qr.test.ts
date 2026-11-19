import { buildQrDataUrl, isEncodableLink, describeQr, MAX_QR_PAYLOAD } from '../src/lib/barber/qr'

let p = 0
const f: string[] = []
const ok = (n: string, c: boolean, d = '') => { if (c) p++; else f.push(n + (d ? ' — ' + d : '')) }

async function main() {
  const url = 'https://shop.example.com/barbers/marcus?ref=abc123'

  // What may be encoded
  ok('a real link is encodable', isEncodableLink(url))
  ok('an http link is encodable', isEncodableLink('http://localhost:3000/barbers/x'))
  ok('javascript: is refused', !isEncodableLink('javascript:alert(1)'))
  ok('data: is refused', !isEncodableLink('data:text/html,<script>'))
  ok('a bare word is refused', !isEncodableLink('marcus'))
  ok('empty is refused', !isEncodableLink(''))
  ok('null is refused', !isEncodableLink(null))
  ok('undefined is refused', !isEncodableLink(undefined))
  ok('whitespace-only is refused', !isEncodableLink('   '))
  ok('an over-long link is refused', !isEncodableLink('https://x.example/' + 'a'.repeat(MAX_QR_PAYLOAD)))
  ok('a link at the cap is allowed', isEncodableLink('https://x.example/' + 'a'.repeat(MAX_QR_PAYLOAD - 20)))

  // Generation
  const png = await buildQrDataUrl(url)
  ok('a PNG data URL comes back', typeof png === 'string' && png!.startsWith('data:image/png;base64,'))
  ok('the payload is real PNG base64', typeof png === 'string' && png!.length > 500)
  ok('the same link encodes the same way twice', (await buildQrDataUrl(url)) === png)
  ok('a different link encodes differently', (await buildQrDataUrl(url + '2')) !== png)
  ok('width is honoured without breaking the format', (await buildQrDataUrl(url, { width: 512 }))!.startsWith('data:image/png;base64,'))

  // Refusals never produce a partial image
  ok('a hostile link yields null, not an image', (await buildQrDataUrl('javascript:alert(1)')) === null)
  ok('a null link yields null', (await buildQrDataUrl(null)) === null)
  ok('an over-long link yields null', (await buildQrDataUrl('https://x.example/' + 'a'.repeat(MAX_QR_PAYLOAD))) === null)

  // Accessibility text
  ok('alt text points at the link as well', /booking link/.test(describeQr(url)))
  ok('alt text says when there is no code', /not available/.test(describeQr(null)))
  ok('alt text never claims a camera is required', !/scan only/i.test(describeQr(url)))

  if (f.length) { console.error('FAILURES:'); for (const x of f) console.error('  ' + x) }
  console.log(`\nQR codes: ${p} passed, ${f.length} failed`)
  process.exit(f.length ? 1 : 0)
}

main()
