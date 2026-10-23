// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Dirk Wahrheit

import { expect } from 'chai'
import createPlugin from '../src/index.js'
import { AlertIds } from '../src/alerts.js'

/** Just enough of the server's app object for the plugin to run against. */
function fakeServer() {
  const listeners = new Map<string, () => void>()
  const sent: any[] = []
  const errors: string[] = []
  let onDelta: (delta: any) => void = () => {}
  const app = {
    on: (event: string, fn: () => void) => listeners.set(event, fn),
    removeListener: (event: string) => listeners.delete(event),
    emit: (event: string, msg: any) => {
      if (event === 'nmea2000JsonOut') sent.push(msg)
    },
    subscriptionmanager: {
      subscribe: (_c: any, _u: any, _e: any, cb: (delta: any) => void) => {
        onDelta = cb
      }
    },
    registerPutHandler: () => {},
    setPluginStatus: () => {},
    debug: () => {},
    error: (msg: unknown) => errors.push(String(msg))
  }
  return {
    app,
    sent,
    errors,
    outAvailable: () => listeners.get('nmea2000OutAvailable')?.(),
    notify: (path: string, value: any) =>
      onDelta({ updates: [{ values: [{ path, value }] }] })
  }
}

const parameter = (command: any, n: number) =>
  command.fields.list.find((p: any) => p.parameter === n)?.value
const soundParameter = (command: any) => parameter(command, 5)

describe('plugin', () => {
  it('keeps sounding after more alarms than it has alert ids have come and gone', () => {
    const server = fakeServer()
    const plugin = createPlugin(server.app)
    plugin.start({ deviceAddress: 5, repeatSeconds: 0 })
    server.outAvailable()

    for (let i = 0; i < 70; i++) {
      const path = `notifications.test.${i}`
      server.notify(path, { state: 'alarm', method: ['sound'], message: 'x' })
      server.notify(path, { state: 'normal', method: [], message: 'x' })
    }
    const before = server.sent.length
    server.notify('notifications.test.last', {
      state: 'alarm',
      method: ['sound'],
      message: 'x'
    })

    expect(server.errors).to.deep.equal([])
    expect(server.sent.length).to.equal(before + 1)
    expect(soundParameter(server.sent[before])).to.equal(100)
    plugin.stop()
  })

  it('silences an id before sounding it again for another notification', () => {
    // Two paths that hash to the same id: once the first clears, the second
    // gets that id back.
    const first = 'notifications.test.first'
    const id = new AlertIds(40000).idFor(first)
    let second = ''
    for (let i = 0; second === ''; i++) {
      const candidate = `notifications.test.other${i}`
      if (new AlertIds(40000).idFor(candidate) === id) second = candidate
    }

    const server = fakeServer()
    const plugin = createPlugin(server.app)
    plugin.start({
      deviceAddress: 5,
      repeatSeconds: 0,
      states: ['warn', 'alarm']
    })
    server.outAvailable()
    server.notify(first, { state: 'alarm', method: ['sound'], message: 'x' })
    server.notify(second, { state: 'warn', method: ['sound'], message: 'y' })
    const before = server.sent.length
    server.notify(first, { state: 'normal', method: [], message: 'x' })

    const after = server.sent.slice(before)
    expect(
      after.map((c) => [soundParameter(c), parameter(c, 8)])
    ).to.deep.equal([
      [0, id],
      [100, id]
    ])
    plugin.stop()
  })
})
