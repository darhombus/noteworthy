/**
 * A document that outlived the session it was drawn for.
 *
 * Logging out is a plain form POST, so it ends the document it was pressed in.
 * Two things can bring that document, or one like it, back while nobody is
 * signed in, and the server never hears about either:
 *
 * - **The back/forward cache.** Chrome keeps a `no-store` page and restores it
 *   unless cookies changed, and which changes count is Chrome's decision, not
 *   the app's. On a person's Android phone and Windows PC, Back after logging
 *   out put the entry back on screen, signed-in shell and all, while Supabase's
 *   cookies were not `HttpOnly`; the explainer for Chrome's rule names only
 *   `HttpOnly` cookies. They are now (`$lib/supabase/cookies`), and every page
 *   is sent `no-store` (`hooks.server.ts`), the signed-out page a session began
 *   in as well, so a logout in this browser drops the kept pages by Chrome's
 *   own rule and Back is an ordinary navigation. Until that page was
 *   `no-store` too, Chrome kept it, and this guard hid and reloaded it: a blank
 *   screen for two round trips (docs/constraints.md, "Back after logout on the
 *   real site"). What is left for this guard: a session that ended
 *   without this browser's session cookies changing while the page was kept
 *   (signed out on another device, a password changed elsewhere, the account
 *   removed: the server learns it when the token next needs refreshing), and
 *   any browser that restores a `no-store` page after its `HttpOnly` cookies
 *   changed (a Chromium without that level of the rule). Firefox and Safari
 *   keep no `no-store` page at all.
 * - **SvelteKit's own history.** Inside a restored document, or one left open
 *   while the session ended in another tab, Back and links are client-side
 *   navigations. The data request is answered with a redirect to `/login`,
 *   which the client follows in the same document, and the root layout's load
 *   reads nothing from the URL, so it is not asked again: `/login` came up
 *   inside the signed-in shell, which a refresh removed.
 *
 * Both are answered here by handing the page back to the server with a full
 * load, which redirects to `/login` when signed out. See docs/constraints.md,
 * "Nothing signed in is stored".
 */
import type { OnNavigate } from '@sveltejs/kit';
import { AUTH_ENTRY_PATHS } from './routes';
import { readSessionMark } from './session-mark';

/**
 * What a page holding work of its own reports when the back/forward cache
 * gives it back: `none` once nothing is left unsaved, `signed-out` when the
 * server refused to save it for want of a session, `unsaved` when it could not
 * be saved for any other reason (no connection, a server error).
 */
export type Unfinished = 'none' | 'unsaved' | 'signed-out';

const finishers = new Set<() => Promise<Unfinished>>();
let reloading = false;

/**
 * Registers a page's way of finishing its work before a restored page is
 * reloaded: the entry editors' autosave, which would otherwise lose whatever
 * the reload throws away. Returns the unregistration.
 */
export function finishBeforeRestoreReload(finish: () => Promise<Unfinished>): () => void {
	finishers.add(finish);
	return () => finishers.delete(finish);
}

/**
 * True once a restored page has been told to reload. A page that asks before
 * leaving (`beforeunload`) must not ask then: by this point its work is saved
 * or cannot be, and a "stay" answered to that question would leave the page
 * hidden with nothing left to reveal or reload it.
 */
export function reloadingForSession(): boolean {
	return reloading;
}

/** How long a restored page waits for its work to be saved before deciding. */
export const FINISH_WAIT_MS = 10_000;

/**
 * Reloads a page drawn for somebody signed in when the back/forward cache
 * restores it, and hides it on the way into the cache so that it is never on
 * screen before the reload. Returns the cleanup.
 *
 * Every time, not only when the session changed, because the page cannot tell
 * reliably. Comparing cookies at `pagehide` with cookies at `pageshow` misses
 * the very case it is for: the logout's response deletes the cookies before
 * the page it was pressed on hides, so both readings are already signed out
 * (measured). The server can tell, and a reload asks it: signed out, the
 * answer is the 303 to `/login`; still signed in, the page as it is now.
 *
 * Except when the page holds work a reload would lose (`finishBeforeRestoreReload`):
 * that is saved first, while the page stays hidden. Saved, or refused for want
 * of a session, the page reloads. Not saved for another reason, the page is
 * shown again as it was, text and all, its own retry intact, provided the
 * session mark it was drawn with is still the one in this browser
 * (`$lib/auth/session-mark`): the server deletes it with the session, at a
 * logout or a refused refresh, and gives a new session a new one, and nobody
 * signs out of a browser without reaching the server, so an offline save cannot
 * hide one. Until the session cookies were HTTP-only this compared the cookie
 * names a page could read; it can read none of the session's now. Measured
 * before this: typing whose save had failed came back with the page and the
 * reload threw it away.
 *
 * A page drawn signed out (the landing page, login, signup) is left to the
 * cache: there is nothing on it to protect, and the hook sends a signed-in
 * visitor on from any of them at the next request.
 *
 * WHAT HIDES IT, AND WHAT SHOWS IT AGAIN
 *
 * Hidden only at a `pagehide` the browser marks `persisted`, on a page drawn
 * signed in. The HTML standard fires `pagehide` only as a document is
 * unloaded, for a navigation or for closing it, and `persisted` means it is
 * being kept for Back; it comes back only through a history traversal, which
 * fires `pageshow` with `persisted`. Freezing and resuming a page, and
 * switching apps or tabs, fire `freeze`, `resume` and `visibilitychange`, not
 * `pagehide` (on iOS, switching tabs fires `visibilitychange` and closing a
 * tab or suspending the app fires nothing: WebKit bug 199854). So every hide
 * is followed by a decision or by the page being thrown away. In case some
 * browser ever brings a hidden page back without `pageshow`, `resume` and a
 * `visibilitychange` to visible decide too; a page not hidden by this ignores
 * them. The decision runs once per hide, and both of its ends act: reload, or
 * show. The reload cannot be talked out of by the page itself
 * (`reloadingForSession`).
 *
 * Hidden on the way in, because a page hidden at `pagehide` is no longer on
 * screen, so nothing visible changes, and the first frame of a restore is then
 * already hidden. `signedIn` is read at `pagehide`, as the page is left; the
 * mark it was drawn with is read when this is set up, so the caller sets it up
 * again whenever the page is drawn for somebody new.
 */
