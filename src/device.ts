/*
 * Finding the annunciator on the bus.
 *
 * The device's address is not fixed -- it is assigned by address claim and can
 * change -- so it is discovered rather than configured, with a manual override
 * for unusual setups.
 */

/** Maretron's product code for the ALM100, per MARETRON_PRODUCT_CODE. */
export const ALM100_PRODUCT_CODE = 8165

export interface FoundDevice {
  address: number
  /** Model id from 126996, when we have seen one. */
  modelId?: string
  /** Serial from 126996, when we have seen one. */
  serial?: string
  lastSeen: number
}

/**
 * Recognise an annunciator from an inbound PGN.
 *
 * The authoritative signal is 60928 ISO Address Claim carrying Maretron's
 * manufacturer code with Device Function "Alarm Enunciator" and Device Class
 * "Safety systems". That needs no product code, so it also covers Maretron
 * annunciators that are not an ALM100.
 *
 * 126996 Product Information carries a product code but, unlike the address
 * claim, has no manufacturer field of its own -- product codes are only unique
 * within a manufacturer. So a 126996 is accepted only to confirm an address
 * already identified by an address claim, never to identify one on its own;
 * pass the set of addresses confirmed so far as `known`.
 *
 * Returns the source address if this PGN identifies an annunciator, else
 * undefined. `pgn` is a decoded canboat object as delivered by the server.
 */
export function identifyAnnunciator(
  pgn: any,
  known?: ReadonlySet<number>
): number | undefined {
  if (!pgn || typeof pgn.src !== 'number') {
    return undefined
  }
  const f = pgn.fields ?? {}

  if (pgn.pgn === 60928) {
    const fn = f['Device Function'] ?? f.deviceFunction
    const cls = f['Device Class'] ?? f.deviceClass
    const mfg = f['Manufacturer Code'] ?? f.manufacturerCode
    if (
      isMaretron(mfg) &&
      matches(fn, 'Alarm Enunciator') &&
      matches(cls, 'Safety systems')
    ) {
      return pgn.src
    }
    return undefined
  }

  if (pgn.pgn === 126996 && known?.has(pgn.src)) {
    const code = f['Product Code'] ?? f.productCode
    if (Number(code) === ALM100_PRODUCT_CODE) {
      return pgn.src
    }
    return undefined
  }

  return undefined
}

/**
 * Pull the model id and serial out of a 126996 for display, when present.
 */
export function productDetails(
  pgn: any
): Pick<FoundDevice, 'modelId' | 'serial'> {
  const f = pgn?.fields ?? {}
  const modelId = f['Model ID'] ?? f.modelId
  const serial = f['Model Serial Code'] ?? f.modelSerialCode
  return {
    modelId: typeof modelId === 'string' ? modelId : undefined,
    serial: typeof serial === 'string' ? serial : undefined
  }
}

/**
 * Read the annunciator instance and supported pattern count out of a 130817
 * Annunciator Capabilities reply, if this is one from `address`.
 */
export function annunciatorCapabilities(
  pgn: any,
  address: number
): { instance: number; patterns: number[] } | undefined {
  if (!pgn || pgn.pgn !== 130817 || pgn.src !== address) {
    return undefined
  }
  const f = pgn.fields ?? {}
  const mfg = f['Manufacturer Code'] ?? f.manufacturerCode
  if (!isMaretron(mfg)) {
    return undefined
  }
  const instance = Number(
    f['Annunciator Instance'] ?? f.annunciatorInstance ?? 0
  )
  const list = f.list ?? f.List
  const patterns: number[] = Array.isArray(list)
    ? list
        .map((e: any) => Number(e?.Tone ?? e?.tone))
        .filter((n: number) => Number.isFinite(n))
    : []
  return { instance, patterns }
}

function isMaretron(v: unknown): boolean {
  return v === 137 || matches(v, 'Maretron')
}

/** Canboat may hand us either the lookup name or its numeric value. */
function matches(v: unknown, name: string): boolean {
  return typeof v === 'string' && v.toLowerCase() === name.toLowerCase()
}
