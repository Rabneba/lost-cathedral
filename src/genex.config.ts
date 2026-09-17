// src/genex.config.ts — written by `genex init`. DO NOT hardcode URLs here.
//
// Build once, run anywhere. The games host injects the serving environment into
// window.__GENEX__ (a small inline script in the no-cache page, ahead of this
// bundle), so ONE build is correct on every stand — promoting a game is a copy,
// never a rebuild, and an immutable bundle can never pin the wrong environment.
// Vite env still overrides, but is loaded ONLY by `npm run dev`:
//   .env                    -> VITE_GENEX_SLUG (local override for `npm run dev`)
//   .env.development.local  -> local-stack URL overrides (dev mode ONLY; gitignored)
//
// The slug is ALSO baked as a literal below, on purpose: `genex preview/publish`
// excludes .env from the source push (it's treated as a secret file), so a clone of
// the published repo has no .env. Reading the slug from env ALONE would then build
// `slug: undefined` -> the guest-session call posts {} -> 400 -> guests can't play a
// remixed game. The literal keeps a bare clone rebuilding into a working game; the
// env var still wins locally.
const injected: { apiUrl?: string; dashboardOrigins?: string[] } =
  (typeof window !== "undefined" && (window as { __GENEX__?: unknown }).__GENEX__) as
    | { apiUrl?: string; dashboardOrigins?: string[] }
    | undefined ?? {};
export const GENEX = {
  slug: (import.meta.env.VITE_GENEX_SLUG as string | undefined) ?? "lost-cathedral",
  apiUrl:
    (import.meta.env.VITE_GENEX_API_URL as string | undefined) ??
    injected.apiUrl ??
    "https://api.genex.games",
  dashboardOrigins: (
    (import.meta.env.VITE_GENEX_DASHBOARD_ORIGINS as string | undefined) ??
    injected.dashboardOrigins?.join(",") ??
    "https://genex.games"
  ).split(","),
} as const;
