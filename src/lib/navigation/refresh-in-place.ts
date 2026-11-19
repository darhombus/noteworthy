/**
 * Refreshing the page on screen without risking a full page load.
 *
 * `invalidate`, `invalidateAll` and `use:enhance`'s `update()` re-run loads
 * through `__data.json`. When that request fails, SvelteKit asks once more for
 * the root layout's data and, when that fails too, loads the address as a new
 * document (`load_root_error_page` → `native_navigation`, in `client.js`).
 * Offline, the new document is the browser's own error page: whatever the
 * page held goes with it, and the person never asked to leave. Nothing in
 * SvelteKit turns that off, and `beforeNavigate` never sees it.
 *
 * SvelteKit does read `window.fetch` when it makes that request, "to allow
 * using a 3rd party-patched fetch implementation". So while `refreshInPlace`
 * runs, a data request for the page on screen that fails without an answer is
 * answered `{"type":"data","nodes":[]}`, which SvelteKit reads as "every node
 * as it was": the page stays, with what it showed. An answer of any kind from
 * the server, an error status included, goes through untouched, and so does
 * every other request. Once the connection is back, the refresh runs again.
 *
 * Used where a refresh follows somebody's typing: the journal dialog and
 * Rename. See docs/constraints.md, "A dropped connection never leaves the
 * page".
 */
import { invalidateAll } from '$app/navigation';
import { createRefreshGuard, type RefreshGuard } from './refresh-guard';

let guard: RefreshGuard | null = null;

/**
 * Runs `refresh` (`update()`, `invalidateAll`, `invalidate`) so that a data
 * request for this page which cannot reach the server leaves the page as it
 * is, rather than loading it as a new document. Resolves `false` when that
 * happened; the page refreshes itself once the connection is back.
 */
export function refreshInPlace(refresh: () => Promise<unknown>): Promise<boolean> {
	guard ??= createRefreshGuard(window, invalidateAll);
	return guard.run(refresh);
}
