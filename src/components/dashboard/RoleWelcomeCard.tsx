import Link from 'next/link'
import { describeRoleExperience } from '@/lib/role-experience'

/**
 * The first thing a person sees on the dashboard, in their own terms (Part 7.1).
 *
 * It shows what this role should look at first and what it cannot do, so nobody has to
 * discover a permission boundary by hitting it. Every link is an existing page; the
 * links are not a permission grant, and the destination still checks access itself.
 */
export function RoleWelcomeCard({
  role,
  assignedLocationCount,
}: {
  role: string | null | undefined
  assignedLocationCount?: number
}) {
  const experience = describeRoleExperience(role)

  return (
    <section
      aria-labelledby="role-welcome"
      className="mb-4 rounded-xl border border-border bg-[var(--dash-surface)] p-5"
    >
      <h2 id="role-welcome" className="text-base font-semibold text-foreground">
        {experience.label}
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">{experience.intro}</p>
      {experience.role === 'LOCATION_MANAGER' && typeof assignedLocationCount === 'number' && (
        <div className="mt-2">
          <p className="text-xs font-medium text-[var(--dash-brand)]">
            {assignedLocationCount} assigned {assignedLocationCount === 1 ? 'location' : 'locations'} in your organization access.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            The schedule below shows only the location linked to your account; location records are not combined.
          </p>
        </div>
      )}

      {experience.focus.length > 0 && (
        <ul className="mt-3 grid gap-2 sm:grid-cols-2">
          {experience.focus.map((item) => (
            <li key={item.href} className="rounded-lg border border-border p-3">
              <Link
                href={item.href}
                className="text-sm font-medium text-foreground underline underline-offset-2"
              >
                {item.label}
              </Link>
              <p className="mt-1 text-xs text-muted-foreground">{item.why}</p>
            </li>
          ))}
        </ul>
      )}

      {experience.boundaries.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-xs font-medium text-foreground">
            What you cannot do here
          </summary>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-muted-foreground">
            {experience.boundaries.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </details>
      )}
    </section>
  )
}
