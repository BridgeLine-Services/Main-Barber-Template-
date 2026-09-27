export const dynamic = 'force-static'

/**
 * Offline fallback served by the service worker when a navigation fails
 * and no cached page is available. Static by design: it carries no
 * business state, no availability data, and no customer data.
 */
export default function OfflinePage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-zinc-950 px-6 text-center text-zinc-200">
      <div className="text-5xl" aria-hidden>✂️</div>
      <h1 className="text-2xl font-bold">You&apos;re offline</h1>
      <p className="max-w-md text-zinc-400">
        We couldn&apos;t reach the shop right now. Check your connection and try again — your
        bookings are safe and waiting for you online.
      </p>
      <a
        href="/"
        className="rounded-md bg-zinc-800 px-4 py-2 text-sm font-medium text-zinc-100 hover:bg-zinc-700"
      >
        Try again
      </a>
    </div>
  )
}
