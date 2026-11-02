// ============================================================================
// Content-Security-Policy builder.
//
// Two modes:
//   • default  — script-src 'self' 'unsafe-inline'  (today's production policy)
//   • nonce    — script-src 'self' 'nonce-…' 'strict-dynamic'
//
// The nonce mode is OFF unless CSP_NONCE_ENABLED=true, so enabling it is a
// configuration change per environment and can be reverted without a deploy.
// See docs/CSP-EVALUATION.md for why style-src keeps 'unsafe-inline' (the theme
// CSS is generated per business, so there is nothing stable to hash) and for
// the staging checklist a rollout must pass.
// ============================================================================

export const CSP_NONCE_ENV_VAR = 'CSP_NONCE_ENABLED'

/** The dashboard preview renders the site in an iframe, so it needs 'self'. */
export const PREVIEW_PATH = '/dashboard/website-preview'

export function isNonceEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env[CSP_NONCE_ENV_VAR] === 'true'
}

export interface CspOptions {
  /** Per-request nonce. Ignored unless nonce mode is on. */
  nonce?: string | null
  /** Route being rendered, used to relax frame-ancestors for the preview only. */
  pathname?: string
  /** Development needs 'unsafe-eval' for React's JIT; production never does. */
  isProduction?: boolean
}

export function buildContentSecurityPolicy(options: CspOptions = {}): string {
  const { nonce, pathname, isProduction = process.env.NODE_ENV === 'production' } = options
  const useNonce = Boolean(nonce)
  const evalAllowance = isProduction ? '' : " 'unsafe-eval'"

  // 'strict-dynamic' lets the nonce-tagged bootstrap load the rest of the
  // bundles; without it every chunk script tag needs its own nonce.
  const scriptSrc = useNonce
    ? `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${evalAllowance}`
    : `script-src 'self' 'unsafe-inline'${evalAllowance}`

  const frameAncestors = pathname === PREVIEW_PATH ? "'self'" : "'none'"

  return [
    "default-src 'self'",
    scriptSrc,
    // Cannot be tightened: business themes are generated CSS injected inline,
    // and React writes style attributes from props.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https://*.public.blob.vercel-storage.com",
    "font-src 'self' data:",
    "connect-src 'self'",
    "frame-src 'self' https://www.google.com https://maps.google.com",
    `frame-ancestors ${frameAncestors}`,
    "base-uri 'self'",
    "object-src 'none'",
    "form-action 'self'",
  ].join('; ') + ';'
}
