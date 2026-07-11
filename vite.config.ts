import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { searchYelpBusinesses } from './api/_yelpProxy.ts'

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

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Vite only puts VITE_-prefixed vars on import.meta.env for client code; loadEnv with an
  // empty prefix filter reads *all* .env vars so the dev middleware above can see YELP_API_KEY.
  const env = loadEnv(mode, process.cwd(), '')
  process.env.YELP_API_KEY = env.YELP_API_KEY

  return {
    plugins: [
      react(),
      yelpProxyDevMiddleware(),
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
