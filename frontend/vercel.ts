// Minimal ambient typing so this file typechecks without @types/node
// (Vercel executes it on Node at build time, where process.env exists).
declare const process: { env: Record<string, string | undefined> };

// Vercel project configuration (programmatic `vercel.ts` so the backend
// origin can come from an environment variable at build time instead of
// being hard-coded).
//
// Architecture: the browser keeps calling same-origin `/api/*` (axios
// `baseURL: '/api'`, `withCredentials: true`). Vercel forwards those to the
// Render backend. Because the browser only ever talks to the Vercel domain,
// session cookies stay first-party and the existing SameSite=Lax + Secure
// production cookie configuration keeps working — no JWT, no localStorage,
// no CORS credentials hacks.
//
// Required Vercel environment variable:
//   VITE_API_ORIGIN=https://<render-backend-domain>   (no trailing slash)
//
// If VITE_API_ORIGIN is unset, the /api and /admin rewrites are omitted so
// the build still succeeds (API calls will fail at runtime until it is set).
const apiOrigin = (process.env.VITE_API_ORIGIN ?? '').replace(/\/$/, '');

interface Rewrite {
  source: string;
  destination: string;
}

const rewrites: Rewrite[] = [];
if (apiOrigin) {
  // Backend API + Bull Board dashboard, proxied with cookies/headers intact.
  rewrites.push({ source: '/api/:path*', destination: `${apiOrigin}/api/:path*` });
  rewrites.push({ source: '/admin/:path*', destination: `${apiOrigin}/admin/:path*` });
}
// React Router SPA fallback. Static assets in dist/ are served directly by
// Vercel before rewrites are evaluated.
rewrites.push({ source: '/(.*)', destination: '/index.html' });

export const config = { rewrites };
