import { expect } from 'chai'
import {
  annunciatorCapabilities,
  identifyAnnunciator,
  productDetails
} from '../src/device.js'

/*
 * The fixtures below are real decoded PGNs from a Maretron ALM100, taken from
 * the captures published as samples/maretron-alm100-*.raw in
 * canboat/canboat#833.
 */

const ADDRESS_CLAIM = {
  pgn: 60928,
  src: 164,
  fields: {
    'Unique Number': 1462536,
    'Manufacturer Code': 'Maretron',
    'Device Function': 'Alarm Enunciator',
    'Device Class': 'Safety systems',
    'Industry Group': 'Marine Industry'
  }
}

const PRODUCT_INFO = {
  pgn: 126996,
  src: 164,
  fields: {
    'Product Code': 8165,
    'Model ID': 'ALM100',
    'Software Version Code': '1.0.6',
    'Model Serial Code': '1462536'
  }
}

const CAPABILITIES = {
  pgn: 130817,
  src: 164,
  fields: {
    'Manufacturer Code': 'Maretron',
    'Industry Code': 'Marine Industry',
    'Annunciator Instance': 0,
    'Number of Tones': 5,
    list: [{ Tone: 0 }, { Tone: 1 }, { Tone: 2 }, { Tone: 3 }, { Tone: 4 }]
  }
}

describe('identifyAnnunciator', () => {
  it('recognises the address claim without needing a product code', () => {
    expect(identifyAnnunciator(ADDRESS_CLAIM)).to.equal(164)
  })

  it('confirms product information only for an already-known address', () => {
    // 126996 carries no manufacturer code, and product codes are only unique
    // within a manufacturer, so it must not identify a device on its own.
    expect(identifyAnnunciator(PRODUCT_INFO)).to.equal(undefined)
    expect(identifyAnnunciator(PRODUCT_INFO, new Set([164]))).to.equal(164)
  })

  it('does not confirm product information for some other address', () => {
    expect(identifyAnnunciator(PRODUCT_INFO, new Set([99]))).to.equal(undefined)
  })

  it('accepts a numeric manufacturer code', () => {
    const claim = {
      ...ADDRESS_CLAIM,
      fields: { ...ADDRESS_CLAIM.fields, 'Manufacturer Code': 137 }
    }
    expect(identifyAnnunciator(claim)).to.equal(164)
  })

  it('accepts camelCase field names', () => {
    const claim = {
      pgn: 60928,
      src: 21,
      fields: {
        manufacturerCode: 'Maretron',
        deviceFunction: 'Alarm Enunciator',
        deviceClass: 'Safety systems'
      }
    }
    expect(identifyAnnunciator(claim)).to.equal(21)
  })

  it('ignores another vendor claiming to be an enunciator', () => {
    const claim = {
      ...ADDRESS_CLAIM,
      fields: { ...ADDRESS_CLAIM.fields, 'Manufacturer Code': 'Navico' }
    }
    expect(identifyAnnunciator(claim)).to.equal(undefined)
  })

  it('ignores a Maretron device that is not an annunciator', () => {
    const tank = {
      pgn: 60928,
      src: 33,
      fields: {
        'Manufacturer Code': 'Maretron',
        'Device Function': 'Fluid Level',
        'Device Class': 'Instrumentation'
      }
    }
    expect(identifyAnnunciator(tank)).to.equal(undefined)
  })

  it('ignores a different Maretron product code', () => {
    const tlm = {
      pgn: 126996,
      src: 33,
      fields: { 'Product Code': 4319, 'Model ID': 'J2K100' }
    }
    expect(identifyAnnunciator(tlm, new Set([33]))).to.equal(undefined)
  })

  it('ignores unrelated PGNs and junk', () => {
    expect(identifyAnnunciator({ pgn: 127250, src: 4, fields: {} })).to.equal(
      undefined
    )
    expect(identifyAnnunciator(undefined)).to.equal(undefined)
    expect(identifyAnnunciator({ pgn: 60928 })).to.equal(undefined)
  })
})

describe('productDetails', () => {
  it('reads the model and serial', () => {
    expect(productDetails(PRODUCT_INFO)).to.deep.equal({
      modelId: 'ALM100',
      serial: '1462536'
    })
  })
})

describe('annunciatorCapabilities', () => {
  it('reads the instance and the pattern list', () => {
    expect(annunciatorCapabilities(CAPABILITIES, 164)).to.deep.equal({
      instance: 0,
      patterns: [0, 1, 2, 3, 4]
    })
  })

  it('ignores capabilities from a different device', () => {
    expect(annunciatorCapabilities(CAPABILITIES, 99)).to.equal(undefined)
  })

  it('ignores another manufacturer sharing the PGN', () => {
    const navico = {
      ...CAPABILITIES,
      fields: { ...CAPABILITIES.fields, 'Manufacturer Code': 'Navico' }
    }
    expect(annunciatorCapabilities(navico, 164)).to.equal(undefined)
  })
})
