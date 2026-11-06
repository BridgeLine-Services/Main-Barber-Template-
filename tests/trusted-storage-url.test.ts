/**
 * Tests for the trusted-storage URL check.
 *
 * This helper decides whether a cleanup path may call the object store's delete
 * API on a URL that came out of the database. The failure it exists to prevent:
 * a record whose URL is `https://blob.vercel-storage.com.attacker.example/x`
 * passes a substring test and the application deletes something it does not own.
 */
import assert from 'node:assert'
import { isManagedStorageUrl, parseTrustedStorageUrl } from '../src/lib/trusted-storage-url'

console.log('trusted-storage-url')

const STORE = 'https://abc123xyz.public.blob.vercel-storage.com/media/logo.png'

// Accepted: exactly what the storage provider issues.
assert(isManagedStorageUrl(STORE), 'a normal store URL is trusted')
assert(isManagedStorageUrl('https://store-1.public.blob.vercel-storage.com/a/b.webp'), 'hyphenated store id trusted')
assert(parseTrustedStorageUrl(STORE)?.pathname === '/media/logo.png', 'the object path is preserved')

// Rejected: lookalikes in both directions.
assert(!isManagedStorageUrl('https://blob.vercel-storage.com.attacker.example/x'), 'suffix lookalike rejected')
assert(!isManagedStorageUrl('https://evil-blob.vercel-storage.com/x'), 'prefix lookalike rejected')
assert(!isManagedStorageUrl('https://blob.vercel-storage.com/x'), 'bare provider host rejected (no store id)')
assert(!isManagedStorageUrl('https://abc.public.blob.vercel-storage.com.evil.io/x'), 'append-after-host rejected')
assert(!isManagedStorageUrl('https://abc.public.blob.vercel-storage.co/x'), 'truncated TLD rejected')

// Rejected: honest host, dishonest authority.
assert(!isManagedStorageUrl('https://user:pass@abc123xyz.public.blob.vercel-storage.com/x'), 'credentials rejected')
assert(!isManagedStorageUrl('https://abc123xyz.public.blob.vercel-storage.com:8443/x'), 'non-default port rejected')

// Rejected: wrong protocol or shape.
assert(!isManagedStorageUrl('http://abc123xyz.public.blob.vercel-storage.com/x'), 'plain http rejected')
assert(!isManagedStorageUrl('//abc123xyz.public.blob.vercel-storage.com/x'), 'protocol-relative rejected')
assert(!isManagedStorageUrl('javascript:alert(1)'), 'script scheme rejected')
assert(!isManagedStorageUrl('file:///etc/passwd'), 'file scheme rejected')
assert(!isManagedStorageUrl('not a url'), 'garbage rejected')
assert(!isManagedStorageUrl(''), 'empty rejected')
assert(!isManagedStorageUrl('   '), 'whitespace rejected')
assert(!isManagedStorageUrl(null), 'null rejected')
assert(!isManagedStorageUrl(undefined), 'undefined rejected')
assert(!isManagedStorageUrl(`https://abc123xyz.public.blob.vercel-storage.com/${'a'.repeat(3000)}`), 'absurdly long URL rejected')

// Hosts that happen to contain the provider string but are not ours.
assert(!isManagedStorageUrl('https://vercel-storage.com/x'), 'provider name alone rejected')
assert(!isManagedStorageUrl('https://public.blob.vercel-storage.com/x'), 'no store label rejected')

// External image URLs still work as media; they are simply not ours to delete.
assert(!isManagedStorageUrl('https://images.example.com/photo.jpg'), 'external image is not managed storage')

console.log('  Results: 24 passed, 0 failed')
