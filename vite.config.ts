import { execSync } from 'node:child_process'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { searchYelpBusinesses } from './api/_yelpProxy.ts'
import { fetchTransitRoute } from './api/_transitProxy.ts'

const MAX_SEARCH_TERM_LENGTH = 160

function parseCoordinate(value: string | null, min: number, max: number): number | null {
  if (!value?.trim()) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : null
}

function sendJsonError(res: { statusCode: number; end: (body: string) => void }, status: number, code: string, message: string) {
  res.statusCode = status
  res.end(JSON.stringify({ error: { code, message } }))
}

function isTimeout(error: unknown): boolean {
  return error instanceof Error && error.message === 'Upstream request timed out'
}

// A short build identifier shown in-app (top-left) so you can verify you're on the latest deploy.
// Vercel exposes the commit SHA as an env var; locally we read git; time makes dev rebuilds distinct.
function buildId(): string {
  const sha =
    process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ??
    (() => {
      try {
        return execSync('git rev-parse --short HEAD').toString().trim()
      } catch {
        return 'dev'
      }
    })()
  const time = new Date().toLocaleString('en-US', {
    timeZone: 'America/New_York',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }) // MM/DD, HH:MM (Eastern)
  return `${sha} · ${time} ET`
}

// Mounts the same Yelp proxy logic as api/yelp-search.ts (the real Vercel function) so
// `npm run dev` works end-to-end without needing `vercel dev` or a linked Vercel project.
function yelpProxyDevMiddleware(): Plugin {
  return {
    name: 'yelp-proxy-dev-middleware',
    configureServer(server) {
      server.middlewares.use('/api/yelp-search', async (req, res) => {
        const url = new URL(req.url ?? '', 'http://localhost')
        const lat = parseCoordinate(url.searchParams.get('lat'), -90, 90)
        const lon = parseCoordinate(url.searchParams.get('lon'), -180, 180)
        const term = url.searchParams.get('term') ?? undefined
        res.setHeader('Content-Type', 'application/json')
        if (lat === null || lon === null) {
          sendJsonError(res, 400, 'INVALID_COORDINATES', 'lat and lon must be finite coordinates within their valid ranges')
          return
        }
        if (term !== undefined && term.length > MAX_SEARCH_TERM_LENGTH) {
          sendJsonError(res, 400, 'INVALID_TERM', `term must be a string no longer than ${MAX_SEARCH_TERM_LENGTH} characters`)
          return
        }
        try {
          const data = await searchYelpBusinesses({ lat, lon, term })
          res.statusCode = 200
          res.end(JSON.stringify(data))
        } catch (err) {
          const timedOut = isTimeout(err)
          sendJsonError(res, timedOut ? 504 : 502, timedOut ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_ERROR', timedOut ? 'Yelp request timed out' : 'Yelp search failed')
        }
      })
    },
  }
}

// Mirrors api/transit-directions.ts for `npm run dev`.
function transitProxyDevMiddleware(): Plugin {
  return {
    name: 'transit-proxy-dev-middleware',
    configureServer(server) {
      server.middlewares.use('/api/transit-directions', async (req, res) => {
        const url = new URL(req.url ?? '', 'http://localhost')
        const originLat = parseCoordinate(url.searchParams.get('originLat'), -90, 90)
        const originLon = parseCoordinate(url.searchParams.get('originLon'), -180, 180)
        const destLat = parseCoordinate(url.searchParams.get('destLat'), -90, 90)
        const destLon = parseCoordinate(url.searchParams.get('destLon'), -180, 180)
        res.setHeader('Content-Type', 'application/json')
        if (originLat === null || originLon === null || destLat === null || destLon === null) {
          sendJsonError(res, 400, 'INVALID_COORDINATES', 'originLat, originLon, destLat, and destLon must be finite coordinates within their valid ranges')
          return
        }
        try {
          const route = await fetchTransitRoute({
            originLat,
            originLon,
            destLat,
            destLon,
          })
          res.statusCode = 200
          res.end(JSON.stringify({ route }))
        } catch (err) {
          const timedOut = isTimeout(err)
          sendJsonError(res, timedOut ? 504 : 502, timedOut ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_ERROR', timedOut ? 'Transit directions request timed out' : 'Transit directions failed')
        }
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Vite only puts VITE_-prefixed vars on import.meta.env for client code; loadEnv with an
  // empty prefix filter reads *all* .env vars so the dev middleware above can see YELP_API_KEY.
  const env = loadEnv(mode, process.cwd(), '')
  process.env.YELP_API_KEY = env.YELP_API_KEY
  process.env.GOOGLE_MAPS_API_KEY = env.GOOGLE_MAPS_API_KEY

  return {
    define: {
      __BUILD_ID__: JSON.stringify(buildId()),
    },
    server: {
      // Vite 8 rejects requests whose Host header isn't recognized. Allow the
      // cloudflared quick-tunnel domain so phone testing over the https URL works.
      allowedHosts: ['.trycloudflare.com'],
    },
    plugins: [
      react(),
      yelpProxyDevMiddleware(),
      transitProxyDevMiddleware(),
      VitePWA({
        registerType: 'autoUpdate',
        manifest: {
          name: 'bikeMap',
          short_name: 'bikeMap',
          description: 'Citibike-aware routing: live station availability baked into every trip.',
          theme_color: '#2e7d32',
          background_color: '#ffffff',
          display: 'standalone',
          icons: [
            { src: '/icons/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
            { src: '/icons/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
          ],
        },
      }),
    ],
  }
})
