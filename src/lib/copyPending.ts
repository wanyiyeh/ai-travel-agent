/**
 * Set on a stop or meal whose description is only the program's own note
 * (「傍晚搭火車回東京」), so missingCopy.ts writes a line in front of it.
 * Its own module so the places that set it don't import the OpenAI client.
 */
export const COPY_PENDING = "copyPending";
