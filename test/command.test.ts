// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Dirk Wahrheit

import { expect } from 'chai'
import { buildCommand } from '../src/command.js'

/*
 * The two frames below are the contract. They were captured from a real
 * Maretron ALM100 being driven by the vessel's own configuration software,
 * and then replayed from canboat to confirm they sound and silence the
 * device. They are published as samples/maretron-alm100-command.raw in
 * canboat/canboat#833.
 *
 * The encoder is not a dependency of this package, so these tests assert the
 * command structure that produces those bytes rather than the bytes
 * themselves. encoded.test.ts checks the bytes when canboatjs is present.
 */

describe('buildCommand', () => {
  it('leads with the pairs that narrow the target to the Maretron variant', () => {
    const cmd = buildCommand({
      dst: 164,
      instance: 0,
      sound: true,
      pattern: 4,
      alertId: 20493
    })
    // Without parameters 1 and 3 the encoder resolves PRN 130824 to the B&G
    // variant and emits a frame one byte short. See canboat/canboatjs#458.
    expect(cmd.fields.list[0]).to.deep.equal({ parameter: 1, value: 137 })
    expect(cmd.fields.list[1]).to.deep.equal({ parameter: 3, value: 4 })
    expect(cmd.fields.numberOfParameters).to.equal(7)
    expect(cmd.fields.list).to.have.length(7)
  })

  it('targets 130824 as an addressed command', () => {
    const cmd = buildCommand({
      dst: 164,
      instance: 0,
      sound: true,
      pattern: 4,
      alertId: 20493
    })
    expect(cmd.pgn).to.equal(126208)
    expect(cmd.fields['Function Code']).to.equal('Command')
    expect(cmd.fields.PGN).to.equal(130824)
    // 126208 must be addressed; broadcast does not reach the device.
    expect(cmd.dst).to.equal(164)
  })

  it('sounds with state 100 and the requested pattern', () => {
    const cmd = buildCommand({
      dst: 164,
      instance: 0,
      sound: true,
      pattern: 4,
      alertId: 20493
    })
    expect(byParameter(cmd, 4)).to.equal(0) // instance
    expect(byParameter(cmd, 5)).to.equal(100) // state: sounding
    expect(byParameter(cmd, 6)).to.equal(4) // pattern
    expect(byParameter(cmd, 7)).to.equal(23) // constant in every observed frame
    expect(byParameter(cmd, 8)).to.equal(20493) // alert id
  })

  it('silences with state 0 and an explicit unavailable pattern', () => {
    const cmd = buildCommand({
      dst: 164,
      instance: 0,
      sound: false,
      pattern: 4,
      alertId: 20493
    })
    expect(byParameter(cmd, 5)).to.equal(0)
    // Must be the explicit sentinel: left undefined, canboat-wasm throws and
    // canboatjs silently drops a byte.
    expect(byParameter(cmd, 6)).to.equal(0xffff)
  })

  it('carries the instance through', () => {
    const cmd = buildCommand({
      dst: 164,
      instance: 3,
      sound: true,
      pattern: 0,
      alertId: 40000
    })
    expect(byParameter(cmd, 4)).to.equal(3)
    expect(byParameter(cmd, 8)).to.equal(40000)
  })

  it('rejects an unusable destination', () => {
    expect(() =>
      buildCommand({
        dst: 255,
        instance: 0,
        sound: true,
        pattern: 4,
        alertId: 1
      })
    ).to.throw(/0\.\.251/)
  })

  it('rejects a pattern the device does not have', () => {
    expect(() =>
      buildCommand({
        dst: 164,
        instance: 0,
        sound: true,
        pattern: 9,
        alertId: 1
      })
    ).to.throw(/pattern/)
  })

  it('does not validate the pattern when silencing', () => {
    expect(() =>
      buildCommand({
        dst: 164,
        instance: 0,
        sound: false,
        pattern: 9,
        alertId: 1
      })
    ).to.not.throw()
  })
})

function byParameter(cmd: ReturnType<typeof buildCommand>, parameter: number) {
  return cmd.fields.list.find((e) => e.parameter === parameter)?.value
}
