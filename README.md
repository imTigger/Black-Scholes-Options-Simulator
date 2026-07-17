# Options Lab — US stock options simulator

A Black-Scholes what-if simulator for US-listed stock and ETF options, in the spirit of
moomoo/Futu's **Price Forecast** card but for whole strategies, not just single contracts.

Pick a real option chain, build a position — single leg or multi-leg (spreads, straddles,
strangles, iron condors, butterflies, calendars/diagonals) — then drag three sliders to see
what the position would be worth. Each leg's strike is a dropdown constrained so a template
position keeps its shape: strikes that would break the strategy (wings crossing the body,
a spread inverting) are disabled, and legs sharing a strike (straddle or iron-butterfly
bodies) move together.

- **When** — any date from today to the last expiry, at day or minute resolution
  (toggle next to the label — minutes matter for 0DTE)
- **Price** — the forecast underlying price
- **IV** — implied volatility (absolute for a single leg, relative shift for multi-leg)

The payoff chart shows P/L at expiry and on the forecast date, with breakevens, spot and
forecast markers, and a hover crosshair. A stat row tracks net debit/credit, max profit/loss,
breakevens, and position greeks (delta, gamma, theta, vega).

## Run it

```sh
npm install
npm run dev
```

## Static deployment (no server-side proxy)

`npm run build` produces a fully static `dist/` (relative asset paths — works from any
directory). Copy it to any web server:

```sh
npm run build
rsync -av dist/ user@server:/var/www/options-lab/
```

Without the dev proxy, browsers can't reach Cboe/Yahoo (CORS), so live data on a static
deployment comes from **Tradier**, whose API is CORS-open: create a free account at
tradier.com, grab an API token, and paste it into the "Tradier" field in the top bar. It's
stored only in your browser's localStorage and sent only to Tradier. Without a token, the
app falls back to the built-in sample data — every simulation feature still works.

## Data sources

The dev (and `vite preview`) server proxies market data:

- **Cboe delayed quotes** (primary) — `cdn.cboe.com/api/global/delayed_quotes/options/<SYM>.json`,
  the full chain for every expiry in one request, ~15-minute delayed, no auth.
- **Yahoo Finance** (fallback) — quote + chain per expiry; the proxy handles Yahoo's
  cookie/crumb dance. Also powers ticker-search suggestions. Yahoo aggressively rate-limits,
  so it's the backup.
- **Tradier** (static hosting) — CORS-open API used directly from the browser when a
  token is set; per-expiry chains with ORATS mid IV.
- **Sample data** (offline) — a synthetic chain under the ticker `DEMO` so the simulator
  works with no network at all.

Symbols: any optionable US stock/ETF (`AAPL`, `TSLA`, `SPY`…) and Cboe indexes (`SPX`, `VIX`).

## How pricing works

Everything is Black-Scholes-Merton (European exercise, flat rate, no dividend yield input yet):

- Each leg keeps its own entry price (chain mid at add time) and its own IV from the chain;
  deep-ITM contracts that report `iv = 0` get an IV re-solved from the mid price by bisection.
- Forecast value re-prices every leg at the chosen date/price with each leg's IV scaled by the
  IV slider. Legs past their expiry are valued at intrinsic.
- The "at expiry" curve is evaluated at the *front* (earliest) expiry, so far-dated legs in
  calendars/diagonals correctly keep time value.
- Greeks are aggregated in dollar terms (theta per calendar day, vega per vol point).

American-style early exercise and discrete dividends are not modeled — theoretical values can
drift from market prices for deep-ITM puts and around ex-div dates. For reference only; not
investment advice.

## Stack

Vite + React + TypeScript, no runtime dependencies beyond React. The chart is hand-rolled SVG.
State persists to `localStorage` (symbol, legs, forecast, rate).
