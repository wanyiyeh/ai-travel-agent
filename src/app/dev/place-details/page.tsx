import { notFound } from "next/navigation";
import PlaceDetailsBillingCheck from "./PlaceDetailsBillingCheck";

// Development only: opens the Places UI Kit details dialog for a real place
// ID, to check in the Cloud console how often it's billed (#205). Uses the
// real browser key, so each open is billed; ask before using it (CLAUDE.md R1).
export default function Page() {
  if (process.env.NODE_ENV === "production") notFound();
  return <PlaceDetailsBillingCheck />;
}
