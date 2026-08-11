// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Dirk Wahrheit

/*
 * Building the NMEA 2000 command that drives a Maretron ALM100 annunciator.
 *
 * The annunciator is not written directly. PGN 130824 (Maretron: Annunciator)
 * is a status report: the device lists it only on its transmit side and
 * ignores writes to it. It is commanded by a 126208 NMEA Command group
 * function addressed to the device, targeting PGN 130824 and writing that
 * PGN's fields.
 *
 * See https://github.com/canboat/canboat/pull/833 for how this was determined,
 * and research/maretron_alm100.md in that PR for the captures.
 */

/** Maretron's NMEA 2000 manufacturer code. */
export const MARETRON = 137

/** Industry code 4, Marine. */
export const MARINE_INDUSTRY = 4

/** PGN the command targets. */
export const ANNUNCIATOR_PGN = 130824

/** Annunciator State value that sounds the device. */
export const STATE_SOUND = 100

/** Annunciator State value that silences it. */
export const STATE_SILENT = 0

/**
 * Field 7 of 130824. Its meaning is unknown: it was 23 in every frame ever
 * observed, both from Maretron's own software and in replayed commands, and
 * nothing has been seen to vary it.
 */
export const FIELD7_CONSTANT = 23

/** UINT16 "unavailable" sentinel, used for Pattern when idle. */
const UNAVAILABLE_U16 = 0xffff

/** Patterns the ALM100 reports via 130817. They differ in beep cadence. */
export const PATTERN_MIN = 0
export const PATTERN_MAX = 4

export interface AnnunciatorCommand {
  pgn: number
  prio: number
  dst: number
  fields: {
    'Function Code': string
    PGN: number
    priority: number
    numberOfParameters: number
    list: { parameter: number; value: number }[]
  }
}

export interface CommandArgs {
  /** CAN address of the annunciator. 126208 must be addressed, not broadcast. */
  dst: number
  /** Annunciator instance, as reported in 130817. Normally 0. */
  instance: number
  /** True to sound the device, false to silence it. */
  sound: boolean
  /** Pulse pattern 0..4. Ignored when silencing. */
  pattern: number
  /** The alert id the annunciator is being asked to announce. */
  alertId: number
}

/**
 * Build the 126208 Command group function.
 *
 * Two encoding rules matter here, both of which produce silently wrong frames
 * if ignored:
 *
 * 1. PRN 130824 has two variants -- bGKeyValueData and maretronAnnunciator.
 *    The parameter list must lead with the manufacturer and industry pairs so
 *    the encoder can narrow the target to the Maretron variant. Without them
 *    canboatjs encodes against B&G's dynamic key/value fields and emits a
 *    frame one byte short (canboat-wasm throws instead). See
 *    https://github.com/canboat/canboatjs/issues/458.
 *
 * 2. Pattern when silencing must be written as an explicit 0xffff. Left
 *    undefined, canboat-wasm throws and canboatjs silently drops a byte.
 */
export function buildCommand({
  dst,
  instance,
  sound,
  pattern,
  alertId
}: CommandArgs): AnnunciatorCommand {
  if (!Number.isInteger(dst) || dst < 0 || dst > 251) {
    throw new Error(`annunciator address must be 0..251, got ${dst}`)
  }
  if (!Number.isInteger(instance) || instance < 0 || instance > 252) {
    throw new Error(`annunciator instance must be 0..252, got ${instance}`)
  }
  if (!Number.isInteger(alertId) || alertId < 0 || alertId > 0xfffe) {
    throw new Error(`alert id must be 0..65534, got ${alertId}`)
  }
  if (
    sound &&
    (!Number.isInteger(pattern) ||
      pattern < PATTERN_MIN ||
      pattern > PATTERN_MAX)
  ) {
    throw new Error(
      `pattern must be ${PATTERN_MIN}..${PATTERN_MAX}, got ${pattern}`
    )
  }

  return {
    pgn: 126208,
    prio: 3,
    dst,
    fields: {
      'Function Code': 'Command',
      PGN: ANNUNCIATOR_PGN,
      priority: 8, // "leave unchanged"
      numberOfParameters: 7,
      list: [
        { parameter: 1, value: MARETRON },
        { parameter: 3, value: MARINE_INDUSTRY },
        { parameter: 4, value: instance },
        { parameter: 5, value: sound ? STATE_SOUND : STATE_SILENT },
        { parameter: 6, value: sound ? pattern : UNAVAILABLE_U16 },
        { parameter: 7, value: FIELD7_CONSTANT },
        { parameter: 8, value: alertId }
      ]
    }
  }
}
