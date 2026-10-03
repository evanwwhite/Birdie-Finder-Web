# Birdie Finder web

Birdie Finder web is a static HTML, CSS, and JavaScript client for browsing reviewed disc golf courses and molds and managing **account-backed solo rounds**. It shares Supabase Auth, catalog data, rounds, and disc bag items with the [iPhone app](../birdie_finder_app/README.md). The [backend](../birdie_finder_backend/README.md) owns the database migrations, access rules, and API functions; this directory has no Node server or npm install step.

## What is available now

| Page | Purpose |
| --- | --- |
| `catalog-live.html` (also public `index.html`) | Search approved courses, inspect reviewed layouts and source details, browse approved disc molds, and add a mold to a signed-in bag. |
| `login.html` | Create an account, sign in, and request or complete password recovery. |
| `scorecard.html` | Start, score, complete, and reopen a signed-in solo round. Browser score edits require a connection; there is no offline browser draft. |
| `players.html` | See saved rounds and bag items, export account data, sign out, or delete the account after confirmation. |
| `import.html` | Claim and review older `bf_rounds_v1` browser records before importing eligible ones. Original localStorage data is kept. |

The public catalog uses only reviewed, non-synthetic facts. Unknown par and distance stay unknown. A new local backend has synthetic scorecard fixtures, but public catalog searches can be empty until a real source has been reviewed and published. Group rounds, events, shop pages, and the older course/disc demo pages are prototype material, not part of the current public site; see [the demo notes](docs/LEGACY_DEMO_README.md).

## Run locally

You need Node.js 20 or later and npm for the shared backend, a running Docker-compatible daemon for local Supabase, Python 3 (or another static HTTP server), and a modern browser. Start in `birdie_finder_web/`; it sits beside `birdie_finder_backend/`.

1. In `birdie_finder_backend/`, start and seed the local Supabase project:

   ```sh
   cd ../birdie_finder_backend
   npm ci
   npm run start
   npm run reset
   npx supabase status
   ```

   `npm run reset` deletes local test data, applies the authoritative migrations, and loads synthetic course fixtures. Copy the **API URL** and **anon/publishable key** from the status output. Do not use a service-role or secret key in browser configuration.

2. In `birdie_finder_web/`, create the ignored local config and replace its example key with the value from `supabase status`:

   ```sh
   cd ../birdie_finder_web
   test -f assets/config.local.js || cp assets/config.local.example.js assets/config.local.js
   ```

   Keep an existing config if it already points to the intended local project. Otherwise set `window.BIRDIE_SUPABASE_URL` to the local API URL (normally `http://127.0.0.1:54321`) and `window.BIRDIE_SUPABASE_ANON_KEY` to the local anon key. Use the **same** local project as the phone if testing cross-client rounds.

3. Serve the directory over HTTP:

   ```sh
   python3 -m http.server 3000
   ```

   Open `http://127.0.0.1:3000/catalog-live.html`. Use this exact origin for local password recovery: the backend allows `http://127.0.0.1:3000/login.html` as a redirect. Recovery messages appear in local Mailpit at `http://127.0.0.1:54324`.

4. Open `login.html` to create a local test account, then `scorecard.html` to start a solo round. If the public catalog is empty, the scorecard can show the local synthetic courses while served from `127.0.0.1` or `localhost`. Save a score and open `players.html` to find the round. `import.html` only has records to review if this browser already contains the old `bf_rounds_v1` localStorage data.

Serving this source directory also exposes the old demo pages for local inspection. They are excluded from the public build. Stop the local backend with `npm run stop` from `birdie_finder_backend/` when finished.

### If something looks wrong

- **Account and catalog connection unavailable:** Check both values in `assets/config.local.js`, confirm `npx supabase status` shows the local backend running, and reload the page. A generated public build also needs both build environment variables.
- **No courses in the catalog:** The synthetic seed is intentionally hidden there. Open the local **scorecard** after signing in to exercise the test course; real public entries require approved source data.
- **Password reset returns to the wrong page:** Serve from `http://127.0.0.1:3000` and request recovery from `login.html`, matching the backend's configured redirect URL.

## Build a publishable directory

`scripts/build-public.mjs` copies an explicit allowlist of the five current pages and their supporting assets into `dist/`; it also creates `index.html` from the catalog page. The build writes `assets/config.local.js` with empty values unless **both** public Supabase environment variables are set. For a connected local preview or a deployment, set them for the appropriate Supabase project. From `birdie_finder_web/`:

```sh
BIRDIE_PUBLIC_SUPABASE_URL="http://127.0.0.1:54321" \
BIRDIE_PUBLIC_SUPABASE_ANON_KEY="<anon key from supabase status>" \
  node scripts/build-public.mjs
node scripts/check-public.mjs dist
python3 -m http.server 3000 --directory dist
```

Open `http://127.0.0.1:3000/` to preview. A hosted build needs that environment's hosted Supabase URL and anon/publishable key, plus matching Auth redirect settings. Publish **only `dist/`**, never the source directory. The build rejects secret/service-role keys and excludes the legacy CSVs, demo pages, `assets/app.js`, and their old external API calls. If you omit the two environment variables, the pages render but account and catalog requests cannot connect.

For an isolated check without touching `dist/`, use:

```sh
node scripts/build-public.mjs /tmp/birdie-public-web-check
node scripts/check-public.mjs /tmp/birdie-public-web-check
```

The `dist/` build can be hosted by any static file host. There is no server-side web process in this project; Supabase serves the account, catalog, and round APIs. The [release runbook](../birdie_finder_backend/docs/RELEASE_RUNBOOK.md) tracks the remaining source-rights, hosted staging, recovery, and browser/device gates.

## How it is organized

| Path | Purpose |
| --- | --- |
| `catalog-live.html`, `login.html`, `scorecard.html`, `players.html`, `import.html` | Current public page entry points. |
| `assets/solo.js` | Supabase client setup and shared catalog/round calls. |
| `assets/legacy-import.js` | Preview and import logic for older browser rounds. |
| `assets/styles.css` and `assets/vendor/supabase.js` | Styling and checked-in browser Supabase client. |
| `scripts/build-public.mjs` and `scripts/check-public.mjs` | Public file allowlist and output checks. |
| `data/`, `assets/app.js`, and older HTML pages | Local prototype material, excluded from `dist/`. |

Approved catalog pages call `search_courses_v1`, `get_course_detail_v1`, and `search_disc_molds_v1`. Solo rounds use `create_solo_round_v1`, `write_score_v1`, and `complete_round_v1`. The browser sends score changes while online; the phone maintains a SQLite outbox for offline scoring. Account data is isolated by the backend's row-level security and owner checks. The [version-one contract](../birdie_finder_backend/contracts/v1/README.md) describes request and response shapes.

Legacy import is explicit and tied to one account in this browser. It keeps the original `bf_rounds_v1` key, gives duplicate-looking records separate stable IDs, and uses server receipts so retries do not create another copy. Records that cannot be matched to reviewed catalog IDs remain local and exportable. The public catalog may be empty until real source rights and field reviews are complete; see the [source register](../birdie_finder_backend/docs/SOURCE_REGISTER.md).
