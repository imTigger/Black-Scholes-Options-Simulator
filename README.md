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

A source picker next to the search box lists whichever data sources are reachable:

- **Cboe delayed quotes** — full chain for every expiry in one request, ~15-minute delayed,
  no auth. Not CORS-enabled, so it needs the dev/preview proxy (or a reverse-proxy rule on
  your host) and is hidden otherwise.
- **Yahoo Finance** — quote + chain per expiry via the proxy (cookie/crumb dance included).
  Also powers ticker-search suggestions. Aggressively rate-limited; proxy-only, hidden
  otherwise.
- **marketdata.app** — CORS-open, works **without any server or key** from their cached/trial
  feed (per-expiry chains with IV and greeks). An optional API token (input appears when the
  source is selected) lifts their limits. This is the source a static deploy runs on.
- **Sample data** (offline) — a synthetic chain under the ticker `DEMO` so the simulator
  works with no network at all.

## Static deployment (CloudFront, S3, nginx, any file host)

`npm run build`, upload `dist/` — that's it. On boot the app probes for the proxy routes;
when they don't exist it offers marketdata.app + sample data and runs fully client-side.
No server code, no environment flags, one build for both modes.

If your static host is nginx/Caddy and you want the richer Cboe feed, add a reverse-proxy
rule and the Cboe/Yahoo sources light up automatically:

```nginx
location /api/cboe/ {
  proxy_pass https://cdn.cboe.com/api/global/delayed_quotes/options/;
  proxy_set_header User-Agent "Mozilla/5.0";
}
```

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
