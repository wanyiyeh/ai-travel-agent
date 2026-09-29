// Input caps shared by the server schemas (schemas.ts) and the form
// (app/page.tsx). Kept in their own dependency-free module so the client
// bundle doesn't pull in zod just to read two numbers.

// Every trip day costs OpenAI tokens plus several Google lookups, so the
// server caps it rather than trusting the form's date pickers.
export const MAX_TRIP_DAYS = 30;

// The style blurb is spliced into several OpenAI prompts, so its length is
// the caller's lever on token cost. The form's own input stops at
// PROMPT_INPUT_MAX_LENGTH; the server allows more because the form appends
// the picked stopover cities ("中途停留城市：…") before sending.
export const PROMPT_INPUT_MAX_LENGTH = 500;
export const MAX_PROMPT_LENGTH = 1000;
