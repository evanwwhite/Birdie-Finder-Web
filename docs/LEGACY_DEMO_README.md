# Birdie Finder

A complete multi-page disc golf site built from the Build Spec and clickable prototype. Vanilla HTML/CSS/JS — no build step.

## Pages

| File | Screen |
|---|---|
| `login.html` | Supabase email sign-in, account creation, and password recovery |
| `index.html` | Home: hero, live stat band, nearby courses (geolocation), featured discs, brand strip |
| `courses.html` | Course directory with full filter rail + List/Map toggle (Leaflet + MapTiler) |
| `course.html?id=…` | Course detail: stats, hole-by-hole table, reviews, conditions, directions |
| `shop.html` | Disc catalog with category/brand/speed/stability/price filters |
| `disc.html?id=…` | Disc detail: gallery, flight numbers, plastic/color/qty, specs, producer, related |
| `players.html` | Private account round list with sign-out |
| `events.html` | Events with filter chips + register/waitlist |
| `scorecard.html` | Internal account-backed solo scorecard for the synthetic catalog; existing rounds can be opened with `?round=UUID` |

## Setup

**From the workspace root, serve the website locally** (fetch doesn't work over `file://`):
```bash
   cd birdie_finder_web
   python3 -m http.server 8000
   # then open http://localhost:8000/index.html
```

The site includes its own `data/courses.csv` and `data/all_discs.csv`; no files from another project are needed. If the CSVs are missing (or fetch is blocked), pages fall back to built-in sample data.

## Location

Distances and the map anchor to one shared fix, resolved once and reused by every page. Precedence:

1. **Manual pin** — a ZIP or city typed into the location bar. Sticky until cleared.
2. **Cached fix** — 30-minute TTL, so pages never re-prompt.
3. **GPS** — high accuracy, reverse-geocoded to a place name. Browsers only expose this on `https://` or `localhost`.
4. **IP** — coarse fallback (ipwho.is) when GPS is denied or blocked.
5. **Default** — Leicester, MA, clearly labelled as a default.

The location bar always states *how* the fix was obtained, so a coarse IP guess is never mistaken for a real one. ZIP/city search resolves against the bundled `courses.csv` first — instant, offline, exact for the 7k US courses — and only falls through to a geocoder for places with no course in them.

`BF.setLocation()` fires a `bf:location` event; the course list, home page and map re-sort in place without a reload.

## Live & real data

| What | Source | Notes |
|---|---|---|
| Per-hole par, hole number, amenities | OpenStreetMap via [Overpass](https://overpass-api.de) (`disc_golf=hole`) | Cached 7 days. Course detail page only. |
| Current conditions (temp, wind, rain) | [Open-Meteo](https://open-meteo.com) | Cached 15 min, no API key. |
| Geocoding fallback | Open-Meteo Geocoding | Only when the CSV has no match. |

**Coverage is thin, and the UI says so.** OSM has hole data for a few hundred of the 7,008 courses — across all of MA/CT/RI it knows exactly four. So each course page carries a provenance badge:

- `Hole data from OpenStreetMap` — every hole surveyed.
- `N of M holes from OpenStreetMap · rest estimated` — a blend; surveyed rows are marked `●`.
- `Estimated layout — no hole data mapped yet` — fully generated.

Estimated layouts remain deterministic per course id, but pars now follow a realistic disc golf distribution (~86% par 3, so 18 holes land near par 54–58), and **difficulty is derived from average feet per hole** rather than a random pick.

Two deliberate constraints:

- Only distances OSM *states* (a `dist`/`length` tag, or the `description` text) are trusted. Fairway geometry is often a partial centreline — measuring one gave 90 ft for a hole the mapper described as 268 ft — so geometry locates a hole, it never sizes it.
- The course list does **not** hit Overpass; 7,008 lookups would be slow and abusive. Real hole data is fetched per course on the detail page, then cached.

The course page paints the estimated layout immediately and upgrades in place once OSM and the weather resolve, so a slow third party can't leave it stuck on "Loading course…".

## Notes

- **Cart remains local.** The login and solo scorecard use the local/test Supabase project; copy `assets/config.local.example.js` to ignored `assets/config.local.js` and use the same API URL and anon key as the phone. Serve the web app at `http://127.0.0.1:3000` for the configured password-recovery redirect. Never use a service-role key in a browser.
- **Saved solo rounds** are read and written through the shared backend. The old `bf_rounds_v1` localStorage key stays untouched for the C4 importer. Browser score entry needs a connection and has no unsynced draft.
- **Map** reuses the repo's MapTiler config from `src/discMap/map.js`. It fits the viewport to the nearest courses plus your own position, and draws an accuracy ring when the fix is coarse.
- Reviews, terrain, layouts and disc prices are still generated deterministically per id.
- Disc photos are rendered SVGs; other imagery uses the spec's striped placeholder style.
- Attribution is required and rendered on the course page: OpenStreetMap contributors (ODbL) and Open-Meteo.
