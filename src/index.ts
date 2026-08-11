// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Dirk Wahrheit

/*
 * signalk-maretron-annunciator
 *
 * Sounds a Maretron ALM100 annunciator when Signal K notifications go active,
 * and silences it when they clear.
 */

import { buildCommand, PATTERN_MAX, PATTERN_MIN } from './command.js'
import {
  annunciatorCapabilities,
  identifyAnnunciator,
  productDetails
} from './device.js'
import { AlertIds, isSounding, severityOf, wantsSound } from './alerts.js'

const PLUGIN_ID = 'signalk-maretron-annunciator'

/** Node cannot hold a timer longer than 2^31-1 ms without wrapping. */
const MAX_REPEAT_SECONDS = Math.floor((2 ** 31 - 1) / 1000)

/** Pseudo-path used to allocate a stable alert id for manual PUT control. */
const MANUAL_PATH = '\u0000manual'

interface Options {
  enabled: boolean
  deviceAddress: number | undefined
  instance: number
  alertIdBase: number
  states: string[]
  patternFor: { state: string; pattern: number }[]
  defaultPattern: number
  repeatSeconds: number
}

export default function (app: any) {
  const plugin: any = {}
  const unsubscribes: (() => void)[] = []

  let options: Options
  let deviceAddress: number | undefined
  let alertIds: AlertIds
  let outAvailable = false
  let repeatTimer: NodeJS.Timeout | undefined
  // path -> notification value, for every notification currently asking to sound
  const active = new Map<string, any>()
  // the alert id we last told the device to sound, so we can silence that one
  let sounding: number | undefined
  // set by the PUT handler; sounds the annunciator regardless of notifications
  let manualSound = false
  let discovered: { modelId?: string; serial?: string } = {}
  // addresses confirmed as annunciators by an address claim; a 126996 alone
  // cannot identify one, as it carries no manufacturer code
  const confirmed = new Set<number>()

  plugin.id = PLUGIN_ID
  plugin.name = 'Maretron Annunciator'
  plugin.description =
    'Sound a Maretron ALM100 annunciator from Signal K notifications'

  plugin.schema = () => ({
    type: 'object',
    properties: {
      enabled: {
        type: 'boolean',
        title: 'Sound the annunciator',
        description:
          'Turn off to leave the annunciator alone without stopping the plugin.',
        default: true
      },
      deviceAddress: {
        type: 'number',
        title: 'Annunciator address (leave empty to discover)',
        description:
          'The NMEA 2000 address of the annunciator. Normally discovered automatically from its address claim; set this only if discovery does not find it.',
        minimum: 0,
        maximum: 251,
        multipleOf: 1
      },
      instance: {
        type: 'number',
        title: 'Annunciator instance',
        default: 0,
        minimum: 0,
        maximum: 252,
        multipleOf: 1
      },
      alertIdBase: {
        type: 'number',
        title: 'First alert id to use',
        description:
          'Alert ids are allocated from here, one per notification path. Keep this clear of the ids your other equipment already uses.',
        default: 40000,
        minimum: 0,
        maximum: 65534,
        multipleOf: 1
      },
      states: {
        type: 'array',
        title: 'Notification states that sound the annunciator',
        default: ['alarm', 'emergency'],
        items: {
          type: 'string',
          enum: ['warn', 'alert', 'alarm', 'emergency']
        },
        uniqueItems: true
      },
      defaultPattern: {
        type: 'number',
        title: 'Default pulse pattern (0-4)',
        description:
          'The ALM100 reports five patterns. They differ in beep cadence rather than pitch; the device does not name them, so try them to find the one you want.',
        default: 4,
        minimum: PATTERN_MIN,
        maximum: PATTERN_MAX,
        multipleOf: 1
      },
      patternFor: {
        type: 'array',
        title: 'Pattern per notification state',
        description: 'Optional. States not listed use the default pattern.',
        items: {
          type: 'object',
          properties: {
            state: {
              type: 'string',
              title: 'State',
              enum: ['warn', 'alert', 'alarm', 'emergency']
            },
            pattern: {
              type: 'number',
              title: 'Pattern (0-4)',
              minimum: PATTERN_MIN,
              maximum: PATTERN_MAX,
              multipleOf: 1
            }
          }
        }
      },
      repeatSeconds: {
        type: 'number',
        title: 'Repeat the sound command every (seconds)',
        description:
          'The annunciator keeps sounding on its own; this only guards against a command being missed. 0 disables it.',
        default: 30,
        minimum: 0,
        maximum: MAX_REPEAT_SECONDS,
        multipleOf: 1
      }
    }
  })

  plugin.start = (opts: Partial<Options>) => {
    options = {
      enabled: opts.enabled !== false,
      deviceAddress: opts.deviceAddress,
      instance: opts.instance ?? 0,
      alertIdBase: opts.alertIdBase ?? 40000,
      // An explicitly empty list means "never sound for notifications", which
      // leaves the PUT handler as the only way to sound the device.
      states: opts.states ?? ['alarm', 'emergency'],
      patternFor: opts.patternFor ?? [],
      defaultPattern: opts.defaultPattern ?? 4,
      repeatSeconds: opts.repeatSeconds ?? 30
    }

    alertIds = new AlertIds(options.alertIdBase)
    deviceAddress = options.deviceAddress
    active.clear()
    confirmed.clear()
    sounding = undefined
    manualSound = false

    app.on('nmea2000OutAvailable', onOutAvailable)
    unsubscribes.push(() =>
      app.removeListener?.('nmea2000OutAvailable', onOutAvailable)
    )

    app.on('N2KAnalyzerOut', onN2K)
    unsubscribes.push(() => app.removeListener?.('N2KAnalyzerOut', onN2K))

    subscribeToNotifications()
    registerPutHandler()
    updateStatus()

    if (deviceAddress === undefined) {
      // Ask the bus who is out there rather than waiting for a periodic claim.
      requestAddressClaims()
    }
  }

  plugin.stop = () => {
    if (repeatTimer) {
      clearInterval(repeatTimer)
      repeatTimer = undefined
    }
    // Leave the annunciator quiet rather than stuck sounding.
    if (sounding !== undefined) {
      silence(sounding)
    }
    unsubscribes.forEach((f) => {
      try {
        f()
      } catch (e) {
        app.debug('unsubscribe failed: %s', e)
      }
    })
    unsubscribes.length = 0
    active.clear()
  }

  function onOutAvailable() {
    if (!outAvailable) {
      outAvailable = true
      app.debug('NMEA 2000 output is available')
      // The gateway is usually not ready when the plugin starts, so this is
      // where discovery actually gets to happen.
      if (deviceAddress === undefined) {
        requestAddressClaims()
      }
      // Anything that went active while we had no way to send it still needs
      // announcing.
      reconcile()
      updateStatus()
    }
  }

  function onN2K(pgn: any) {
    const found = identifyAnnunciator(pgn, confirmed)
    if (found !== undefined) {
      confirmed.add(found)
      if (pgn.pgn === 126996) {
        discovered = productDetails(pgn)
      }
      if (options.deviceAddress === undefined && deviceAddress !== found) {
        app.debug('discovered annunciator at address %d', found)
        deviceAddress = found
        updateStatus()
        // Re-assert whatever we believe the current state is at the new address.
        reconcile()
      }
      return
    }

    if (deviceAddress !== undefined) {
      const caps = annunciatorCapabilities(pgn, deviceAddress)
      if (caps) {
        app.debug(
          'annunciator instance %d reports patterns %j',
          caps.instance,
          caps.patterns
        )
      }
    }
  }

  function requestAddressClaims() {
    // Deliberately not gated on canSend(): this is what finds the address in
    // the first place, and it is a broadcast, so it needs no destination.
    if (!outAvailable) {
      return
    }
    // ISO Request for 60928, broadcast. Every device answers with its claim.
    app.emit('nmea2000JsonOut', {
      pgn: 59904,
      prio: 6,
      dst: 255,
      fields: { pgn: 60928 }
    })
  }

  function subscribeToNotifications() {
    const command = {
      context: 'vessels.self',
      subscribe: [{ path: 'notifications.*', policy: 'instant' }]
    }
    app.subscriptionmanager.subscribe(
      command,
      unsubscribes,
      (error: any) => app.error(error),
      onDelta
    )
  }

  function onDelta(delta: any) {
    let changed = false
    delta.updates?.forEach((update: any) => {
      update.values?.forEach((value: any) => {
        if (!value?.path?.startsWith('notifications.')) {
          return
        }
        const v = value.value
        const shouldSound =
          wantsSound(v) &&
          isSounding(v.state) &&
          options.states.indexOf(v.state) !== -1

        if (shouldSound) {
          if (!active.has(value.path)) {
            app.debug('%s went %s', value.path, v.state)
          }
          active.set(value.path, v)
          changed = true
        } else if (active.delete(value.path)) {
          app.debug('%s cleared', value.path)
          changed = true
        }
      })
    })
    if (changed) {
      reconcile()
    }
  }

  /**
   * Bring the annunciator into line with what should be sounding: the most
   * severe active notification, or manual control from the PUT handler.
   */
  function reconcile() {
    if (!options.enabled) {
      if (sounding !== undefined) {
        silence(sounding)
      }
      stopRepeat()
      updateStatus()
      return
    }

    const worst = mostSevere()

    if (!worst && !manualSound) {
      if (sounding !== undefined) {
        silence(sounding)
      }
      stopRepeat()
      updateStatus()
      return
    }

    // A real notification wins over manual control, so a test left switched on
    // cannot mask an actual alarm.
    const path = worst ? worst.path : MANUAL_PATH
    const pattern = worst
      ? patternFor(worst.value.state)
      : options.defaultPattern

    const alertId = alertIds.idFor(path)
    if (alertId === undefined) {
      app.error(
        `no alert id left for ${path}; raise the alert id range if you have more than 64 sounding notifications`
      )
      return
    }

    // Switching between alerts: silence the old id first so the device is not
    // left with a stale binding sounding.
    if (sounding !== undefined && sounding !== alertId) {
      silence(sounding)
    }

    sound(alertId, pattern)
    startRepeat(alertId, pattern)
    updateStatus()
  }

  function mostSevere(): { path: string; value: any } | undefined {
    let best: { path: string; value: any } | undefined
    active.forEach((value, path) => {
      if (!best || severityOf(value.state) > severityOf(best.value.state)) {
        best = { path, value }
      }
    })
    return best
  }

  function patternFor(state: string): number {
    const found = options.patternFor.find((p) => p.state === state)
    const pattern = found?.pattern ?? options.defaultPattern
    return Math.min(PATTERN_MAX, Math.max(PATTERN_MIN, pattern))
  }

  function sound(alertId: number, pattern: number) {
    if (!send(true, alertId, pattern)) {
      return
    }
    sounding = alertId
  }

  function silence(alertId: number) {
    send(false, alertId, 0)
    sounding = undefined
  }

  function send(sounding: boolean, alertId: number, pattern: number): boolean {
    if (!canSend()) {
      return false
    }
    try {
      const command = buildCommand({
        dst: deviceAddress as number,
        instance: options.instance,
        sound: sounding,
        pattern,
        alertId
      })
      app.debug('sending %j', command)
      app.emit('nmea2000JsonOut', command)
      return true
    } catch (e: any) {
      app.error(`could not build annunciator command: ${e.message}`)
      return false
    }
  }

  function canSend(): boolean {
    if (deviceAddress === undefined) {
      return false
    }
    if (!outAvailable) {
      app.debug('no NMEA 2000 output available yet')
      return false
    }
    return true
  }

  function startRepeat(alertId: number, pattern: number) {
    stopRepeat()
    if (options.repeatSeconds <= 0) {
      return
    }
    // Node wraps any delay over 2^31-1 ms to 1 ms, which would turn a silly
    // config value into a flood of frames on the bus.
    const seconds = Math.min(options.repeatSeconds, MAX_REPEAT_SECONDS)
    repeatTimer = setInterval(
      () => send(true, alertId, pattern),
      seconds * 1000
    )
  }

  function stopRepeat() {
    if (repeatTimer) {
      clearInterval(repeatTimer)
      repeatTimer = undefined
    }
  }

  function registerPutHandler() {
    const path = `electrical.annunciators.${options.instance}.state`
    app.registerPutHandler(
      'vessels.self',
      path,
      (_context: string, _p: string, value: any) => {
        if (deviceAddress === undefined) {
          return {
            state: 'COMPLETED',
            statusCode: 404,
            message: 'no annunciator found'
          }
        }
        // Manual control is held as its own state so reconcile() can weigh it
        // against the notifications rather than the two fighting over the
        // device. Turning it on sounds the annunciator even with nothing
        // active; turning it off hands control back to the notifications,
        // which may immediately sound it again if something is still active.
        manualSound = value === true || value === 'on' || value === 1
        app.debug('manual annunciator control: %s', manualSound ? 'on' : 'off')
        reconcile()
        return { state: 'COMPLETED', statusCode: 200 }
      }
    )
  }

  function updateStatus() {
    if (deviceAddress === undefined) {
      app.setPluginStatus('Looking for an annunciator on the bus')
      return
    }
    const who = discovered.modelId
      ? `${discovered.modelId} at ${deviceAddress}`
      : `annunciator at ${deviceAddress}`
    if (!options.enabled) {
      app.setPluginStatus(`${who} (sounding disabled)`)
    } else if (!outAvailable) {
      app.setPluginStatus(`${who}, waiting for NMEA 2000 output`)
    } else if (sounding !== undefined) {
      app.setPluginStatus(`${who}: sounding, alert ${sounding}`)
    } else {
      app.setPluginStatus(`${who}: quiet`)
    }
  }

  return plugin
}
