// Shared by the delete-account form and route; no server imports, so the
// client bundle can use it.

/** The typed confirmation matches the account's email, ignoring case and surrounding spaces. */
export function confirmsEmail(typed: string, email: string): boolean {
  return typed.trim().toLowerCase() === email.trim().toLowerCase();
}
