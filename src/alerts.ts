/*
 * Mapping Signal K notifications onto the annunciator.
 */

/**
 * Signal K alarm states, quietest first. `nominal` and `normal` are the two
 * not-sounding states.
 */
export const SOUNDING_STATES = ['warn', 'alert', 'alarm', 'emergency'] as const

export type SoundingState = (typeof SOUNDING_STATES)[number]

/** Rank used to pick the most severe active notification. */
const SEVERITY: Record<string, number> = {
  nominal: 0,
  normal: 0,
  warn: 1,
  alert: 2,
  alarm: 3,
  emergency: 4
}

export function severityOf(state: string): number {
  return SEVERITY[state] ?? 0
}

export function isSounding(state: unknown): state is SoundingState {
  return typeof state === 'string' && severityOf(state) > 0
}

/**
 * True when a notification asks to be heard. Signal K's convention is that
 * `method` carries `sound` for anything audible; a visual-only notification
 * must not make noise.
 */
export function wantsSound(value: any): boolean {
  return (
    value != null &&
    typeof value.state === 'string' &&
    Array.isArray(value.method) &&
    value.method.indexOf('sound') !== -1
  )
}

/**
 * Allocates a stable alert id per notification path.
 *
 * The ALM100 keys on alert id, so a given path must always use the same one:
 * ids are what the device's bindings are registered against, and what its
 * 130824 status reports back while sounding. Ids are handed out from a
 * configurable base so they can be kept clear of the ids the vessel's own
 * equipment already uses.
 */
export class AlertIds {
  private readonly base: number
  private readonly limit: number
  private next: number
  private readonly byPath = new Map<string, number>()

  constructor(base: number, limit = 64) {
    this.base = base
    this.limit = limit
    this.next = base
  }

  /** Existing id for a path, allocating one on first sight. */
  idFor(path: string): number | undefined {
    const existing = this.byPath.get(path)
    if (existing !== undefined) {
      return existing
    }
    if (this.byPath.size >= this.limit) {
      return undefined
    }
    const id = this.next++
    this.byPath.set(path, id)
    return id
  }

  /** Every id handed out so far, for registering bindings on start. */
  allocated(): number[] {
    return [...this.byPath.values()]
  }

  /** All ids this instance could ever hand out. */
  range(): { first: number; last: number } {
    return { first: this.base, last: this.base + this.limit - 1 }
  }
}
