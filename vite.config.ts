import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

/**
 * Dev-server proxy for Yahoo Finance. Yahoo's quote/options endpoints require a
 * session cookie + crumb; the browser can't do that cross-origin, so the dance
 * happens here and the client just calls /api/yahoo/<yahoo-path>.
 */
function yahooProxy(): Plugin {
  let cookie = ''
  let crumb = ''

  async function ensureAuth(force = false) {
    if (!force && cookie && crumb) return
    cookie = ''
    crumb = ''
    const r = await fetch('https://fc.yahoo.com/', {
      headers: { 'User-Agent': UA },
      redirect: 'manual',
    }).catch(() => null)
    const setCookie = r?.headers.get('set-cookie')
    if (setCookie) cookie = setCookie.split(';')[0]
    if (cookie) {
      const cr = await fetch('https://query2.finance.yahoo.com/v1/test/getcrumb', {
        headers: { 'User-Agent': UA, Cookie: cookie },
      })
      if (cr.ok) crumb = (await cr.text()).trim()
    }
  }

  const attach = (server: { middlewares: import('vite').Connect.Server }) => {
    server.middlewares.use('/api/yahoo', async (req, res) => {
        const path = req.url || '/'
        const doFetch = async () => {
          const sep = path.includes('?') ? '&' : '?'
          const url =
            'https://query2.finance.yahoo.com' +
            path +
            (crumb ? `${sep}crumb=${encodeURIComponent(crumb)}` : '')
          return fetch(url, {
            headers: {
              'User-Agent': UA,
              Accept: 'application/json',
              ...(cookie ? { Cookie: cookie } : {}),
            },
          })
        }
        try {
          await ensureAuth()
          let upstream = await doFetch()
          if (upstream.status === 401 || upstream.status === 403 || upstream.status === 429) {
            await ensureAuth(true)
            upstream = await doFetch()
          }
          const body = await upstream.text()
          res.statusCode = upstream.status
          res.setHeader('content-type', upstream.headers.get('content-type') ?? 'application/json')
          res.setHeader('cache-control', 'no-store')
          res.end(body)
        } catch (err) {
          res.statusCode = 502
          res.setHeader('content-type', 'application/json')
          res.end(JSON.stringify({ proxyError: String(err) }))
        }
      })
  }

  return {
    name: 'yahoo-proxy',
    configureServer: attach,
    configurePreviewServer: attach,
  }
}

const cboeProxy = {
  '/api/cboe': {
    target: 'https://cdn.cboe.com',
    changeOrigin: true,
    rewrite: (p: string) => p.replace(/^\/api\/cboe/, '/api/global/delayed_quotes/options'),
    headers: { 'User-Agent': UA, Accept: 'application/json' },
  },
}

export default defineConfig({
  plugins: [react(), yahooProxy()],
  // Cboe delayed quotes: full option chain, no auth. /api/cboe/AAPL.json
  server: { proxy: cboeProxy },
  preview: { proxy: cboeProxy },
})
