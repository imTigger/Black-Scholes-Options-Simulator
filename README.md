# Options Lab — US stock options simulator

A Black-Scholes what-if simulator for US-listed stock and ETF options, in the spirit of
moomoo/Futu's **Price Forecast** card but for whole strategies, not just single contracts.

Pick a real option chain, build a position — single leg or multi-leg (spreads, straddles,
strangles, iron condors, butterflies, calendars/diagonals) — then drag three sliders to see
what the position would be worth:

- **When** — any date from today to the last expiry
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

The dev (and `vite preview`) server proxies market data, so the app must run through it:

- **Cboe delayed quotes** (primary) — `cdn.cboe.com/api/global/delayed_quotes/options/<SYM>.json`,
  the full chain for every expiry in one request, ~15-minute delayed, no auth.
- **Yahoo Finance** (fallback) — quote + chain per expiry; the proxy handles Yahoo's
  cookie/crumb dance. Also powers ticker-search suggestions. Yahoo aggressively rate-limits,
  so it's the backup.
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
