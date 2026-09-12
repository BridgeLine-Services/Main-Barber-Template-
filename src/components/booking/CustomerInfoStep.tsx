'use client'

import React from 'react'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { isValidEmail, isValidPhone, formatPhoneInput } from '@/lib/utils'
import { User, Mail, Phone, FileText, CheckCircle2, ArrowRight } from 'lucide-react'

export interface CustomerInfo {
  firstName: string
  lastName: string
  phone: string
  email: string
  notes?: string
  smsConsent?: boolean
  answers?: Record<string, string | boolean | string[]>
}

interface BookingQuestion {
  id: string
  label: string
  key: string
  type: 'SHORT_TEXT' | 'LONG_TEXT' | 'YES_NO' | 'SINGLE_CHOICE' | 'MULTIPLE_CHOICE' | 'PHONE' | 'EMAIL' | 'DATE'
  required: boolean
  helpText?: string | null
  options?: string[] | null
}

interface CustomerInfoStepProps {
  customerInfo: CustomerInfo
  onChange: (info: CustomerInfo) => void
  onNext: () => void
  shopName?: string
}

export function CustomerInfoStep({
  customerInfo,
  onChange,
  onNext,
  shopName = 'the Barbershop',
}: CustomerInfoStepProps) {
  const [questions, setQuestions] = React.useState<BookingQuestion[]>([])

  React.useEffect(() => {
    fetch('/api/public/booking-questions').then((response) => response.ok ? response.json() : { questions: [] }).then((data) => setQuestions(data.questions || [])).catch(() => setQuestions([]))
  }, [])

  const handleChange = (field: keyof CustomerInfo, value: any) => {
    onChange({
      ...customerInfo,
      [field]: value,
    })
  }

  const isFirstNameValid = customerInfo.firstName.trim().length > 0
  const isLastNameValid = customerInfo.lastName.trim().length > 0
  const isEmailValid = isValidEmail(customerInfo.email.trim())
  const isPhoneValid = isValidPhone(customerInfo.phone.trim())

  const requiredQuestionsValid = questions.filter((question) => question.required).every((question) => {
    const value = customerInfo.answers?.[question.key]
    return Array.isArray(value) ? value.length > 0 : value !== undefined && value !== ''
  })
  const isValid = isFirstNameValid && isLastNameValid && isEmailValid && isPhoneValid && requiredQuestionsValid

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (isValid) {
      onNext()
    }
  }

  return (
    <div className="space-y-4 max-w-xl mx-auto">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-foreground tracking-tight">Your Details</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Provide your contact details to complete your appointment booking.
        </p>
      </div>

      <Card className="p-6 bg-card/80 border-border shadow-xl shadow-black/10">
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* First Name */}
            <div className="space-y-2">
              <Label htmlFor="firstName" className="text-foreground/80 text-xs font-semibold">
                First Name <span className="text-accent">*</span>
              </Label>
              <div className="relative">
                <Input
                  id="firstName"
                  type="text"
                  placeholder="John"
                  value={customerInfo.firstName}
                  onChange={(e) => handleChange('firstName', e.target.value)}
                  className="bg-background border-border text-foreground focus:border-amber-500 pr-8"
                  required
                />
                <User className="w-4 h-4 text-muted-foreground absolute right-3 top-3" />
              </div>
            </div>

            {/* Last Name */}
            <div className="space-y-2">
              <Label htmlFor="lastName" className="text-foreground/80 text-xs font-semibold">
                Last Name <span className="text-accent">*</span>
              </Label>
              <div className="relative">
                <Input
                  id="lastName"
                  type="text"
                  placeholder="Doe"
                  value={customerInfo.lastName}
                  onChange={(e) => handleChange('lastName', e.target.value)}
                  className="bg-background border-border text-foreground focus:border-amber-500 pr-8"
                  required
                />
                <User className="w-4 h-4 text-muted-foreground absolute right-3 top-3" />
              </div>
            </div>
          </div>

          {/* Email */}
          <div className="space-y-2">
            <Label htmlFor="email" className="text-foreground/80 text-xs font-semibold">
              Email Address <span className="text-accent">*</span>
            </Label>
            <div className="relative">
              <Input
                id="email"
                type="email"
                placeholder="john.doe@example.com"
                value={customerInfo.email}
                onChange={(e) => handleChange('email', e.target.value)}
                className="bg-background border-border text-foreground focus:border-amber-500 pr-8"
                required
              />
              <Mail className="w-4 h-4 text-muted-foreground absolute right-3 top-3" />
            </div>
            {customerInfo.email.trim() && !isEmailValid && (
              <p className="text-[11px] text-red-400">Please enter a valid email address.</p>
            )}
          </div>

          {/* Phone */}
          <div className="space-y-2">
            <Label htmlFor="phone" className="text-foreground/80 text-xs font-semibold">
              Phone Number <span className="text-accent">*</span>
            </Label>
            <div className="relative">
              <Input
                id="phone"
                type="tel"
                placeholder="(555) 000-0000"
                value={customerInfo.phone}
                onChange={(e) => handleChange('phone', formatPhoneInput(e.target.value))}
                className="bg-background border-border text-foreground focus:border-amber-500 pr-8"
                required
              />
              <Phone className="w-4 h-4 text-muted-foreground absolute right-3 top-3" />
            </div>
            {customerInfo.phone.trim() && !isPhoneValid && (
              <p className="text-[11px] text-red-400">
                Please enter a valid 10-digit phone number.
              </p>
            )}
          </div>

          {/* Notes (Optional) */}
          <div className="space-y-2">
            <Label htmlFor="notes" className="text-foreground/80 text-xs font-semibold">
              Special Instructions / Notes <span className="text-muted-foreground">(Optional)</span>
            </Label>
            <div className="relative">
              <Textarea
                id="notes"
                placeholder="Any special requests, hair length details, or preferences..."
                value={customerInfo.notes || ''}
                onChange={(e) => handleChange('notes', e.target.value)}
                className="bg-background border-border text-foreground focus:border-amber-500 min-h-[90px]"
              />
            </div>
          </div>

          {questions.length > 0 && (
            <fieldset className="flex flex-col gap-4 border-t border-border pt-5">
              <legend className="text-sm font-semibold text-foreground/80">A few questions for your barber</legend>
              {questions.map((question) => {
                const value = customerInfo.answers?.[question.key] ?? (question.type === 'MULTIPLE_CHOICE' ? [] : '')
                const update = (next: string | boolean | string[]) => handleChange('answers', { ...customerInfo.answers, [question.key]: next })
                return <div key={question.id} className="flex flex-col gap-2">
                  <Label htmlFor={`question-${question.key}`} className="text-foreground/80 text-xs font-semibold">{question.label} {question.required && <span className="text-accent">*</span>}</Label>
                  {question.type === 'LONG_TEXT' ? <Textarea id={`question-${question.key}`} value={String(value)} onChange={(event) => update(event.target.value)} className="bg-background border-border text-foreground" /> : question.type === 'YES_NO' ? <select id={`question-${question.key}`} value={String(value)} onChange={(event) => update(event.target.value === 'true')} className="rounded-md border border-border bg-background px-3 py-2 text-foreground"><option value="">Choose one</option><option value="true">Yes</option><option value="false">No</option></select> : question.type === 'SINGLE_CHOICE' ? <select id={`question-${question.key}`} value={String(value)} onChange={(event) => update(event.target.value)} className="rounded-md border border-border bg-background px-3 py-2 text-foreground"><option value="">Choose one</option>{(question.options || []).map(option => <option key={option} value={option}>{option}</option>)}</select> : question.type === 'MULTIPLE_CHOICE' ? <div className="flex flex-wrap gap-2">{(question.options || []).map(option => <label key={option} className="flex items-center gap-2 text-sm text-foreground/70"><input type="checkbox" checked={Array.isArray(value) && value.includes(option)} onChange={(event) => update(event.target.checked ? [...(Array.isArray(value) ? value : []), option] : (Array.isArray(value) ? value.filter(item => item !== option) : []))} />{option}</label>)}</div> : <Input id={`question-${question.key}`} type={question.type === 'EMAIL' ? 'email' : question.type === 'PHONE' ? 'tel' : question.type === 'DATE' ? 'date' : 'text'} value={String(value)} onChange={(event) => update(event.target.value)} className="bg-background border-border text-foreground" />}
                  {question.helpText && <p className="text-xs text-muted-foreground">{question.helpText}</p>}
                </div>
              })}
            </fieldset>
          )}

          {/* SMS Consent Checkbox */}
          <div className="flex items-start space-x-3 pt-2">
            <input
              type="checkbox"
              id="smsConsent"
              checked={customerInfo.smsConsent ?? false}
              onChange={(e) => handleChange('smsConsent', e.target.checked)}
              className="mt-1 h-4 w-4 rounded border-border bg-background text-accent focus:ring-amber-500/50"
            />
            <Label htmlFor="smsConsent" className="text-xs text-muted-foreground font-normal leading-relaxed cursor-pointer">
              I agree to receive appointment-related text messages from {shopName}. Message/data rates
              may apply. Reply STOP to opt out.
            </Label>
          </div>

          {/* Submit / Continue Button */}
          <div className="pt-4">
            <Button
              type="submit"
              disabled={!isValid}
              className="w-full bg-amber-500 hover:brightness-110 text-zinc-950 font-bold h-12 text-base transition-all disabled:opacity-40"
            >
              <span>Continue to Confirmation</span>
              <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
          </div>
        </form>
      </Card>
    </div>
  )
}
