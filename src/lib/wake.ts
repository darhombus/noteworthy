/**
 * Wakes the server when the app is likely about to be used after a pause, so
 * that the tap that follows pays neither for a new connection nor for a cold
 * function instance (`src/routes/wake/+server.ts`).
 *
 * Measured over a slow mobile connection before this (docs/constraints.md, "The timing
 * readout"): the first tap after ten minutes idle took about 2.2 s, every one
 * of them on a new connection and a cold instance, against a few hundred ms
 * warm. A person returning to the app reaches for it a second or two before
 * they tap: the tab shown again, the window focused, the mouse moved. That is
 * when this asks.
 *
 * - **When.** The page shown again (`visibilitychange` to visible, or a
 *   `pageshow` from the back/forward cache); the window focused; and the first
 *   `pointermove`, `pointerdown`, `touchstart` or `keydown` after `IDLE_MS`
 *   with none of them (a visible tab left alone, where the mouse moves a few
 *   hundred ms before the click).
 * - **At most once every `WAKE_GAP_MS`.** The document's own load counts as
 *   the last one, so nothing is sent at load (its first `pageshow`, a focus
 *   that comes with it) or within that gap after it.
 * - **Not while `navigator.onLine` is false.** A failure is silent, and nothing
 *   retries it but the next trigger.
 *
 * Times are the page's monotonic clock (`performance.now()`), never a time the
 * server wrote. Nothing is stored: the last wake lives in this closure and ends
 * with the document.
 *
 * The request is a plain `fetch` taken when this module loaded, before any
 * `refreshInPlace` could wrap `window.fetch` (`$lib/navigation/refresh-guard`),
 * so that wrapper never sees it. It is not a navigation, so the progress bar
 * (`navigating`) never shows for it.
 */

/** Where a wake is sent: `src/routes/wake/+server.ts`. */
export const WAKE_PATH = '/wake';

/** No more than one wake in this long. */
export const WAKE_GAP_MS = 30_000;

/** Input after this long without any counts as a return. */
export const IDLE_MS = 60_000;

/** What counts as somebody using the page again. */
export const INPUT_EVENTS = ['pointermove', 'pointerdown', 'touchstart', 'keydown'] as const;

const plainFetch: typeof fetch | undefined =
	typeof fetch === 'function' ? fetch.bind(globalThis) : undefined;

/**
 * Asks `path` once, quietly. `cache: 'no-store'`, so no stored answer can ever
 * stand in for reaching the server. Not `keepalive`: the wake is sent as the
 * page comes back, not as it goes, and a document that is leaving makes its
 * own request. Not `priority: 'low'`: Chrome may hold a low-priority request
 * back, and the wake is only worth anything if it leaves at once; the tap's own
 * request comes later, and HTTP/2 carries both on the one connection.
 */
export function sendWake(path: string, request: typeof fetch | undefined = plainFetch): void {
	if (request === undefined) return;
	void request(path, { cache: 'no-store', credentials: 'same-origin' }).then(
		() => {},
		() => {}
	);
}

export type WakeWindow = Pick<Window, 'addEventListener' | 'removeEventListener'> & {
	document: Pick<Document, 'visibilityState' | 'addEventListener' | 'removeEventListener'>;
	navigator: Pick<Navigator, 'onLine'>;
	performance: Pick<Performance, 'now'>;
};

/** Listens for a return and calls `wake` for it, within the rules above. Returns the cleanup. */
export function wakeOnReturn(wake: () => void, win: WakeWindow = window): () => void {
	const doc = win.document;
	const now = () => win.performance.now();
	let last = now();
	let lastInput = last;

	function maybeWake(): void {
		const at = now();
		if (at - last < WAKE_GAP_MS || !win.navigator.onLine) {
			return;
		}
		last = at;
		wake();
	}

	const onVisibility = () => {
		if (doc.visibilityState === 'visible') maybeWake();
	};
	// A `pageshow` that is not `persisted` is the document's own first load.
	const onPageShow = (event: Event) => {
		if ((event as PageTransitionEvent).persisted) maybeWake();
	};
	const onInput = () => {
		const at = now();
		const idle = at - lastInput >= IDLE_MS;
		lastInput = at;
		if (idle) maybeWake();
	};
	const passive = { capture: true, passive: true } as const;

	doc.addEventListener('visibilitychange', onVisibility);
	win.addEventListener('pageshow', onPageShow);
	win.addEventListener('focus', maybeWake);
	for (const type of INPUT_EVENTS) win.addEventListener(type, onInput, passive);
	return () => {
		doc.removeEventListener('visibilitychange', onVisibility);
		win.removeEventListener('pageshow', onPageShow);
		win.removeEventListener('focus', maybeWake);
		for (const type of INPUT_EVENTS) win.removeEventListener(type, onInput, passive);
	};
}
