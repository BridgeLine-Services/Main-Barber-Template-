'use client'

// Create-business form for the platform console. The generated one-time
// owner password is shown exactly once after creation; it must be handed
// to the business owner out-of-band.

import { useFormState } from 'react-dom'
import { createBusiness, type CreateBusinessState } from './actions'

const initialState: CreateBusinessState = {}

export function CreateBusinessForm() {
  const [state, formAction, pending] = useFormState(createBusiness, initialState)

  if (state.tempPassword) {
    return (
      <div className="rounded-lg border bg-white p-4" role="status">
        <p className="font-medium">{state.businessName} created.</p>
        <p className="mt-1 text-sm text-gray-600">
          One-time password for the owner (shown only once, must be changed at first sign-in):
        </p>
        <code className="mt-2 block rounded bg-gray-100 px-3 py-2 font-mono">{state.tempPassword}</code>
      </div>
    )
  }

  return (
    <form action={formAction} className="max-w-xl space-y-3 rounded-lg border bg-white p-4">
      {state.error && (
        <p className="text-sm text-red-600" role="alert">{state.error}</p>
      )}
      <div>
        <label htmlFor="cb-name" className="block text-sm font-medium">Business name</label>
        <input id="cb-name" name="name" required maxLength={100}
          className="mt-1 w-full rounded-md border px-3 py-2 text-sm" />
      </div>
      <div>
        <label htmlFor="cb-slug" className="block text-sm font-medium">Slug</label>
        <input id="cb-slug" name="slug" required pattern="[a-z0-9-]+" maxLength={60}
          className="mt-1 w-full rounded-md border px-3 py-2 text-sm" placeholder="e.g. downtown-cuts" />
        <p className="mt-1 text-xs text-gray-500">Lowercase letters, digits, and hyphens.</p>
      </div>
      <div>
        <label htmlFor="cb-owner-name" className="block text-sm font-medium">Owner name</label>
        <input id="cb-owner-name" name="ownerName" required maxLength={100}
          className="mt-1 w-full rounded-md border px-3 py-2 text-sm" />
      </div>
      <div>
        <label htmlFor="cb-owner-email" className="block text-sm font-medium">Owner email</label>
        <input id="cb-owner-email" name="ownerEmail" type="email" required
          className="mt-1 w-full rounded-md border px-3 py-2 text-sm" />
      </div>
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {pending ? 'Creating…' : 'Create business'}
      </button>
    </form>
  )
}
