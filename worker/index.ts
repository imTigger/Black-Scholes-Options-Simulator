/**
 * Cloudflare Worker: serves the built app (static assets) and provides the
 * same /api/cboe + /api/yahoo proxy routes as the Vite dev server, so the
 * deployed app runs with every data source available. Requests that don't
 * match /api/* fall through to the assets binding.
 */
interface Env {
  ASSETS: Fetcher
}

const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

const JSON_HEADERS = { 'content-type': 'application/json', 'cache-control': 'no-store' }

// Yahoo session survives per-isolate; re-established on 401/403/429
let yahooCookie = ''
let yahooCrumb = ''

async function ensureYahooAuth(force = false): Promise<void> {
  if (!force && yahooCookie && yahooCrumb) return
  yahooCookie = ''
  yahooCrumb = ''
  const r = await fetch('https://fc.yahoo.com/', {
    headers: { 'User-Agent': UA },
    redirect: 'manual',
  }).catch(() => null)
  const setCookie = r?.headers.get('set-cookie')
  if (setCookie) yahooCookie = setCookie.split(';')[0]
  if (yahooCookie) {
    const cr = await fetch('https://query2.finance.yahoo.com/v1/test/getcrumb', {
      headers: { 'User-Agent': UA, Cookie: yahooCookie },
    })
    if (cr.ok) yahooCrumb = (await cr.text()).trim()
  }
}

async function handleYahoo(url: URL): Promise<Response> {
  const path = url.pathname.replace(/^\/api\/yahoo/, '') + url.search
  const doFetch = async () => {
    const sep = path.includes('?') ? '&' : '?'
    const target =
      'https://query2.finance.yahoo.com' +
      path +
      (yahooCrumb ? `${sep}crumb=${encodeURIComponent(yahooCrumb)}` : '')
    return fetch(target, {
      headers: {
        'User-Agent': UA,
        Accept: 'application/json',
        ...(yahooCookie ? { Cookie: yahooCookie } : {}),
      },
    })
  }
  try {
    await ensureYahooAuth()
    let upstream = await doFetch()
    if (upstream.status === 401 || upstream.status === 403 || upstream.status === 429) {
      await ensureYahooAuth(true)
      upstream = await doFetch()
    }
    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        'content-type': upstream.headers.get('content-type') ?? 'application/json',
        'cache-control': 'no-store',
      },
    })
  } catch (err) {
    return new Response(JSON.stringify({ proxyError: String(err) }), {
      status: 502,
      headers: JSON_HEADERS,
    })
  }
}

async function handleCboe(url: URL): Promise<Response> {
  const rest = url.pathname.replace(/^\/api\/cboe\//, '')
  try {
    const upstream = await fetch(
      `https://cdn.cboe.com/api/global/delayed_quotes/options/${rest}`,
      {
        headers: { 'User-Agent': UA, Accept: 'application/json' },
        // Delayed data — let Cloudflare's cache absorb repeat hits for a minute
        cf: { cacheTtl: 60, cacheEverything: true },
      } as RequestInit,
    )
    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        'content-type': upstream.headers.get('content-type') ?? 'application/json',
        'cache-control': 'public, max-age=60',
      },
    })
  } catch (err) {
    return new Response(JSON.stringify({ proxyError: String(err) }), {
      status: 502,
      headers: JSON_HEADERS,
    })
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname.startsWith('/api/cboe/')) return handleCboe(url)
    if (url.pathname.startsWith('/api/yahoo/')) return handleYahoo(url)
    return env.ASSETS.fetch(request)
  },
}
