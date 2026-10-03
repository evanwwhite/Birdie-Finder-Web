# Birdie Finder web

The public site is built from an allowlist. `catalog-live.html` reads only reviewed catalog RPCs, `scorecard.html` and `players.html` use account-backed solo rounds, `import.html` previews and imports eligible old browser rounds, and `login.html` handles account access. The old course, shop, disc, and event pages remain in the repository as a local demo but are excluded from `dist/`. Their description is archived in [the demo README](docs/LEGACY_DEMO_README.md).

## Build the public site

```sh
node scripts/build-public.mjs /tmp/birdie-public-web-check
node scripts/check-public.mjs /tmp/birdie-public-web-check
```

The output includes no legacy CSV, prototype page, `assets/app.js`, Overpass call, or DiscIt call. It generates `assets/config.local.js` with empty connection values unless `BIRDIE_PUBLIC_SUPABASE_URL` and `BIRDIE_PUBLIC_SUPABASE_ANON_KEY` are provided together. Only an anon/publishable key belongs in this client file; the build rejects service-role/secret keys. Configure separate staging and production values when those projects exist. Publish **only the generated output directory**, never this repository root.

For local account testing, copy `assets/config.local.example.js` to ignored `assets/config.local.js`, use the same local Supabase project as the app, and serve this directory at `http://127.0.0.1:3000` for password-recovery redirects. The local synthetic course seed is visible to the scorecard only on localhost; the public catalog RPCs and hosted site exclude it. The old demo pages can be viewed locally with `?demo=1`; their generated content is not suitable for public release.

The old `bf_rounds_v1` localStorage key is never removed by import. A user explicitly claims it for one account, reviews matched and ambiguous records, and can export the original JSON. Eligible single-player records save canonical rounds and scores before a server receipt is acknowledged. Repeating the import reuses stable IDs, and identical-looking array entries remain separate. Account export and deletion are available from `players.html`. Browser score edits require a connection; there is no unsynced browser draft.

The [backend runbook](../birdie_finder_backend/docs/RELEASE_RUNBOOK.md) lists the remaining source-rights, hosted staging, recovery, device, and release gates. The public catalog may be empty until real sources and fields are approved.
