// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Dirk Wahrheit

import { expect } from 'chai'
import { buildCommand } from '../src/command.js'

/*
 * The bytes are the real contract, so pin them.
 *
 * These two frames were captured from a Maretron ALM100 being driven by the
 * vessel's own software, then replayed from canboat to confirm they sound and
 * silence the device. Published as samples/maretron-alm100-command.raw in
 * canboat/canboat#833.
 *
 * canboatjs is not a dependency of this plugin -- the server owns the encoder
 * -- so this suite runs only when it happens to be resolvable, and skips
 * otherwise rather than failing.
 */

const SOUND_20493 =
  '3,126208,0,164,23,01,08,ff,01,f8,07,01,89,00,03,04,04,00,05,64,06,04,00,07,17,08,0d,50'

const SILENCE_20493 =
  '3,126208,0,164,23,01,08,ff,01,f8,07,01,89,00,03,04,04,00,05,00,06,ff,ff,07,17,08,0d,50'

describe('encoded frames', function () {
  let encode: ((pgn: any) => string) | undefined
  let FromPgn: any

  before(async function () {
    try {
      const canboatjs = await import('@canboat/canboatjs')
      const mod: any = (canboatjs as any).default ?? canboatjs
      encode = mod.pgnToActisenseSerialFormat
      FromPgn = mod.FromPgn
    } catch {
      encode = undefined
    }
    if (!encode) {
      // Skipping rather than failing is deliberate: the encoder belongs to the
      // server, not to this package. But these are the tests that pin the
      // bytes confirmed against real hardware, so say so loudly rather than
      // letting a green run hide them.
      console.warn(
        '\n  ! @canboat/canboatjs not installed: the byte-level frame tests did NOT run.\n'
      )
      this.skip()
    }
  })

  it('encodes the frame that sounds the annunciator', () => {
    const line = encode!(
      withSrc(
        buildCommand({
          dst: 164,
          instance: 0,
          sound: true,
          pattern: 4,
          alertId: 20493
        })
      )
    )
    expect(stripTimestamp(line)).to.equal(SOUND_20493)
  })

  it('encodes the frame that silences it', () => {
    const line = encode!(
      withSrc(
        buildCommand({
          dst: 164,
          instance: 0,
          sound: false,
          pattern: 4,
          alertId: 20493
        })
      )
    )
    expect(stripTimestamp(line)).to.equal(SILENCE_20493)
  })

  it('produces a frame the decoder reads back as Maretron, not B&G', () => {
    // The failure this guards against is silent: without the narrowing pairs
    // the frame decodes as bGKeyValueData with a bogus key, and nothing errors.
    const parser = new FromPgn({})
    const line = encode!(
      withSrc(
        buildCommand({
          dst: 164,
          instance: 0,
          sound: true,
          pattern: 4,
          alertId: 20493
        })
      )
    )
    const decoded = parser.parseString(line)
    expect(decoded).to.not.equal(undefined)
    const list = decoded.fields.list
    // Parameter 8 is the alert id in the Maretron variant. The B&G
    // mis-resolution loses it entirely.
    const alert = list.find((e: any) => e.parameter === 8)
    expect(alert?.value).to.equal(20493)
  })
})

/** The encoder wants a source; the gateway overwrites it on the way out. */
function withSrc(cmd: ReturnType<typeof buildCommand>) {
  return { ...cmd, src: 0 }
}

function stripTimestamp(line: string): string {
  return line.split(',').slice(1).join(',')
}
