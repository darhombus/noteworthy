/**
 * The editor's code, fetched before it is needed.
 *
 * TipTap and ProseMirror are one chunk of about 400 KB (125 KB compressed),
 * reached only through the dynamic `import()` here, so they are in no route's
 * bundle and not in the server's module graph (`EntryEditor`). Left to the edit
 * page alone, that import starts in `onMount`, once the page's data has arrived
 * and the page is drawn; measured over a slow mobile connection it finished 140–260 ms after
 * the data every time, and the page waited for it (`docs/constraints.md`, "The
 * editor appears in place").
 *
 * So it starts earlier, from two places, and every caller shares this one
 * `import()`: the browser fetches and runs a module once per document, so the
 * edit page's own call finds it already there and asks the network for nothing.
 *
 *   `importEditor` from `beforeNavigate` in the root layout, when the
 *   navigation is to the edit or new-entry page. That is the tap itself, so the
 *   chunk travels alongside the page's data instead of after it. No check on
 *   the connection: the person is on their way to the editor, which needs this
 *   whatever the connection is like.
 *
 *   `preloadEditorWhenIdle` on an entry's read page and on a journal's page,
 *   the two places Edit and New entry are tapped from, once the page has
 *   nothing better to do. Skipped when the browser says the person is saving
 *   data or is on a 2G connection: there, 125 KB for a tap that may never come
 *   is a real cost, and the import above still starts at the tap.
 *
 * Importing the module runs nothing but declarations — no DOM, no globals, no
 * storage, no data request — so fetching it early changes nothing on the page
 * it is fetched from. That was established in a browser, not assumed; see the
 * constraints.
 */

/**
 * The editor module. The one `import()` of it in the app, so the module and its
 * chunk are the same whoever calls first; a second call is answered from the
 * document's module map.
 */
export function importEditor(): Promise<typeof import('./editor')> {
	return import('./editor');
}

/** The two page routes whose `onMount` imports the editor. */
const EDITOR_ROUTES: readonly string[] = [
	'/journals/[journalId]/entries/[entryId]/edit',
	'/journals/[journalId]/entries/new'
];

/** For `beforeNavigate`: start the editor's chunk now if this navigation leads to the editor. */
export function importEditorFor(routeId: string | null | undefined): void {
	if (routeId !== null && routeId !== undefined && EDITOR_ROUTES.includes(routeId)) {
		importEditor().catch(() => {});
	}
}

/** `navigator.connection`, where the browser has it (Chromium); Firefox and Safari do not. */
type Connection = { saveData?: boolean; effectiveType?: string };

/** True when the browser says fetching ahead would cost the person something. */
export function holdBack(connection: Connection | undefined): boolean {
	return (
		connection?.saveData === true ||
		connection?.effectiveType === 'slow-2g' ||
		connection?.effectiveType === '2g'
	);
}

/**
 * How long to wait where there is no `requestIdleCallback` (Safari): long
 * enough for the page's own first work after mounting to be done, short enough
 * that a tap on Edit a second later finds the chunk on its way.
 */
const IDLE_FALLBACK_MS = 200;

/**
 * Imports the editor once the page is idle, unless `holdBack` says not to.
 * Returns the cancel, for `onMount` to hand back: leaving the page before it
 * is idle fetches nothing.
 */
export function preloadEditorWhenIdle(): () => void {
	const connection = (navigator as Navigator & { connection?: Connection }).connection;
	if (holdBack(connection)) {
		return () => {};
	}
	const run = (): void => {
		importEditor().catch(() => {});
	};
	if (typeof window.requestIdleCallback === 'function') {
		const handle = window.requestIdleCallback(run);
		return () => window.cancelIdleCallback(handle);
	}
	const handle = window.setTimeout(run, IDLE_FALLBACK_MS);
	return () => window.clearTimeout(handle);
}
