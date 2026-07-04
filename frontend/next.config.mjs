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
  // HTTP-level redirects for retired routes. These must live here (not as a
  // page-level redirect()) because the (dashboard) layout is a Client Component
  // that doesn't render its children during server render — so a redirect() in a
  // page under it never runs at build/SSR time and the route is served as a
  // static 200 shell. Config redirects run at the routing layer before any
  // layout/page renders, emitting a real 307. Legacy "institutions" tenant
  // management was replaced by "tenants"; /super-admin home is the platform
  // dashboard.
  async redirects() {
    return [
      { source: "/super-admin", destination: "/super-admin/platform", permanent: false },
      { source: "/super-admin/audit-logs", destination: "/super-admin/platform/audit", permanent: false },
      { source: "/super-admin/platform/institutions", destination: "/super-admin/platform/tenants", permanent: false },
      { source: "/super-admin/platform/institutions/new", destination: "/super-admin/platform/tenants/new", permanent: false },
      { source: "/super-admin/platform/institutions/:id", destination: "/super-admin/platform/tenants/:id", permanent: false },
    ];
  },
};

export default nextConfig;
