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

## Core problem to solve: the station-picking algorithm

This is the actual value-add over stock Apple/Google Maps — they don't know
which stations have bikes right now. Rough v1 approach, open for discussion:

1. Given start point A and destination B, pull nearby stations around each
   from the static station list (say, top N by walking distance).
2. Filter live: origin candidates need `num_bikes_available > 0` (probably
   with a small buffer, e.g. >1, since a bike can disappear between page
   load and arrival), destination candidates need `num_docks_available > 0`.
3. Score each (origin station, destination station) pair by total estimated
   time: walk(A→station1) + bike(station1→station2) + walk(station2→B).
   Rank, show best 1-3 options — not just nearest station, since nearest
   might be empty or might not minimize total trip time.
4. Fallback when no viable station pair exists nearby (e.g. everything's
   empty/full): probably just surface a plain walking route and say so,
   rather than failing silently.

**Open questions:**
- How many candidate stations per side (N) — 3? 5? tradeoff between API call
  volume and route quality.
- Buffer/threshold for "has a bike" — exact availability can lag the feed by
  up to a minute; do we pad the threshold or just accept some staleness?
- Live re-routing: if you're mid-walk and your target station empties out,
  do we re-check and re-suggest? (Probably a v1.1 concern, not v1.)
- Do we ever want manual override (user picks a specific station instead of
  the algorithm's top pick)?

## Phases

**v1 — Citibike-aware point-to-point routing**
- Map view with live station markers (color/label by bikes & docks available)
- Enter/tap a destination, get back the best station-pair route per above
- Render the 3-leg route (walk / bike / walk) with ETA
- Installable PWA, works on your phone's home screen

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