export function reloadRestoredSignedInPages(
	signedIn: () => boolean,
	win: Window = window
): () => void {
	const doc = win.document;
	const root = doc.documentElement;
	const drawnWith = readSessionMark(doc.cookie);
	let hidden = false;
	let deciding = false;

	function onPageHide(event: PageTransitionEvent): void {
		if (event.persisted && signedIn()) {
			hidden = true;
			root.style.visibility = 'hidden';
		}
	}

	async function decide(): Promise<void> {
		if (!hidden || deciding) {
			return;
		}
		deciding = true;
		const results = await Promise.all(
			[...finishers].map((finish) =>
				Promise.race([
					finish().catch((): Unfinished => 'unsaved'),
					new Promise<Unfinished>((settle) => setTimeout(() => settle('unsaved'), FINISH_WAIT_MS))
				])
			)
		);
		const sessionKept = drawnWith !== null && readSessionMark(doc.cookie) === drawnWith;
		if (results.includes('unsaved') && !results.includes('signed-out') && sessionKept) {
			hidden = false;
			deciding = false;
			root.style.removeProperty('visibility');
			return;
		}
		reloading = true;
		win.location.reload();
	}

	function onPageShow(event: PageTransitionEvent): void {
		if (event.persisted) {
			void decide();
		}
	}

	function onVisible(): void {
		if (doc.visibilityState === 'visible') {
			void decide();
		}
	}

	win.addEventListener('pagehide', onPageHide);
	win.addEventListener('pageshow', onPageShow);
	doc.addEventListener('resume', onVisible);
	doc.addEventListener('visibilitychange', onVisible);
	return () => {
		win.removeEventListener('pagehide', onPageHide);
		win.removeEventListener('pageshow', onPageShow);
		doc.removeEventListener('resume', onVisible);
		doc.removeEventListener('visibilitychange', onVisible);
	};
}

/**
 * An `onNavigate` callback: a client-side navigation from a document drawn
 * signed in to a page in `AUTH_ENTRY_PATHS` (`/`, `/login`, `/signup`,
 * `/signup/check-inbox`, `/forgot-password`) becomes a full load of the same
 * address.
 *
 * The server never draws those for somebody signed in: a signed-in request for
 * one is redirected to `APP_HOME`. So a document drawn signed in that arrives
 * at one has outlived its session, almost always by following the redirect a
 * signed-out data request is answered with. Reloading drops everything it held
 * in memory, the shell's name and avatar included. "Drawn signed in" includes
 * the pages drawn without the shell (`/reset-password`, `/auth/confirm` for
 * somebody signed in): `shellUser` is set there too, and neither rule here
 * looks at what is on screen.
 *
 * `onNavigate` rather than `beforeNavigate`, which SvelteKit does not call on
 * the redirected leg of a navigation. `onNavigate` is called there, after the
 * address has changed and before anything is drawn, and the update waits for
 * the promise it returns, which the reload makes moot. `location.replace`, so
 * the entry the address was just given is the one that loads, as a server
 * redirect would leave it.
 *
 * `signedIn` reads what the document believes, the root layout's `shellUser`,
 * not the cookie: the question is who the page was drawn for.
 */
export function reloadSignedOutPages(
	signedIn: () => boolean,
	leave: (href: string) => void = (href) => location.replace(href)
): (navigation: Pick<OnNavigate, 'to'>) => Promise<never> | undefined {
	return ({ to }) => {
		if (!to || !signedIn() || !AUTH_ENTRY_PATHS.has(to.url.pathname)) {
			return undefined;
		}
		leave(to.url.href);
		return new Promise<never>(() => {});
	};
}
