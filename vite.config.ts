import { execSync } from 'node:child_process'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { searchYelpBusinesses } from './api/_yelpProxy.ts'
import { fetchTransitRoute } from './api/_transitProxy.ts'

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
        const lat = url.searchParams.get('lat')
        const lon = url.searchParams.get('lon')
        const term = url.searchParams.get('term') ?? undefined
        res.setHeader('Content-Type', 'application/json')
        if (!lat || !lon) {
          res.statusCode = 400
          res.end(JSON.stringify({ error: 'lat and lon query params are required' }))
          return
        }
        try {
          const data = await searchYelpBusinesses({ lat: parseFloat(lat), lon: parseFloat(lon), term })
          res.statusCode = 200
          res.end(JSON.stringify(data))
        } catch (err) {
          res.statusCode = 502
          res.end(JSON.stringify({ error: err instanceof Error ? err.message : 'Yelp search failed' }))
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
        const originLat = url.searchParams.get('originLat')
        const originLon = url.searchParams.get('originLon')
        const destLat = url.searchParams.get('destLat')
        const destLon = url.searchParams.get('destLon')
        res.setHeader('Content-Type', 'application/json')
        if (!originLat || !originLon || !destLat || !destLon) {
          res.statusCode = 400
          res.end(JSON.stringify({ error: 'origin/dest lat/lon are required' }))
          return
        }
        try {
          const route = await fetchTransitRoute({
            originLat: parseFloat(originLat),
            originLon: parseFloat(originLon),
            destLat: parseFloat(destLat),
            destLon: parseFloat(destLon),
          })
          res.statusCode = 200
          res.end(JSON.stringify({ route }))
        } catch (err) {
          res.statusCode = 502
          res.end(JSON.stringify({ error: err instanceof Error ? err.message : 'Transit directions failed' }))
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
