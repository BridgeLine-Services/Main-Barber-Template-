export const dynamic = 'force-dynamic'

/**
 * GET /api/dashboard/template-version — which template release this copy runs (Part 8.1).
 *
 * Owner-only and read-only. It exists so a support conversation starts with a version
 * rather than a guess, and so a client can answer "what am I running?" without a terminal.
 */

import { NextResponse } from 'next/server'
import { requireOwner } from '@/lib/auth-helpers'
import { handleApiError } from '@/lib/api-errors'
import { TEMPLATE_VERSION, describeTemplateVersion, nodeIsSufficient } from '@/lib/template-version'

export async function GET() {
  try {
    const auth = await requireOwner()
    if (!auth.success) return auth.response

    const node = process.version
    return NextResponse.json({
      ...TEMPLATE_VERSION,
      description: describeTemplateVersion(TEMPLATE_VERSION),
      runtime: {
        node,
        meetsRequirement: nodeIsSufficient(node),
      },
      updateCheck: 'Run `npm run template:check` in your own copy. Nothing is applied automatically.',
    })
  } catch (error) {
    return handleApiError(error, 'GET /api/dashboard/template-version')
  }
}
