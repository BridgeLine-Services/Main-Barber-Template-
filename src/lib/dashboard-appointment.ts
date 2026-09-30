// Shared shape for dashboard appointment data as serialized by
// /api/dashboard/appointments (dates as ISO strings) and consumed by the
// calendar views, appointments list, today view, and details dialog.

export interface IntakeResponseLite {
  id: string
  questionKey: string
  questionLabel: string
  answer: string
}

export interface CalendarAppointment {
  id: string
  confirmationNumber: string
  startTime: string
  endTime: string
  status: string
  customerNotes?: string | null
  createdAt?: string
  createdBy?: string | null
  customer: {
    id: string
    firstName: string
    lastName: string
    phone: string
    email: string
  }
  barber: {
    id: string
    name: string
    specialty?: string | null
  }
  service: {
    id: string
    name: string
    price: number
    duration: number
  }
  intakeResponses?: IntakeResponseLite[]
}
