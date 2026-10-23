// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Dirk Wahrheit

import { expect } from 'chai'
import { compileRules, decide } from '../src/rules.js'

const alarm = (message = 'x') => ({
  state: 'alarm',
  method: ['visual', 'sound'],
  message
})
const warn = (message = 'x') => ({
  state: 'warn',
  method: ['visual', 'sound'],
  message
})
const defaults = ['alarm', 'emergency']

describe('decide', () => {
  it('without rules sounds the configured states only', () => {
    expect(
      decide([], 'notifications.a', alarm(), undefined, defaults)
    ).to.deep.equal({ sound: true })
    expect(
      decide([], 'notifications.a', warn(), undefined, defaults)
    ).to.deep.equal({ sound: false })
  })

  it('never sounds a notification that does not ask to be heard', () => {
    const rules = compileRules([{ path: '**', action: 'sound' }])
    const visual = { state: 'alarm', method: ['visual'], message: 'x' }
    expect(
      decide(rules, 'notifications.a', visual, undefined, defaults).sound
    ).to.equal(false)
    expect(
      decide(
        rules,
        'notifications.a',
        { state: 'normal', method: ['sound'] },
        undefined,
        defaults
      ).sound
    ).to.equal(false)
  })

  it('keeps an alarm quiet that a silent rule names by message', () => {
    const rules = compileRules([
      { path: 'notifications.nmea.**', message: '8ohm', action: 'silent' }
    ])
    const path = 'notifications.nmea.alarm.navigational.22.20500'
    expect(
      decide(rules, path, alarm('Fire 8Ohm'), undefined, defaults).sound
    ).to.equal(false)
    expect(
      decide(rules, path, alarm('Highwater'), undefined, defaults).sound
    ).to.equal(true)
  })

  it('sounds a warning that a sound rule names, with its pattern', () => {
    const rules = compileRules([
      {
        path: 'notifications.nmea.warning.**',
        message: 'Highwater',
        action: 'sound',
        pattern: 2
      }
    ])
    expect(
      decide(
        rules,
        'notifications.nmea.warning.navigational.22.8196',
        warn('Highwater'),
        undefined,
        defaults
      )
    ).to.deep.equal({ sound: true, pattern: 2 })
  })

  it('lets the first matching rule decide', () => {
    const rules = compileRules([
      { path: 'notifications.nmea.**', message: 'Highwater', action: 'sound' },
      { path: 'notifications.nmea.**', action: 'silent' }
    ])
    expect(
      decide(
        rules,
        'notifications.nmea.alarm.x',
        alarm('Highwater'),
        undefined,
        defaults
      ).sound
    ).to.equal(true)
    expect(
      decide(
        rules,
        'notifications.nmea.alarm.x',
        alarm('CO 8Ohm'),
        undefined,
        defaults
      ).sound
    ).to.equal(false)
  })

  it('matches a source with a wildcard', () => {
    const rules = compileRules([
      { path: 'notifications.**', source: 'IPG100.*', action: 'silent' }
    ])
    expect(
      decide(
        rules,
        'notifications.a',
        alarm(),
        'IPG100.c0a0be00657be2e4',
        defaults
      ).sound
    ).to.equal(false)
    expect(
      decide(rules, 'notifications.a', alarm(), 'signalk-doctor', defaults)
        .sound
    ).to.equal(true)
    expect(
      decide(rules, 'notifications.a', alarm(), undefined, defaults).sound
    ).to.equal(true)
  })
})

describe('path patterns', () => {
  const silent = (path: string) => compileRules([{ path, action: 'silent' }])
  const quiet = (pattern: string, path: string) =>
    decide(silent(pattern), path, alarm(), undefined, defaults).sound === false

  it('matches * within one part only', () => {
    expect(
      quiet('notifications.*.anchor', 'notifications.navigation.anchor')
    ).to.equal(true)
    expect(
      quiet('notifications.*.anchor', 'notifications.a.b.anchor')
    ).to.equal(false)
    expect(quiet('notifications.doc*', 'notifications.doctor')).to.equal(true)
  })

  it('matches ** across parts', () => {
    expect(quiet('notifications.**', 'notifications.a.b.c')).to.equal(true)
    expect(
      quiet('notifications.**.anchor', 'notifications.a.b.anchor')
    ).to.equal(true)
  })

  it('takes everything else literally', () => {
    expect(quiet('notifications.a', 'notifications.ab')).to.equal(false)
    expect(quiet('notifications.a', 'notificationsXa')).to.equal(false)
    expect(quiet('notifications.a+', 'notifications.aa')).to.equal(false)
    expect(quiet('notifications.a+', 'notifications.a+')).to.equal(true)
  })

  it('answers a pattern of many wildcards against a long part at once', () => {
    // As a regular expression, the first match backtracks for over a minute.
    const path = 'notifications.' + 'a'.repeat(600)
    expect(quiet('notifications.*a*a*a*ab', path)).to.equal(false)
    expect(quiet('notifications.*a*a*a*a', path)).to.equal(true)
  })
})

describe('compileRules', () => {
  it('drops entries without a path or a known action', () => {
    expect(
      compileRules([
        { action: 'silent' },
        { path: 'x', action: 'beep' },
        null,
        { path: 'x', action: 'sound' }
      ])
    ).to.have.length(1)
    expect(compileRules(undefined)).to.deep.equal([])
  })

  it('drops entries whose message, source or pattern has the wrong type', () => {
    const rules = compileRules([
      { path: 'x', action: 'silent', message: 8 },
      { path: 'x', action: 'silent', source: 5 },
      { path: 'x', action: 'sound', pattern: 'loud' },
      { path: 'x', action: 'sound', pattern: 1.5 },
      { path: 'x', action: 'sound', message: 'ok', source: 'IPG*', pattern: 2 }
    ])
    expect(rules).to.have.length(1)
    expect(rules[0]?.rule.pattern).to.equal(2)
  })
})
