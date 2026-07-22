import { midPrice, type ChainOption, type ChainSlice, type Leg, type OptionKind } from './types'

let seq = 0
export function newLegId(): string {
  return `leg-${Date.now().toString(36)}-${(seq++).toString(36)}`
}

export function legFromChain(
  o: ChainOption,
  expiry: number,
  side: 1 | -1,
  qty = 1,
): Leg {
  return {
    id: newLegId(),
    kind: o.kind,
    side,
    qty,
    strike: o.strike,
    expiry,
    iv: o.iv > 0 ? o.iv : 0.25,
    entryPrice: midPrice(o),
    contractSymbol: o.contractSymbol,
  }
}

export interface StrategyPreset {
  key: string
  name: string
  hint: string
  /** Builds legs from the loaded expiry slice; null when the chain is too sparse. */
  build: (slice: ChainSlice, spot: number) => Leg[] | null
}

interface StrikeRow {
  strike: number
  call?: ChainOption
  put?: ChainOption
}

function rows(slice: ChainSlice): StrikeRow[] {
  const map = new Map<number, StrikeRow>()
  for (const c of slice.calls) map.set(c.strike, { strike: c.strike, call: c })
  for (const p of slice.puts) {
    const row = map.get(p.strike)
    if (row) row.put = p
    else map.set(p.strike, { strike: p.strike, put: p })
  }
  return [...map.values()].sort((a, b) => a.strike - b.strike)
}

/** Rows that have both sides quoted, centred on the ATM strike. */
function usableRows(slice: ChainSlice, spot: number): { list: StrikeRow[]; atm: number } {
  const list = rows(slice).filter((r) => r.call && r.put)
  if (!list.length) return { list, atm: -1 }
  let atm = 0
  for (let i = 1; i < list.length; i++) {
    if (Math.abs(list[i].strike - spot) < Math.abs(list[atm].strike - spot)) atm = i
  }
  return { list, atm }
}

function pick(
  list: StrikeRow[],
  atm: number,
  offset: number,
  kind: OptionKind,
): ChainOption | undefined {
  const row = list[atm + offset]
  return kind === 'call' ? row?.call : row?.put
}

function build(
  slice: ChainSlice,
  spot: number,
  specs: Array<{ offset: number; kind: OptionKind; side: 1 | -1; qty?: number }>,
): Leg[] | null {
  const { list, atm } = usableRows(slice, spot)
  if (atm < 0) return null
  const legs: Leg[] = []
  for (const s of specs) {
    const opt = pick(list, atm, s.offset, s.kind)
    if (!opt) return null
    legs.push(legFromChain(opt, slice.expiry, s.side, s.qty ?? 1))
  }
  return legs
}

