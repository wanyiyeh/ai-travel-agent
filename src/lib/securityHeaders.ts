// Response headers applied to every route via next.config.ts headers().
// Kept here (not inline in the config) so they're unit-testable.

// Hosts the Google Maps JavaScript API needs, per Google's CSP guide for
// Maps JS (developers.google.com/maps/documentation/javascript/content-security-policy).
// Place photos redirect to *.googleusercontent.com (photo route).
const GOOGLE_MAPS = {
  script: ["https://*.googleapis.com", "https://*.gstatic.com", "https://*.google.com", "https://*.ggpht.com", "https://*.googleusercontent.com"],
  img: ["https://*.googleapis.com", "https://*.gstatic.com", "https://*.google.com", "https://*.googleusercontent.com", "https://*.ggpht.com"],
  connect: ["https://*.googleapis.com", "https://*.google.com", "https://*.gstatic.com"],
  font: ["https://fonts.gstatic.com"],
  style: ["https://fonts.googleapis.com"],
  frame: ["https://*.google.com"],
};

// Cloudflare Turnstile (bot check on the trip form): its script, the iframe
// it renders the challenge in, and the calls that iframe's script makes.
const TURNSTILE = "https://challenges.cloudflare.com";

export function buildContentSecurityPolicy(isDev: boolean): string {
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    // Next.js emits inline bootstrap scripts (no nonce set up), and dev mode
    // needs eval for React Refresh. Maps JS also needs eval and blob: workers.
    "script-src": ["'self'", "'unsafe-inline'", "'unsafe-eval'", "blob:", ...GOOGLE_MAPS.script, TURNSTILE],
    // Tailwind/React inline style attributes and Maps' injected styles.
    "style-src": ["'self'", "'unsafe-inline'", ...GOOGLE_MAPS.style],
    "img-src": ["'self'", "data:", "blob:", ...GOOGLE_MAPS.img],
    "font-src": ["'self'", "data:", ...GOOGLE_MAPS.font],
    // Dev adds the HMR websocket.
    "connect-src": ["'self'", "data:", "blob:", ...GOOGLE_MAPS.connect, TURNSTILE, ...(isDev ? ["ws:", "wss:"] : [])],
    "frame-src": [...GOOGLE_MAPS.frame, TURNSTILE],
    "worker-src": ["'self'", "blob:"],
    // Clickjacking: nobody may frame this app.
    "frame-ancestors": ["'none'"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    // The sign-in form posts to our own /api/auth, which redirects to
    // Google's consent page; browsers apply form-action to that redirect too.
    "form-action": ["'self'", "https://accounts.google.com"],
  };
  return Object.entries(directives)
    .map(([name, values]) => `${name} ${values.join(" ")}`)
    .join("; ");
}

export function buildSecurityHeaders(options: { isDev: boolean; enforceCsp: boolean }) {
  const headers = [
    // The browser must not guess a different content type than we send.
    { key: "X-Content-Type-Options", value: "nosniff" },
    // Full URLs (itinerary ids) stay on this origin; other sites see only the origin.
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    // Legacy clickjacking guard for browsers that ignore frame-ancestors.
    { key: "X-Frame-Options", value: "DENY" },
    // The app uses none of these browser features.
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
    {
      // Report-Only first: violations show in the browser console without
      // breaking anything, so the allow-list can be tuned before enforcing.
      key: options.enforceCsp ? "Content-Security-Policy" : "Content-Security-Policy-Report-Only",
      value: buildContentSecurityPolicy(options.isDev),
    },
  ];
  // HSTS only makes sense over HTTPS; on http://localhost it's ignored at
  // best and sticky at worst.
  if (!options.isDev) {
    headers.push({ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" });
  }
  return headers;
}
