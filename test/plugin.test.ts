// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Dirk Wahrheit

import { expect } from 'chai'
import createPlugin from '../src/index.js'

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

const soundParameter = (command: any) =>
  command.fields.list.find((p: any) => p.parameter === 5)?.value

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
})
