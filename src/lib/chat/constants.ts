// The chat's numbers and words the browser needs too, in a module with no
// server imports so the chat panel can use them.

/** Longest message the owner can send; the route rejects longer ones. */
export const CHAT_MESSAGE_MAX_LENGTH = 500;

/** Buttons under an empty or finished conversation, so a first-time owner sees what to ask. */
export const SUGGESTED_QUESTIONS = ["哪一天最趕？", "第一天要做什麼？", "幫我調整城市天數"];