export const STRATEGY_PRESETS: StrategyPreset[] = [
  {
    key: 'long-call',
    name: 'Long call',
    hint: 'Bullish · buy ATM call',
    build: (s, spot) => build(s, spot, [{ offset: 0, kind: 'call', side: 1 }]),
  },
  {
    key: 'long-put',
    name: 'Long put',
    hint: 'Bearish · buy ATM put',
    build: (s, spot) => build(s, spot, [{ offset: 0, kind: 'put', side: 1 }]),
  },
  {
    key: 'short-call',
    name: 'Short call',
    hint: 'Bearish income · sell OTM call, naked',
    build: (s, spot) => build(s, spot, [{ offset: 2, kind: 'call', side: -1 }]),
  },
  {
    key: 'short-put',
    name: 'Short put',
    hint: 'Bullish income · sell OTM put',
    build: (s, spot) => build(s, spot, [{ offset: -2, kind: 'put', side: -1 }]),
  },
  {
    key: 'bull-call-spread',
    name: 'Bull call spread',
    hint: 'Debit · buy ATM call, sell higher call',
    build: (s, spot) =>
      build(s, spot, [
        { offset: 0, kind: 'call', side: 1 },
        { offset: 2, kind: 'call', side: -1 },
      ]),
  },
  {
    key: 'bear-put-spread',
    name: 'Bear put spread',
    hint: 'Debit · buy ATM put, sell lower put',
    build: (s, spot) =>
      build(s, spot, [
        { offset: 0, kind: 'put', side: 1 },
        { offset: -2, kind: 'put', side: -1 },
      ]),
  },
  {
    key: 'bull-put-credit',
    name: 'Bull put credit',
    hint: 'Credit · sell OTM put, buy lower put',
    build: (s, spot) =>
      build(s, spot, [
        { offset: -2, kind: 'put', side: -1 },
        { offset: -4, kind: 'put', side: 1 },
      ]),
  },
  {
    key: 'bear-call-credit',
    name: 'Bear call credit',
    hint: 'Credit · sell OTM call, buy higher call',
    build: (s, spot) =>
      build(s, spot, [
        { offset: 2, kind: 'call', side: -1 },
        { offset: 4, kind: 'call', side: 1 },
      ]),
  },
  {
    key: 'straddle',
    name: 'Long straddle',
    hint: 'Big move either way · buy ATM call + put',
    build: (s, spot) =>
      build(s, spot, [
        { offset: 0, kind: 'call', side: 1 },
        { offset: 0, kind: 'put', side: 1 },
      ]),
  },
  {
    key: 'strangle',
    name: 'Long strangle',
    hint: 'Cheaper straddle · buy OTM call + OTM put',
    build: (s, spot) =>
      build(s, spot, [
        { offset: 2, kind: 'call', side: 1 },
        { offset: -2, kind: 'put', side: 1 },
      ]),
  },
  {
    key: 'short-straddle',
    name: 'Short straddle',
    hint: 'Pin the strike · sell ATM call + put',
    build: (s, spot) =>
      build(s, spot, [
        { offset: 0, kind: 'call', side: -1 },
        { offset: 0, kind: 'put', side: -1 },
      ]),
  },
  {
    key: 'short-strangle',
    name: 'Short strangle',
    hint: 'Range income · sell OTM call + put',
    build: (s, spot) =>
      build(s, spot, [
        { offset: 2, kind: 'call', side: -1 },
        { offset: -2, kind: 'put', side: -1 },
      ]),
  },
  {
    key: 'call-butterfly',
    name: 'Call butterfly',
    hint: 'Pin the strike · 1-2-1 call wings',
    build: (s, spot) =>
      build(s, spot, [
        { offset: -2, kind: 'call', side: 1 },
        { offset: 0, kind: 'call', side: -1, qty: 2 },
        { offset: 2, kind: 'call', side: 1 },
      ]),
  },
  {
    key: 'iron-butterfly',
    name: 'Iron butterfly',
    hint: 'Pin the strike · sell ATM straddle, buy wings',
    build: (s, spot) =>
      build(s, spot, [
        { offset: -3, kind: 'put', side: 1 },
        { offset: 0, kind: 'put', side: -1 },
        { offset: 0, kind: 'call', side: -1 },
        { offset: 3, kind: 'call', side: 1 },
      ]),
  },
  {
    key: 'call-condor',
    name: 'Call condor',
    hint: 'Range-bound · buy outer calls, sell inner',
    build: (s, spot) =>
      build(s, spot, [
        { offset: -4, kind: 'call', side: 1 },
        { offset: -2, kind: 'call', side: -1 },
        { offset: 2, kind: 'call', side: -1 },
        { offset: 4, kind: 'call', side: 1 },
      ]),
  },
  {
    key: 'iron-condor',
    name: 'Iron condor',
    hint: 'Range-bound · sell put & call spreads',
    build: (s, spot) =>
      build(s, spot, [
        { offset: -4, kind: 'put', side: 1 },
        { offset: -2, kind: 'put', side: -1 },
        { offset: 2, kind: 'call', side: -1 },
        { offset: 4, kind: 'call', side: 1 },
      ]),
  },
]

/** Human name for the current combination, best effort. */
export function describePosition(legs: Leg[]): string {
  if (legs.length === 0) return 'No position'
  if (legs.length === 1) {
    const l = legs[0]
    return `${l.side === 1 ? 'Long' : 'Short'} ${l.kind}`
  }
  const calls = legs.filter((l) => l.kind === 'call')
  const puts = legs.filter((l) => l.kind === 'put')
  const longs = legs.filter((l) => l.side === 1)
  const shorts = legs.filter((l) => l.side === -1)
  const expiries = new Set(legs.map((l) => l.expiry))
  if (expiries.size > 1) return 'Calendar / diagonal combo'
  if (legs.length === 2) {
    if (calls.length === 1 && puts.length === 1) {
      if (longs.length === 2)
        return calls[0].strike === puts[0].strike ? 'Long straddle' : 'Long strangle'
      if (shorts.length === 2)
        return calls[0].strike === puts[0].strike ? 'Short straddle' : 'Short strangle'
    }
    if (calls.length === 2 || puts.length === 2) {
      if (longs.length === 1 && shorts.length === 1) return 'Vertical spread'
    }
  }
  if (legs.length === 4 && calls.length === 2 && puts.length === 2) {
    if (shorts.length === 2 && longs.length === 2) {
      const shortCall = calls.find((c) => c.side === -1)
      const shortPut = puts.find((p) => p.side === -1)
      if (shortCall && shortPut)
        return shortCall.strike === shortPut.strike ? 'Iron butterfly' : 'Iron condor'
    }
  }
  // Same-type condor: four distinct strikes, wings long and body short (or the
  // reverse). A long/short alternating pattern is a double vertical, not a condor.
  if (legs.length === 4 && (calls.length === 4 || puts.length === 4)) {
    const isCall = calls.length === 4
    const byStrike = [...legs].sort((a, b) => a.strike - b.strike)
    const distinct = new Set(byStrike.map((l) => l.strike)).size === 4
    if (distinct && longs.length === 2 && shorts.length === 2) {
      const sides = byStrike.map((l) => l.side).join(',')
      if (sides === '1,-1,-1,1') return isCall ? 'Call condor' : 'Put condor'
      if (sides === '-1,1,1,-1') return isCall ? 'Short call condor' : 'Short put condor'
    }
  }
  if (legs.length === 3 && (calls.length === 3 || puts.length === 3)) return 'Butterfly'
  return `Custom · ${legs.length} legs`
}
