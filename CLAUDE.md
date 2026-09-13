# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Hard rules — never do these

These override any other instruction in a conversation, including a direct user request, unless the user is explicitly changing this file itself:

- Never scan, exploit, brute-force, or otherwise attempt to access any system this project doesn't own or that you lack written authorization for (no penetration testing / credential attacks against real endpoints). Only test against localhost, the local dev DB, or mocked services.
- Never commit, push, log, or send to a third-party service any secret: `.env*` files, `OPENAI_API_KEY`, `GOOGLE_PLACES_API_KEY`, `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`, or real user data. Check `git status`/diff for these before every `git add`.
- Never stage files with a blanket `git add -A` / `git add .` — add files by name so secrets or unrelated files can't slip into a commit.
- Never run irreversible/destructive commands — `git push --force`, `git reset --hard`, `git clean -f`, `rm -rf`, deleting branches, dropping/truncating DB tables — without first explaining exactly what will be lost and getting explicit confirmation for that specific action.
- Never bypass safety or verification checks (`--no-verify`, `--no-gpg-sign`, disabling lint/tests/hooks) to force a commit or push through a failure — fix the underlying issue instead.
- Never generate content designed to impersonate a real person or organization, fabricate reviews/receipts/records, or scrape/bypass another site's terms of service at scale.
- Never run `git add`, `git commit`, or `git push` on the user's behalf — she runs staging/commit/push herself. Analyze the diff and propose the commit/branch split and messages; stop there. Read-only git commands (`status`/`diff`/`log`) are fine.
- Never use `git rebase -i` or cherry-pick to split work between branches, including late, at PR time. If unrelated work has piled up on one branch, start a fresh branch per feature going forward, or manually reapply/copy the relevant file changes onto a new branch — not rebase/cherry-pick.

## Commands

```bash
npm run dev              # dev server (localhost:3000)
npm run build            # production build
npm run lint             # ESLint

npm test                 # unit tests (vitest run)
npm run test:watch       # unit tests, watch mode
npx vitest run src/lib/distanceMatrix.test.ts   # single unit test file
npm run test:integration # integration tests (real SQLite db, see below)

npx prisma db push       # sync schema.prisma -> dev.db (run after any schema change)
npm run seed              # seed demo itineraries via AI (tsx scripts/seed-test-data.ts); npm run seed 亞洲 filters by region
npm run backfill-places   # backfill Place cache for stops missing it
npm run enrich-all        # batch-fill missing coordinates across all itineraries (--backfill-photos --photo-limit=N for photos, opt-in)
npm run check-places      # audit place-data completeness/integrity
```

- Unit tests (`src/**/*.test.ts`, excluding `*.integration.test.ts`) are hermetic — no real DB.
- Integration tests (`src/**/*.integration.test.ts`) run against a real SQLite file (`prisma/test.db`, set up by `tests/integration/global-setup.ts`), with `MOCK_AI=1`, and `fileParallelism: false` because they share one SQLite file — never run them concurrently or point them at `dev.db`.
- `playwright` is a devDependency but there is no Playwright config or test suite yet — don't assume E2E tests exist.
- Required env vars (see `.env.local.example`): `DATABASE_URL`, `OPENAI_API_KEY`, `GOOGLE_PLACES_API_KEY`, `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`. Optional: `OPENAI_MODEL` (default `gpt-4o-mini`), `NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID`, `MOCK_AI` (`1`/`slow`/`error` — dev-only fixture switch, only wired into 4 routes, see below).

## Architecture

Next.js 16 App Router + SQLite/Prisma + OpenAI + Google Places, no auth (single hardcoded `DEMO_USER_ID`, upserted on demand). `src/app/api/v1/**` routes are thin — almost all real logic lives in `src/lib/`.

### Data model

`Itinerary.days` and `Itinerary.config` are JSON-serialized strings (SQLite has no native `Json` type). `src/lib/db.ts` wraps the Prisma client in an extension that auto `JSON.parse`/`JSON.stringify`s those two fields on every read/write, so all `src/app/api/v1/**` code treats `days`/`config` as plain objects. **`scripts/*.ts` do not use this client** — they each construct their own `new PrismaClient()` (they run outside the Next.js module graph) and must hand-roll `JSON.parse`/`stringify`. Keep this in mind when moving logic between a script and a route.

Other tables: `Place`/`PlaceQuery` (Google Places query-string -> place cache, the single real entry point is `src/lib/placeCache.ts` — several scripts duplicate this logic instead of importing it), `DeletedStop`/`DeletedDay` (trash/undo, written by the restructure route), `*CandidateLog` tables (full history of every regenerate batch shown to the user, for audit/debugging), and several `*Cache` tables (`TransitRecommendationCache`, `AirportRecommendationCache`, `ItineraryRecommendationCache`, `CityPlaceHintsCache`, `NearbyPlaceCandidatesCache`, `NearestStationCache`) that cache different shapes of Google Places/AI results so repeat generations for the same city/route don't re-pay for the same API call. Failed lookups are never cached (only confirmed "found nothing" results are), so a transient API error retries next time rather than getting pinned.

