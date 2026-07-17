import { useMemo, useState } from 'react'
import { fmtDateShortUTC, fmtMoney, fmtNum, fmtSignedMoney } from '../lib/format'
import {
  findBreakevens,
  legExpiryClose,
  positionCost,
  positionValue,
  priceDomain,
} from '../lib/position'
import type { Forecast, Leg } from '../lib/types'

interface Props {
  legs: Leg[]
  spot: number
  forecast: Forecast
  rate: number
}

const W = 860
const H = 360
const M = { top: 16, right: 16, bottom: 30, left: 62 }
const IW = W - M.left - M.right
const IH = H - M.top - M.bottom
const SAMPLES = 240

export default function PayoffChart({ legs, spot, forecast, rate }: Props) {
  const [hoverS, setHoverS] = useState<number | null>(null)

  const model = useMemo(() => {
    if (!legs.length || !(spot > 0)) return null
    const [lo, hi] = priceDomain(legs, spot)
    const cost = positionCost(legs)
    const frontExpiry = Math.min(...legs.map(legExpiryClose))
    const atDate = Math.min(forecast.date, frontExpiry)

    const plExpiry = (s: number) =>
      positionValue(legs, s, frontExpiry, forecast.ivShift, rate) - cost
    const plDate = (s: number) => positionValue(legs, s, atDate, forecast.ivShift, rate) - cost

    const xs: number[] = []
    const yeExp: number[] = []
    const yeDate: number[] = []
    for (let i = 0; i <= SAMPLES; i++) {
      const s = lo + ((hi - lo) * i) / SAMPLES
      xs.push(s)
      yeExp.push(plExpiry(s))
      yeDate.push(plDate(s))
    }
    let yMin = Math.min(0, ...yeExp, ...yeDate)
    let yMax = Math.max(0, ...yeExp, ...yeDate)
    const pad = Math.max((yMax - yMin) * 0.1, 1)
    yMin -= pad
    yMax += pad

    const sx = (s: number) => M.left + ((s - lo) / (hi - lo)) * IW
    const sy = (y: number) => M.top + ((yMax - y) / (yMax - yMin)) * IH

    const line = (ys: number[]) =>
      xs.map((s, i) => `${i ? 'L' : 'M'}${sx(s).toFixed(2)},${sy(ys[i]).toFixed(2)}`).join('')

    const areaExpiry =
      line(yeExp) + `L${sx(hi).toFixed(2)},${sy(0).toFixed(2)}L${sx(lo).toFixed(2)},${sy(0).toFixed(2)}Z`

    const breakevens = findBreakevens(plExpiry, [lo, hi])

    return {
      lo,
      hi,
      yMin,
      yMax,
      sx,
      sy,
      xs,
      plExpiry,
      plDate,
      pathExpiry: line(yeExp),
      pathDate: line(yeDate),
      areaExpiry,
      breakevens,
      frontExpiry,
      cost,
    }
  }, [legs, spot, forecast.date, forecast.ivShift, rate])

  if (!model) {
    return (
      <div className="legs-empty" style={{ padding: '64px 0' }}>
        The payoff chart appears here once the position has at least one leg.
      </div>
    )
  }

  const { lo, hi, yMin, yMax, sx, sy } = model

  const yTicks = niceTicks(yMin, yMax, 5)
  const xTicks = niceTicks(lo, hi, 7)

  const hover =
    hoverS !== null
      ? {
          s: hoverS,
          x: sx(hoverS),
          de: model.plExpiry(hoverS),
          dd: model.plDate(hoverS),
        }
      : null

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const frac = (e.clientX - rect.left) / rect.width
    const px = frac * W
    if (px < M.left || px > W - M.right) return setHoverS(null)
    setHoverS(lo + ((px - M.left) / IW) * (hi - lo))
  }

  const tipLeft = hover ? (hover.x / W) * 100 : 0
  const tipFlip = hover ? hover.x > W * 0.62 : false

  return (
    <div className="chart-svg-wrap">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label="Profit and loss versus underlying price"
        onPointerMove={onMove}
        onPointerLeave={() => setHoverS(null)}
      >
        <defs>
          <clipPath id="clip-above">
            <rect x={M.left} y={M.top - 2} width={IW} height={Math.max(0, sy(0) - M.top + 2)} />
          </clipPath>
          <clipPath id="clip-below">
            <rect
              x={M.left}
              y={sy(0)}
              width={IW}
              height={Math.max(0, H - M.bottom - sy(0) + 2)}
            />
          </clipPath>
        </defs>

        {/* gridlines + y labels */}
        {yTicks.map((t) => (
          <g key={`y${t}`}>
            <line
              x1={M.left}
              x2={W - M.right}
              y1={sy(t)}
              y2={sy(t)}
              stroke="var(--line-soft)"
              strokeWidth="1"
            />
            <text
              x={M.left - 8}
              y={sy(t) + 3.5}
              textAnchor="end"
              fontSize="10.5"
              fill="var(--muted)"
              fontFamily="var(--mono)"
            >
              {Math.abs(t) >= 1000 ? `${fmtNum(t / 1000, 1)}k` : fmtNum(t, 0)}
            </text>
          </g>
        ))}
        {xTicks.map((t) => (
          <text
            key={`x${t}`}
            x={sx(t)}
            y={H - 10}
            textAnchor="middle"
            fontSize="10.5"
            fill="var(--muted)"
            fontFamily="var(--mono)"
          >
            {fmtNum(t, t < 20 ? 1 : 0)}
          </text>
        ))}

        {/* profit / loss fills under the expiry curve */}
        <path d={model.areaExpiry} fill="var(--up-dim)" clipPath="url(#clip-above)" />
        <path d={model.areaExpiry} fill="var(--down-dim)" clipPath="url(#clip-below)" />

        {/* zero baseline */}
        <line
          x1={M.left}
          x2={W - M.right}
          y1={sy(0)}
          y2={sy(0)}
          stroke="var(--line)"
          strokeWidth="1.5"
        />

        {/* strike ticks */}
        {[...new Set(legs.map((l) => l.strike))].map((k) =>
          k >= lo && k <= hi ? (
            <path
              key={`k${k}`}
              d={`M${sx(k) - 4},${H - M.bottom + 8}L${sx(k) + 4},${H - M.bottom + 8}L${sx(k)},${H - M.bottom + 2}Z`}
              fill="var(--faint)"
            />
          ) : null,
        )}

        {/* spot marker */}
        {spot >= lo && spot <= hi && (
          <g>
            <line
              x1={sx(spot)}
              x2={sx(spot)}
              y1={M.top}
              y2={H - M.bottom}
              stroke="var(--faint)"
              strokeWidth="1"
              strokeDasharray="3 4"
            />
            <text
              x={sx(spot)}
              y={M.top - 4}
              textAnchor="middle"
              fontSize="10"
              fill="var(--muted)"
              fontFamily="var(--mono)"
            >
              spot {fmtNum(spot, 2)}
            </text>
          </g>
        )}

        {/* forecast price marker */}
        {forecast.price >= lo && forecast.price <= hi && (
          <line
            x1={sx(forecast.price)}
            x2={sx(forecast.price)}
            y1={M.top}
            y2={H - M.bottom}
            stroke="var(--amber)"
            strokeWidth="1"
            opacity="0.55"
          />
        )}

        {/* curves */}
        <path d={model.pathExpiry} fill="none" stroke="var(--blue-chart)" strokeWidth="2" />
        <path
          d={model.pathDate}
          fill="none"
          stroke="var(--amber-chart)"
          strokeWidth="2.25"
          strokeDasharray="6 4"
        />

        {/* forecast point dot */}
        {forecast.price >= lo && forecast.price <= hi && (
          <circle
            cx={sx(forecast.price)}
            cy={sy(model.plDate(forecast.price))}
            r="4.5"
            fill="var(--amber)"
            stroke="var(--bg)"
            strokeWidth="2"
          />
        )}

        {/* breakevens */}
        {model.breakevens.map((b) => (
          <g key={`b${b.toFixed(2)}`}>
            <circle cx={sx(b)} cy={sy(0)} r="3.5" fill="var(--bg)" stroke="var(--ink)" strokeWidth="1.5" />
            <text
              x={sx(b)}
              y={sy(0) - 8}
              textAnchor="middle"
              fontSize="10"
              fill="var(--ink)"
              fontFamily="var(--mono)"
            >
              BE {fmtNum(b, 2)}
            </text>
          </g>
        ))}

        {/* crosshair */}
        {hover && (
          <g pointerEvents="none">
            <line
              x1={hover.x}
              x2={hover.x}
              y1={M.top}
              y2={H - M.bottom}
              stroke="var(--muted)"
              strokeWidth="1"
              opacity="0.5"
            />
            <circle cx={hover.x} cy={sy(hover.de)} r="3.5" fill="var(--blue-chart)" stroke="var(--bg)" strokeWidth="1.5" />
            <circle cx={hover.x} cy={sy(hover.dd)} r="3.5" fill="var(--amber-chart)" stroke="var(--bg)" strokeWidth="1.5" />
          </g>
        )}
      </svg>

      {hover && (
        <div
          className="chart-tip"
          style={{
            left: `${tipLeft}%`,
            top: 26,
            transform: tipFlip ? 'translateX(calc(-100% - 14px))' : 'translateX(14px)',
          }}
        >
          <div className="tp-row">
            <span className="l">Price</span>
            <span className="num">{fmtMoney(hover.s)}</span>
          </div>
          <div className="tp-row">
            <span className="l">On {fmtDateShortUTC(Math.min(forecast.date, model.frontExpiry))}</span>
            <span className={`num ${hover.dd >= 0 ? 'up' : 'down'}`}>{fmtSignedMoney(hover.dd)}</span>
          </div>
          <div className="tp-row">
            <span className="l">At expiry</span>
            <span className={`num ${hover.de >= 0 ? 'up' : 'down'}`}>{fmtSignedMoney(hover.de)}</span>
          </div>
        </div>
      )}
    </div>
  )
}

function niceTicks(lo: number, hi: number, n: number): number[] {
  const span = hi - lo
  if (!(span > 0)) return [lo]
  const step0 = span / n
  const mag = 10 ** Math.floor(Math.log10(step0))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= n) ?? 10 * mag
  const out: number[] = []
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(+v.toFixed(6))
  return out
}
