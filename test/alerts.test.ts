import { expect } from 'chai'
import { AlertIds, isSounding, severityOf, wantsSound } from '../src/alerts'

describe('wantsSound', () => {
  it('accepts a notification asking to be heard', () => {
    expect(
      wantsSound({ state: 'alarm', method: ['visual', 'sound'], message: 'x' })
    ).to.equal(true)
  })

  it('rejects a visual-only notification', () => {
    expect(wantsSound({ state: 'alarm', method: ['visual'] })).to.equal(false)
  })

  it('rejects a notification with no method', () => {
    expect(wantsSound({ state: 'alarm' })).to.equal(false)
  })

  it('rejects null, which is how a notification is cleared', () => {
    expect(wantsSound(null)).to.equal(false)
    expect(wantsSound(undefined)).to.equal(false)
  })
})

describe('severity', () => {
  it('ranks the sounding states above the quiet ones', () => {
    expect(severityOf('normal')).to.equal(0)
    expect(severityOf('nominal')).to.equal(0)
    expect(severityOf('warn')).to.be.greaterThan(severityOf('normal'))
    expect(severityOf('alert')).to.be.greaterThan(severityOf('warn'))
    expect(severityOf('alarm')).to.be.greaterThan(severityOf('alert'))
    expect(severityOf('emergency')).to.be.greaterThan(severityOf('alarm'))
  })

  it('treats an unknown state as quiet rather than guessing', () => {
    expect(severityOf('bananas')).to.equal(0)
    expect(isSounding('bananas')).to.equal(false)
  })

  it('knows which states sound', () => {
    expect(isSounding('emergency')).to.equal(true)
    expect(isSounding('normal')).to.equal(false)
    expect(isSounding(undefined)).to.equal(false)
  })
})

describe('AlertIds', () => {
  it('gives a path the same id every time', () => {
    const ids = new AlertIds(40000)
    const first = ids.idFor('notifications.a')
    expect(ids.idFor('notifications.a')).to.equal(first)
  })

  it('gives different paths different ids', () => {
    const ids = new AlertIds(40000)
    const a = ids.idFor('notifications.a')
    const b = ids.idFor('notifications.b')
    expect(a).to.not.equal(b)
  })

  it('allocates from the configured base', () => {
    const ids = new AlertIds(50000)
    expect(ids.idFor('notifications.a')).to.equal(50000)
    expect(ids.idFor('notifications.b')).to.equal(50001)
  })

  it('reports what it has handed out', () => {
    const ids = new AlertIds(40000)
    ids.idFor('notifications.a')
    ids.idFor('notifications.b')
    expect(ids.allocated()).to.deep.equal([40000, 40001])
  })

  it('runs out rather than colliding with ids outside its range', () => {
    const ids = new AlertIds(40000, 2)
    expect(ids.idFor('a')).to.equal(40000)
    expect(ids.idFor('b')).to.equal(40001)
    expect(ids.idFor('c')).to.equal(undefined)
    // and still remembers the ones it did allocate
    expect(ids.idFor('a')).to.equal(40000)
  })

  it('reports its range so it can be kept clear of other equipment', () => {
    expect(new AlertIds(40000, 64).range()).to.deep.equal({
      first: 40000,
      last: 40063
    })
  })
})
