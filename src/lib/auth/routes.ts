/**
 * Where a signed-in person belongs.
 *
 * The hook sends signed-in visitors here when they ask for /login or /signup,
 * and signup sends them here once the account exists. The sidebar's wordmark
 * links here too, so all three move together.
 *
 * ---------------------------------------------------------------------------
 * WHY NOT /dashboard
 * ---------------------------------------------------------------------------
 * The shell lists Dashboard first and renders it as unbuilt — a "Soon" badge
 * and no link. Pointing this at `/dashboard` would land every signup and every
 * login on a page the navigation beside it says does not exist: either a
 * placeholder contradicting its own sidebar entry, or a 404 at the end of the
 * happiest path in the app.
 *
 * So it points at `/journals`, the only section that is built. Changed from `/`
 * in the shell PRD — `/` is still the stock scaffold page and is public, which
 * made it a poor landing for somebody who has just signed in. When the dashboard
 * PRD lands it takes both: an `href` on its nav item, and this constant.
 */
import { resolve } from '$app/paths';

/**
 * `resolve()` rather than a bare `'/journals'` so the value carries the branded
 * `ResolvedPathname` type. `redirect()` would take either; the sidebar's
 * wordmark links to this constant, and an anchor needs the brand.
 */
export const APP_HOME = resolve('/journals');

/**
 * The pages a signed-in person is never shown: the hook sends them to
 * `APP_HOME` instead.
 *
 * `/` joins the two auth forms rather than getting a branch of its own. It is
 * the public landing page — a wordmark, a tagline, and buttons offering to sign
 * you up or log you in — so for somebody already signed in it is three offers
 * they have taken. Keeping all three in one set means they move together.
 *
 * `APP_HOME` must not be a member of this set. It is `/journals` today; it was
 * `/` until the shell PRD, and pointing it back here would make the hook send a
 * signed-in visitor to a page that immediately redirects them back.
 *
 * Here rather than in the hook because the root layout reads it too: a document
 * still showing the shell that is about to show one of these has outlived the
 * session it was drawn for (`$lib/auth/stale`).
 *
 * `/forgot-password` joins them: somebody signed in has a password that works.
 * So does `/signup/check-inbox`: somebody signed in has nothing to confirm
 * from this browser. `/auth/confirm` does not, since an email's link must work
 * whoever is signed in.
 */
export const AUTH_ENTRY_PATHS: ReadonlySet<string> = new Set([
	'/',
	'/login',
	'/signup',
	'/signup/check-inbox',
	'/forgot-password'
]);
