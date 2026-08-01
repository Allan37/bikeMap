# bikeMap — plan (living doc)

## Vision

"Apple Maps, but it understands Citibike." You bike everywhere via Citibike,
so routing should default to bike-share-aware directions: walk to a station
that actually has bikes, ride, dock at a station near the destination that
actually has space, walk the rest. Later: fold in NYC subway/train data for
mixed bike+transit commutes.

Emphasis on staying under FREE API limits on mapbox, yelp, etc. 

## Decisions so far

- **Platform: PWA**, not native iOS. No $99/yr Apple Developer Program, no
  App Store review, installs to the home screen, deploys by pushing to a
  free static host (Vercel/Netlify/Cloudflare Pages).
- **Routing: reuse existing providers for the walk/bike legs** rather than
  building our own routing engine. Provider: **Mapbox** — free tier (100k
  map loads/mo, 100k directions requests/mo), no paid account required,
  native walking/cycling directions profiles. (Ruled out Apple MapKit JS —
  needs the paid Developer Program just for a key. Ruled out Google
  Directions — metered billing, needs a card on file. Ruled out self-hosted
  OSRM — real ops overhead for no benefit at this usage level.)
- **Station data: Citibike's public GBFS feed.** Free, no API key.
  `station_information.json` (static: lat/lon, capacity, name) +
  `station_status.json` (live: bikes available, docks available), refreshed
  roughly every 30-60s by Citibike/Lyft.
- **Architecture: almost entirely client-side, plus two tiny serverless proxies.**
  Mapbox and GBFS are called directly from the browser (Mapbox tokens are
  designed to be public/URL-restricted; GBFS needs no key at all). Yelp
  Fusion and Google transit directions use server-side API keys, so Vercel
  functions proxy them. This is a serverless convenience layer, not a
  persistent backend: no database, accounts, or always-on machine.
- **Scope: single user (you), not building for others** unless that changes.
  No auth, no accounts for v1. Simplifies everything.
- **Frontend stack: Vite + React + TypeScript**, using `vite-plugin-pwa` for
  the manifest/service worker. TypeScript because the data shapes flowing
  through this (GBFS stations, Mapbox routes, Yelp businesses, our own
  scored route options) are exactly the kind of thing worth catching at
  compile time rather than a runtime `undefined.docks_available`.
- **POI ratings/reviews: Yelp Fusion, included from v1.**
- **Subway routing: Google Directions transit mode, server-side only.** It
  supplies pure-subway directions and is the transit oracle for the current
  experimental bike + subway planner; final navigation can hand off to Apple Maps.
- **Hosting: Vercel.** Static frontend + serverless functions (`/api` folder
  convention) with zero extra config, auto-deploys on push to GitHub, free
  tier covers this comfortably.

## Core problem to solve: the station-picking algorithm — BUILT

Implemented in `src/routing/`. Real approach (superseded the original sketch
below it):

1. Given start point A and destination B, find the nearest
   `CANDIDATE_STATION_COUNT` (3) stations to each with live availability
   (`bikesAvailable > 0` near A, `docksAvailable > 0` near B) — cheap,
   straight-line distance, no API calls (`candidateSearch.findNearbyStations`).
2. Fetch real Mapbox Directions for every leg, including the bike leg for
   every candidate pair — not a straight-line estimate. At N=3 that's
   3+3+9=15 Directions calls per search, trivial against the 100k/month free
   tier, and it actually models the street network (one-way streets,
   bridges, avenue loops) instead of guessing — this matters in a grid city
   where straight-line distance undercounts "loop around the block" trips.
   A straight-line estimate (`scoring.estimateBikeLeg`) only kicks in as a
   per-pair fallback if that specific Directions call fails.
3. Rank by total walk+bike+walk time, surface top `MAX_ROUTE_OPTIONS` (3).
4. No viable station pair (nothing nearby has bikes, or nothing near the
   destination has a dock): `getBestRoutes` returns `[]`, `RoutePanel` shows
   an explicit "no viable route" message rather than failing silently.

Verified end-to-end against live data and the real Directions API (not
mocked) — real trip: 14/15/16 min ranked options from Penn Station area to
Washington Square Park.

**Resolved open questions:**
- Candidate count: 3 per side, tunable via `CANDIDATE_STATION_COUNT`.
- Availability buffer: none added — `> 0` as-is. Real Directions calls per
  pair already make wrong/stale rankings cheap to get right next poll cycle;
  didn't seem worth the complexity yet.
- Live re-routing and manual station override: still not built. Station data
  refreshes on screen, but a route is recomputed only when an endpoint or mode changes.

## Phases

**v1 — Citibike-aware point-to-point routing**
- [x] Map view with live station markers (color/label by bikes & docks available)
- [x] Enter/tap a destination, get back the best station-pair route per above
- [x] Render the 3-leg route (walk / bike / walk) with ETA
- [x] Live user location — used Mapbox's built-in `GeolocateControl` (permission
  UI, pulsing accuracy-circle dot, continuous tracking) instead of a
  hand-rolled `hooks/useGeolocation.ts`; more robust, less code to maintain
