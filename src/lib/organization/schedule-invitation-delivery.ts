import { after } from 'next/server'
import { processDueNotifications } from '@/lib/notification-worker'

export function scheduleInvitationDelivery(notificationId: string) {
  after(async () => {
    try {
      await processDueNotifications(1, {
        notificationIds: [notificationId],
        notificationType: 'ORGANIZATION_INVITATION',
      })
    } catch {
      console.error('[organization-invitations] queued email could not be processed')
    }
  })
}
