/** @type {import('next').NextConfig} */

// Security response headers applied to every route. These are the headers that
// are safe to enable without per-response nonces: they don't touch script/style
// execution or outbound connections, so they can't break the app. A full,
// nonce-based script-src/connect-src CSP is tracked as a follow-up (see
// docs/SECURITY.md) because it requires wiring a nonce through the App Router
// and pinning the API origin.
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()",
  },
  // Clickjacking + base-tag-injection + plugin/object protection. Intentionally
  // omits default-src/script-src/connect-src so existing inline boot scripts and
  // cross-origin API calls keep working until the nonce-based policy lands.
  {
    key: "Content-Security-Policy",
    value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'",
  },
];

const nextConfig = {
  output: "standalone",
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
