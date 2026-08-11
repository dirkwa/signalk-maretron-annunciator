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
  private readonly byPath = new Map<string, number>()

  constructor(base: number, limit = 64) {
    this.base = base
    this.limit = limit
  }

  /**
   * The id for a path.
   *
   * Derived from the path itself rather than handed out in arrival order, so a
   * given path keeps the same id across restarts however the notifications
   * happen to arrive. Collisions are resolved by probing, which means an id can
   * still move if a colliding path is seen first -- but only between paths that
   * hash together, not on every restart.
   *
   * Stability here is a nicety rather than a correctness requirement: a sound
   * command is self-contained, and the device sounds for whatever alert id it
   * is given without needing that id registered first.
   */
  idFor(path: string): number | undefined {
    const existing = this.byPath.get(path)
    if (existing !== undefined) {
      return existing
    }
    if (this.byPath.size >= this.limit) {
      return undefined
    }
    const taken = new Set(this.byPath.values())
    const start = hash(path) % this.limit
    for (let i = 0; i < this.limit; i++) {
      const id = this.base + ((start + i) % this.limit)
      if (!taken.has(id)) {
        this.byPath.set(path, id)
        return id
      }
    }
    return undefined
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

/** FNV-1a, for a stable id that does not depend on arrival order. */
function hash(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h >>> 0
}
