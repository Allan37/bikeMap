# bikeMap

Citibike-aware routing: a map that knows which stations actually have bikes
and open docks right now, and later, mixed bike+subway commute routing. See
[plan.md](./plan.md) for the full design discussion.

## Status: v0

Installable PWA with a live Mapbox map of Citibike station availability
(green = has bikes, amber = docks only, red = full/empty) polling Citibike's
public GBFS feed, destination search, tap-a-POI selection, walk→bike→walk
routing that accounts for live availability, a Yelp info card, and a live
user-location dot. Bike-leg navigation hands off to Apple Maps.

## Setup

```bash
npm install
cp .env.example .env   # then fill in VITE_MAPBOX_TOKEN and YELP_API_KEY
npm run dev
```

You need two keys, both in `.env`:

- `VITE_MAPBOX_TOKEN` — a [Mapbox access token](https://console.mapbox.com/account/access-tokens/)
  (free tier is plenty). It's a public/client-side token — safe to expose, but
  restrict it to your dev/prod URLs in the Mapbox dashboard once you have them.
- `YELP_API_KEY` — a [Yelp Fusion](https://docs.developer.yelp.com/) key. Server-side
  only (no `VITE_` prefix); it's read exclusively by the `/api/yelp-search` function
  and the local dev proxy, never shipped to the browser.

Testing on a phone during dev? Geolocation and PWA install both require HTTPS,
which `http://<your-LAN-IP>:5173` is not. Use a tunnel, e.g.
`npx cloudflared tunnel --url http://localhost:5173`, and open the `https://…`
URL on the phone. (Tunnel hosts are pre-allowed in `vite.config.ts`.)

## Deploy (Vercel)

This is a Vite static frontend **plus** serverless functions (`api/`), which is
a Vercel-shaped app — Vercel auto-detects the Vite framework and the `api/`
folder, so **no `vercel.json` is needed**.

1. **Connect the repo** in the [Vercel dashboard](https://vercel.com/new) (or run
   `vercel` from the CLI). Framework preset: Vite. Build command `npm run build`,
   output dir `dist` — both auto-detected.
2. **Set environment variables** in Vercel (Project → Settings → Environment
   Variables), for Production (and Preview if you want branch deploys):
   - `VITE_MAPBOX_TOKEN` — needed at build time (it's baked into the client bundle).
   - `YELP_API_KEY` — read at runtime by the `/api/yelp-search` function.
3. **Restrict the Mapbox token** to your Vercel domain (e.g. `bikemap.vercel.app`
   and any custom domain) in the Mapbox dashboard, or the map won't load in prod.

You get a stable HTTPS URL, which is what makes geolocation and Home-Screen
install work reliably (unlike the ephemeral dev tunnel).

## Install as a full-screen app

In a normal Safari tab you can't hide Safari's URL/tool bars — that's the
browser. To run edge-to-edge with no chrome, install it: open the **prod URL**
in Safari → Share → **Add to Home Screen** → launch from the icon. The app is
configured (`display: standalone`, `status-bar-style: black-translucent`,
`viewport-fit=cover`) to fill the screen with no black bars; the UI already pads
for the safe-area insets.

## Scripts

- `npm run dev` — local dev server
- `npm run build` — typecheck + production build (also generates the PWA
  service worker/manifest)
- `npm run preview` — serve the production build locally

