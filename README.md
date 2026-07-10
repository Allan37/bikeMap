# bikeMap

Citibike-aware routing: a map that knows which stations actually have bikes
and open docks right now, and later, mixed bike+subway commute routing. See
[plan.md](./plan.md) for the full design discussion.

## Status: v0

Walking skeleton — installable PWA shell with a live Mapbox map showing
Citibike station availability (green = has bikes, amber = docks only, red =
full/empty), polling Citibike's public GBFS feed. No search, routing, or POI
data yet — that's next.

## Setup

```bash
npm install
cp .env.example .env   # then fill in VITE_MAPBOX_TOKEN
npm run dev
```

You need a [Mapbox access token](https://console.mapbox.com/account/access-tokens/)
(free tier is plenty). It's a public/client-side token — safe to expose, but
restrict it to your dev/prod URLs in the Mapbox dashboard once you have them.

## Scripts

- `npm run dev` — local dev server
- `npm run build` — typecheck + production build (also generates the PWA
  service worker/manifest)
- `npm run preview` — serve the production build locally

