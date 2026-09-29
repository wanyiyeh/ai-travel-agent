// Input caps shared by the server schemas (schemas.ts) and the form
// (app/page.tsx). Kept in their own dependency-free module so the client
// bundle doesn't pull in zod just to read two numbers.

// Every trip day costs OpenAI tokens plus several Google lookups, so the
// server caps it rather than trusting the form's date pickers.
export const MAX_TRIP_DAYS = 30;

// Restructure's per-city day stepper stops here; the server enforces the
// same number plus MAX_TRIP_DAYS across all cities.
export const MAX_CITY_DAYS = 14;

// The style blurb is spliced into several OpenAI prompts, so its length is
// the caller's lever on token cost. The form's own input stops at
// PROMPT_INPUT_MAX_LENGTH; the server allows more because the form appends
// the picked stopover cities ("中途停留城市：…") before sending.
export const PROMPT_INPUT_MAX_LENGTH = 500;
export const MAX_PROMPT_LENGTH = 1000;

// Generic caps for request fields that end up in a prompt, a Google query or
// the DB: a place/city name or id, and a longer free-text field (address,
// description, extra context). Generous enough for any real value — the
// point is that a caller can't send megabytes.
export const MAX_NAME_LENGTH = 200;
export const MAX_TEXT_LENGTH = 1000;
// Whole-request cap, enforced in src/proxy.ts before any route parses the
// body. The largest real request is a stops batch (MAX_LIST_LENGTH stops
// with descriptions, ~50KB), so this leaves plenty of headroom.
export const MAX_REQUEST_BODY_BYTES = 256 * 1024;

// Upper bound for a list of full objects, e.g. stops added in one batch.
export const MAX_LIST_LENGTH = 50;
// Upper bound for a list of bare names. Looser than MAX_LIST_LENGTH because
// the UI legitimately sends every stop name in the trip (transit
// recommendations' existingStops) or every name seen across repeated
// "換一批" refreshes (stop-suggestions' excludeNames).
export const MAX_NAME_LIST_LENGTH = 500;