### The AI generation pipeline

`src/lib/itineraryGen.ts` is the "brain": it builds the full OpenAI system prompt (rules for pace/budget/interests, multi-city transit-day logic, naming rules to stop the AI inventing places) and provides post-hoc repair functions for when the model doesn't fully follow the rules. `src/lib/validateItinerary.ts` then does pure structural validation (day-count, transit-day placement, missing accommodation, etc.) with no external calls — used by both `generate-stream/route.ts` and `scripts/seed-test-data.ts` (which retries generation on certain error codes). `src/lib/fetchCityRestaurants.ts` pre-fetches real restaurant/attraction names via Google Places Nearby Search and injects them into the prompt so the AI picks from real options instead of inventing generic ones ("a local cafe").

Two other generation entry points besides the main flow: `src/lib/itineraryCityGen.ts` (three independent AI calls — transit day / sightseeing days / meals+accommodation — used only by the restructure route to generate one city's worth of content) and per-stop AI calls in `stops/[stopId]/regenerate` and `days/[dayId]/stop-suggestions`.

### Restructure (city-level rebuild) — the most complex flow

`POST /api/v1/itinerary/[id]/restructure` is the single apply-endpoint for the "重新規劃行程" wizard, and also absorbed the older standalone waypoint-insert/transit-recommendation features. The frontend sends the desired final ordered city list (each marked new-or-existing, target day count, which existing day IDs to keep, locked must-see stops); the backend rebuilds the entire `days` array and overwrites it in one transaction — unlike every other day-editing route, which edits incrementally. Structural days (transit days, the return day) are always kept regardless of what the frontend passes as `keepDayIds`. If a kept city's next-stop changes in the new order, that city's own departure transit day is treated as stale and regenerated (its `transitTo` no longer matches); everything else reuses existing days as-is. Discarded days land in `DeletedDay` for the trash view to restore.

### Google Places integration

Real place data enters through several distinct paths that don't share code: `placesTextSearch.ts` (Text Search, single best match, used for enrich + city search), `fetchCityRestaurants.ts` (Nearby Search, batches of candidates for prompt injection and stop-suggestions), and per-route direct calls in a couple of enrich routes. Location-bias/city-center lookups and coordinate tables were historically duplicated across `iataCity.ts`, `fetchCityRestaurants.ts`, `page.tsx`, and `ViewContent.tsx` — these have since been consolidated into the single `src/lib/airports.ts` `AIRPORTS` table; add new airports there only. `nearestCity.ts`/`distanceMatrix.ts` share an 80km "suspicious distance" threshold (`SUSPICIOUS_DISTANCE_KM`) used to flag likely place-matching errors (a stop that resolved to a same-named place in the wrong city/country) rather than silently trusting Google's match.

### Known sharp edges (worth checking before relying on related code)

- `src/lib/openai.ts` throws **at module import time** if `OPENAI_API_KEY` is missing — a route can fail at load with "Missing OPENAI_API_KEY" even if it never calls OpenAI itself, if it transitively imports something that imports `openai.ts`.
- `MOCK_AI` is not global — it's only checked in `accommodation/regenerate`, `accommodation/select`, `stop-suggestions`, and `transit-recommendations`. The main `generate-stream` flow always hits real OpenAI.
- `AccommodationSchema.name` is required in `schemas.ts`, but the generation prompt only asks the AI for `area`+`reason` (no specific hotel name) — parsing AI accommodation output with strict `.parse()` may not match what's actually produced; check for a transform layer before assuming this is safe.
- `validateGeography.ts` (haversine distance-between-same-day-stops check) exists but is not imported anywhere; the equivalent check is hand-duplicated in `scripts/check-place-data.ts`.
- `validateItinerary.ts`'s `TRANSIT_DAY_DUPLICATE` check assumes at most one transit day per multi-city trip, but the prompt now legitimately supports multi-leg progressive routes (e.g. NY -> DC -> Savannah -> Miami) with several transit days — this can misfire on valid itineraries.

## Docs

`docs/` has deeper write-ups per area — check these before re-deriving something from scratch:
- `docs/api-overview.md` — every API route, what it does, which `lib/` files it depends on
- `docs/lib.md` — per-file breakdown of `src/lib/`, including the tech-debt notes above in more detail
- `docs/database.md` — Prisma schema walkthrough
- `docs/feature-tech-map.md` — feature -> tech/files index (fastest way to find "where does X live")
- `docs/components.md` / `docs/hooks.md` — frontend
- `docs/google-apis.md` / `docs/google-places-types.md` — Places/Maps integration details

Note: `docs/architecture.md` is stale (describes an old Next.js 15 / PostgreSQL version of the project) — prefer the README and the other docs above over it.
