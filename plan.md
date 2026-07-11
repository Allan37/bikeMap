# bikeMap — plan (living doc, pre-code)

## Vision

"Apple Maps, but it understands Citibike." You bike everywhere via Citibike,
so routing should default to bike-share-aware directions: walk to a station
that actually has bikes, ride, dock at a station near the destination that
actually has space, walk the rest. Later: fold in NYC subway/train data for
mixed bike+transit commutes.

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
- **Architecture: almost entirely client-side, plus one tiny serverless proxy.**
  Mapbox and GBFS are called directly from the browser (Mapbox tokens are
  designed to be public/URL-restricted; GBFS needs no key at all). Yelp
  Fusion is the one exception — its API doesn't support CORS and its key
  must stay server-side — so it's proxied through a single serverless
  function rather than a real backend.
- **Scope: single user (you), not building for others** unless that changes.
  No auth, no accounts for v1. Simplifies everything.
- **Frontend stack: Vite + React + TypeScript**, using `vite-plugin-pwa` for
  the manifest/service worker. TypeScript because the data shapes flowing
  through this (GBFS stations, Mapbox routes, Yelp businesses, our own
  scored route options) are exactly the kind of thing worth catching at
  compile time rather than a runtime `undefined.docks_available`.
- **POI ratings/reviews: Yelp Fusion, included from v1**, not deferred. Adds
  the one serverless function above as a cost.
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
- Live re-routing and manual station override: still not built, still
  reasonable v1.1+ concerns, not blocking.

## Phases

**v1 — Citibike-aware point-to-point routing**
- [x] Map view with live station markers (color/label by bikes & docks available)
- [x] Enter/tap a destination, get back the best station-pair route per above
- [x] Render the 3-leg route (walk / bike / walk) with ETA
- [x] Live user location — used Mapbox's built-in `GeolocateControl` (permission
  UI, pulsing accuracy-circle dot, continuous tracking) instead of a
  hand-rolled `hooks/useGeolocation.ts`; more robust, less code to maintain
- [x] Installable PWA, works on your phone's home screen
- [ ] Custom origin — right now "start" is always live GPS. Eventually want a
  second search input ("From:") that defaults to current location but can
  be overridden with any searched place, reusing the same SearchBar/
  mapboxSearch infra already built for the destination. Not urgent.
- [ ] POI ratings/reviews (Yelp) — not built yet, `search/mapboxSearch.ts`
  covers plain place search but the `poi/` module (Yelp proxy + business
  cards) from the architecture sketch hasn't been started

**v2 — Mixed bike + subway commutes**
- Pull in MTA GTFS (static, for station locations/routes) + GTFS-realtime
  (free API key, for live arrival predictions)
- Extend the candidate-routing logic to consider subway legs as an
  alternative or combined option (e.g. bike to a station with a dock near a
  subway stop, ride, walk or bike the last leg)
- This roughly doubles the "candidate combination" search space — origin
  station × subway route/station × destination station — so the scoring
  approach from v1 needs to generalize, not be citibike-specific
- Real multi-modal optimization here (walk→station→bike→dropoff→walk→subway→
  ride→walk/bike last mile, compared against pure-bike and pure-transit
  baselines) is a proper combinatorial search, and it needs to poll/cache two
  live feeds (GBFS + GTFS-realtime) and merge them. **Not committing to
  "zero backend" as a permanent constraint** — v1's serverless-proxy-only
  shape is right for v1's scope, but v2 doing this search server-side
  (cache both feeds, run the optimization once, serve results) is likely the
  better call rather than shipping two feeds' worth of polling and a bigger
  search to the client. Revisit when we get there.

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
    yelp-business.ts          # GET /api/yelp-business?id=          -> proxies Yelp
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
      candidateSearch.ts                # findNearbyStations(), buildCandidatePairs(),
                                         # getBestRoutes(start, end, stations)
      scoring.ts                         # scoreCandidate() — pure function, the
                                          # actual "algorithm", easy to unit test
    search/
      mapboxSearch.ts                     # searchPlaces(query), retrievePlace(id)
      SearchBar.tsx                        # input + autocomplete dropdown
    poi/
      yelpClient.ts                         # searchNearby(lat,lon), getDetails(id)
                                             # — calls OUR /api proxy, never Yelp direct
      PoiCard.tsx                            # tapped-POI card: name/rating/photo/hours
    routePanel/
      RoutePanel.tsx                          # ranked list of RouteOption cards
      RouteSummary.tsx                         # one option: walk/bike/walk + ETA
    hooks/
      useGeolocation.ts                         # wraps browser Geolocation API
    styles/
```

**Data flow for the core interaction** (type a destination → get a route):
`SearchBar` → `mapboxSearch.searchPlaces()` for autocomplete → user picks one
→ `mapboxSearch.retrievePlace()` for coordinates → `App` calls
`candidateSearch.getBestRoutes(userLocation, destination, liveStations)` →
which calls `findNearbyStations()` (pure, sync, filters by live availability)
→ `buildCandidatePairs()` → `scoring.scoreCandidate()` per pair, which calls
`mapboxDirections` for each leg's actual walk/bike time → ranked
`RouteOption[]` flows back up to `App`, rendered by both `RoutePanel` (list)
and `MapView`/`routeLayer` (drawn on the map).

`useStations()` runs independently on a poll interval and feeds `MapView`
the live marker layer regardless of whether a route is active.

**What's worth unit-testing:** `scoring.ts` and `candidateSearch.ts` are pure
functions (given stations + coordinates, return ranked options) with no
network or DOM — the actual "hard part" logic, and cheap to test with Vitest.
Everything under `map/`, `search/`, `poi/` is mostly API-wrapper glue, lower
value to test in isolation.

## Next steps

Nothing built yet. Next conversation should probably resolve the open
questions above (candidate count, availability buffer) and then sketch the
actual UI flow (what's on screen, what you tap) before writing any code.
