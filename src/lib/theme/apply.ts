/**
 * Applying a choice in the browser, which is two separate things.
 *
 * The class on `<html>` is what the page is painted from *now*; the cookie is
 * what the next server render will read. Doing only the first would lose the
 * choice on reload, and doing only the second would leave the current page in
 * the old theme until the next navigation. Neither is worth a round trip, so
 * both happen here, locally, in the same tick as the click.
 *
 * Browser-only — it touches `document` and `location`, so nothing imports it
 * from a load function or a server route. The pure half lives in `./cookie`.
 */
import { serializeThemeCookie, type Theme } from './cookie';

export function applyTheme(theme: Theme): void {
	const root = document.documentElement;

	/**
	 * Both classes come off first, so cycling never leaves `class="light dark"`
	 * behind. `system` then adds nothing, which is the state the `dark` variant
	 * in `src/routes/layout.css` looks for — `html:not(.light):not(.dark)` —
	 * before handing the decision to `prefers-color-scheme`.
	 *
	 * That is also why choosing `system` needs no `matchMedia` listener: the
	 * media query is live, so an OS that flips at sunset repaints the open page
	 * on its own.
	 */
	root.classList.remove('light', 'dark');

	if (theme !== 'system') {
		root.classList.add(theme);
	}

	document.cookie = serializeThemeCookie(theme, location.protocol === 'https:');
}
