export function fmtNum(x: number, dp = 2): string {
  if (!Number.isFinite(x)) return '—'
  return x.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp })
}

export function fmtMoney(x: number, dp = 2): string {
  if (!Number.isFinite(x)) return '—'
  const sign = x < 0 ? '-' : ''
  return `${sign}$${fmtNum(Math.abs(x), dp)}`
}

export function fmtSigned(x: number, dp = 2): string {
  if (!Number.isFinite(x)) return '—'
  return `${x >= 0 ? '+' : '-'}${fmtNum(Math.abs(x), dp)}`
}

export function fmtSignedMoney(x: number, dp = 2): string {
  if (!Number.isFinite(x)) return '—'
  return `${x >= 0 ? '+' : '-'}$${fmtNum(Math.abs(x), dp)}`
}

export function fmtPct(x: number, dp = 2): string {
  if (!Number.isFinite(x)) return '—'
  return `${fmtNum(x * 100, dp)}%`
}

export function fmtSignedPct(x: number, dp = 2): string {
  if (!Number.isFinite(x)) return '—'
  return `${x >= 0 ? '+' : '-'}${fmtNum(Math.abs(x) * 100, dp)}%`
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function fmtDate(ms: number): string {
  const d = new Date(ms)
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`
}

export function fmtDateFull(ms: number): string {
  const d = new Date(ms)
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`
}

export function fmtDateShort(ms: number): string {
  const d = new Date(ms)
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`
}

/* Expiry stamps are midnight UTC — format them in UTC so the calendar date
   never drifts in the viewer's timezone. */
export function fmtDateShortUTC(ms: number): string {
  const d = new Date(ms)
  return `${String(d.getUTCMonth() + 1).padStart(2, '0')}/${String(d.getUTCDate()).padStart(2, '0')}`
}

export function fmtDateUTC(ms: number): string {
  const d = new Date(ms)
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`
}

export function dteFrom(now: number, expiry: number): number {
  return Math.max(0, Math.ceil((expiry - now) / (24 * 3600 * 1000)))
}