- [x] Installable PWA, works on your phone's home screen
- [x] Custom origin: a “From” picker defaults to current location and accepts
  a searched place.
- [x] POI ratings/reviews: the place card makes a best-effort Yelp business match.

**v2 — Mixed bike + subway commutes — early version built**
- [x] Pure subway routing in-app through Google Directions transit mode.
- [x] A bundled static subway-station dataset and a bounded heuristic planner
  for bike-to-subway, subway-to-bike, and bike-to-subway-to-bike candidates.
  It verifies a small number of promising candidates with Google, then uses
  live Citibike availability and Mapbox for final bike portions.
- [x] Draw transit polylines and bike legs together; hand off navigation to
  Apple Maps where appropriate.
- [ ] Add MTA GTFS static data and GTFS-realtime arrivals/service alerts only
  if the current heuristic proves insufficient. Do not add a persistent
  backend pre-emptively: a Vercel function with short-lived caching is the
  first escalation if browser-side fetching, API cost, or latency becomes a
  real problem.
- [ ] Generalize to a configurable multimodal itinerary search only if real
  trips demonstrate missed good options or poor ETA accuracy.

**Not planned (unless priorities change)**
- Multi-user accounts/auth
- Native app / background location / widgets
- Our own map rendering or routing engine

## Architecture

```
bikeMap/
  plan.md
  index.html
  vite.config.ts          # includes vite-plugin-pwa (manifest, service worker)
  package.json
  tsconfig.json
  .env.example             # VITE_MAPBOX_TOKEN (public, URL-restricted)
                            # YELP_API_KEY (secret, server-only — used by /api only)
  .gitignore
  public/
    icons/                 # PWA icons (192, 512, maskable)
  api/                      # Vercel serverless functions — the ONLY server code
    yelp-search.ts           # GET /api/yelp-search?lat=&lon=&term= -> proxies Yelp
    transit-directions.ts    # GET /api/transit-directions?... -> proxies Google transit
  src/
    main.tsx                  # entry point, mounts React root
    App.tsx                    # top-level state + layout (search -> routes -> map)
    config.ts                   # constants: candidate count N, availability
                                 # buffer, GBFS poll interval
    types.ts                     # shared types: Coordinates, Station, RouteLeg,
                                  # RouteOption, POI, YelpBusiness
    map/
      MapView.tsx                 # owns the mapbox-gl instance; renders station
                                   # layer, route lines, POI markers; click handling
      useMapboxMap.ts              # hook: create/teardown the mapbox-gl.Map
      stationLayer.ts               # stationsToGeoJSON(stations) -> marker layer
                                     # colored by live bike/dock availability
      routeLayer.ts                  # routeOptionToGeoJSON(option) -> line layer
    citibike/
      gbfs.ts                        # fetchStationInformation(), fetchStationStatus()
      useStations.ts                  # hook: polls GBFS, returns merged live Station[]
    routing/
      mapboxDirections.ts              # getWalkingRoute(a,b), getCyclingRoute(a,b)
      candidateSearch.ts                # candidate station pairs + getBestRoutes()
      scoring.ts                         # distance and fallback bike estimates
      transitDirections.ts               # client for our transit proxy
      multimodal.ts                      # bounded bike + subway candidate planner
      subwayStations.ts                  # bundled static subway station lookup
    search/
      mapboxSearch.ts                     # Mapbox Search Box suggest/retrieve
      SearchSheet.tsx                     # destination search + saved places
      PlaceSearch.tsx                     # reusable origin picker
    poi/
      yelpClient.ts                         # Yelp search + local best-match selection;
                                             # calls our /api proxy, never Yelp direct
    routePanel/
      TripPanel.tsx                            # place card + bike/subway/combo results
```

**Data flow for bike routing** (type a destination → get a route):
`SearchSheet` → `mapboxSearch.searchSuggestions()` for autocomplete → user picks one
→ `mapboxSearch.retrievePlace()` for coordinates → `App` calls
`candidateSearch.getBestRoutes(userLocation, destination, liveStations)` →
which selects nearby eligible stations, evaluates every candidate pair with
Mapbox walk/bike directions, and ranks the resulting `RouteOption[]` →
the top option flows back up to `App`, rendered by both `TripPanel`
and `MapView`/`routeLayer` (drawn on the map).

`useStations()` runs independently on a poll interval and feeds `MapView`
the live marker layer regardless of whether a route is active.

**Current limitations worth tracking:** station eligibility currently uses
positive bike/dock counts but does not yet incorporate a reliability buffer or
station renting/returning flags; routing does not automatically re-plan on a
new GBFS snapshot; and the combo planner is deliberately heuristic rather than
a full MTA timetable graph search.

## Next steps

1. Use the app for real trips and log concrete misses: unavailable bike/dock,
   poor station choice, poor ETA, or a good bike + subway option it missed.
2. Add focused tests around those real routing cases before broadening the
   planner.
3. Revisit GTFS-realtime or a cached serverless route endpoint only if those
   misses demonstrate a need; no spare always-on laptop or persistent backend
   is assumed.
