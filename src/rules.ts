// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Dirk Wahrheit

/*
 * Rules that decide, per notification, whether it sounds the annunciator.
 *
 * A boat with an alarm system on its bus raises many notifications that are
 * worth seeing but not worth being woken by: a sensor-loop fault, a chart
 * update, a standing warning. The notification state alone cannot tell those
 * from a real alarm, so a rule can name them by path, source or message.
 */

import { isSounding, wantsSound } from './alerts.js'

export interface Rule {
  /** Notification path; `*` matches within one part, `**` across parts. */
  path: string
  /** Case-insensitive text the notification's message must contain. */
  message?: string
  /** The notification's `$source`; `*` matches any characters. */
  source?: string
  action: 'sound' | 'silent'
  /** Pattern for a sounding rule, instead of the one for the state. */
  pattern?: number
}

export interface CompiledRule {
  rule: Rule
  path: RegExp
  source?: RegExp
  message?: string
}

export interface Decision {
  sound: boolean
  pattern?: number
}

/**
 * Rules in the order given, without entries a hand-edited configuration got
 * wrong: no path or action, or a message, source or pattern of the wrong type.
 */
export function compileRules(rules: unknown): CompiledRule[] {
  if (!Array.isArray(rules)) {
    return []
  }
  return rules
    .filter(
      (r): r is Rule =>
        r != null &&
        typeof r.path === 'string' &&
        r.path.length > 0 &&
        (r.action === 'sound' || r.action === 'silent') &&
        (r.message === undefined || typeof r.message === 'string') &&
        (r.source === undefined || typeof r.source === 'string') &&
        (r.pattern === undefined || Number.isInteger(r.pattern))
    )
    .map((rule) => ({
      rule,
      path: glob(rule.path, '[^.]*'),
      source: rule.source ? glob(rule.source, '.*') : undefined,
      message: rule.message ? rule.message.toLowerCase() : undefined
    }))
}

/**
 * Whether a notification should sound the annunciator. It never does unless
 * it asks to be heard and is in a sounding state, so an acknowledgment
 * anywhere still silences it. Then the first rule it matches decides, and
 * without one its state must be among `states`.
 */
export function decide(
  rules: CompiledRule[],
  path: string,
  value: any,
  source: string | undefined,
  states: string[]
): Decision {
  if (!wantsSound(value) || !isSounding(value.state)) {
    return { sound: false }
  }
  const match = rules.find((r) => matches(r, path, value, source))
  if (match) {
    return match.rule.action === 'sound'
      ? { sound: true, pattern: match.rule.pattern }
      : { sound: false }
  }
  return { sound: states.indexOf(value.state) !== -1 }
}

function matches(
  r: CompiledRule,
  path: string,
  value: any,
  source: string | undefined
): boolean {
  if (!r.path.test(path)) {
    return false
  }
  if (r.source && !(source !== undefined && r.source.test(source))) {
    return false
  }
  if (r.message) {
    const message = typeof value.message === 'string' ? value.message : ''
    if (message.toLowerCase().indexOf(r.message) === -1) {
      return false
    }
  }
  return true
}

/** A whole-string pattern where `**` matches anything and `*` matches `star`. */
function glob(pattern: string, star: string): RegExp {
  const body = pattern
    .split('**')
    .map((part) =>
      part
        .split('*')
        .map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
        .join(star)
    )
    .join('.*')
  return new RegExp(`^${body}$`)
}
