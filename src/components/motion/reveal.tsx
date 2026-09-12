'use client'

// ─── Motion primitives for the customer-facing showroom ────────────────────
// A small, consistent animation language built on framer-motion.
//
// Rules encoded here:
//  - Everything animates opacity + transform only (GPU-friendly, no layout thrash)
//  - Reveal animations fire once when scrolled into view (amount: 0.2)
//  - `MotionConfig reducedMotion="user"` in the customer layout makes every
//    animation below automatically respect the OS "reduce motion" setting —
//    transforms are dropped, opacity changes become instant.
//  - Durations are short (0.5–0.7s) with a gentle ease-out curve. Nothing bounces.

import React from 'react'
import { motion, type Variants } from 'framer-motion'

const EASE = [0.21, 0.47, 0.32, 0.98] as const

type Direction = 'up' | 'down' | 'left' | 'right' | 'none'

const OFFSETS: Record<Direction, { x: number; y: number }> = {
  up: { x: 0, y: 28 },
  down: { x: 0, y: -28 },
  left: { x: 28, y: 0 },
  right: { x: -28, y: 0 },
  none: { x: 0, y: 0 },
}

// ─── Reveal ─────────────────────────────────────────────────────────────────
// Fades (and optionally slides) a section, heading, or block into view once.
interface RevealProps {
  children: React.ReactNode
  as?: React.ElementType
  direction?: Direction
  delay?: number
  duration?: number
  className?: string
  once?: boolean
}

export function Reveal({
  children,
  as = 'div',
  direction = 'up',
  delay = 0,
  duration = 0.6,
  className,
  once = true,
}: RevealProps) {
  const offset = OFFSETS[direction]
  const MotionTag = motion[as as keyof typeof motion] as typeof motion.div
  return (
    <MotionTag
      className={className}
      initial={{ opacity: 0, x: offset.x, y: offset.y }}
      whileInView={{ opacity: 1, x: 0, y: 0 }}
      viewport={{ once, amount: 0.2, margin: '0px 0px -40px 0px' }}
      transition={{ duration, delay, ease: EASE }}
    >
      {children}
    </MotionTag>
  )
}

// ─── Stagger ───────────────────────────────────────────────────────────────
// Parent + child pair for grids/lists (cards, barbers, services, reviews).
const containerVariants: Variants = {
  hidden: {},
  visible: {
    transition: { staggerChildren: 0.09, delayChildren: 0.05 },
  },
}

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 26 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.55, ease: EASE },
  },
}

export function Stagger({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <motion.div
      className={className}
      variants={containerVariants}
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, amount: 0.15, margin: '0px 0px -40px 0px' }}
    >
      {children}
    </motion.div>
  )
}

export function StaggerItem({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <motion.div className={className} variants={itemVariants}>
      {children}
    </motion.div>
  )
}

// ─── Hero entrance ──────────────────────────────────────────────────────────
// For above-the-fold content: plays immediately on mount (not scroll-triggered).
export function HeroReveal({
  children,
  delay = 0,
  className,
}: {
  children: React.ReactNode
  delay?: number
  className?: string
}) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 22 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.7, delay, ease: EASE }}
    >
      {children}
    </motion.div>
  )
}

// Subtle looping scroll indicator for the hero (breathing opacity only).
export function ScrollHint({ className, children }: { className?: string; children?: React.ReactNode }) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0.5 }}
      animate={{ opacity: [0.5, 1, 0.5] }}
      transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
      aria-hidden="true"
    >
      {children}
    </motion.div>
  )
}
