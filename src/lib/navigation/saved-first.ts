/**
 * A page reached from an entry's editor shows what has been saved.
 *
 * Kept free of `$app` imports so it can be tested without SvelteKit's runtime;
 * `./saved-first-app` wires it to the window and to `navigating`.
 *
 * ---------------------------------------------------------------------------
 * WHY THE PAGE COULD SHOW AN OLDER COPY
 * ---------------------------------------------------------------------------
 * SvelteKit (2.70.3, `client.js`) preloads a link's data when the pointer
 * rests on it or a finger touches it, and keeps that one answer in a single
 * slot, `load_cache`, with no time limit. A navigation to that page takes it
 * as it is. Only another preload, a completed navigation or an invalidation
 * empties the slot. So a preload made before the last save, by a mouse
 * crossing the breadcrumb on its way somewhere, was drawn after it: the old
 * text. And leaving with a save on its way sent it without waiting, so the
 * next page's own request could reach the server first.
 *
 * Nothing public empties the slot except the invalidation functions, which
 * re-run the edit page's loads (offline, the browser's error page), or start
 * a navigation of their own. But SvelteKit reads `window.fetch` when it asks
 * for a page's data (`load_data`, "to allow using a 3rd party-patched
 * fetch"), so what it keeps can be decided here, before it has it.
 *
 * ---------------------------------------------------------------------------
 * THE RULE, WHILE AN ENTRY PAGE IS OPEN (`watch`)
 * ---------------------------------------------------------------------------
 * For a data request for another page:
 *
 *   During a navigation: sent once no save is waiting or on its way.
 *
 *   Otherwise it is a preload. It is sent at once, so the head start is kept,
 *   and its answer is held, not handed over. When a navigation to that page
 *   starts (`leaving`), the answer is handed over if no save was on its way
 *   when it was asked, none has started since, none is waiting, and it is no
 *   older than `HELD_AT_MOST_MS`. Otherwise the saves are finished and the
 *   page is asked again, and the early request is aborted.
 *
 * A held answer nobody can use any more (a newer preload took SvelteKit's
 * slot, or the page was left) is handed over as it is, so nothing waits on it
 * for good. Data requests for the page on screen, and every other request,
 * go through untouched.
 */
import { dataPathOf, sameQuery } from './refresh-guard';

const DATA_SUFFIX = '/__data.json';
/** Present on every data request SvelteKit makes (`load_data`). */
const INVALIDATED = 'x-sveltekit-invalidated';

/**
 * How long a held answer may wait for its navigation, 60 s. Its media links
 * are stamped as received when SvelteKit reads it (`received` in
 * `$lib/media/page-links`), so held longer they would look younger than they
 * are; links are renewed 10 minutes before they expire (`REFRESH_EARLY_MS`),
 * so a minute's error is harmless. And a page preloaded a minute ago is asked
 * again anyway, so a change made elsewhere meanwhile shows.
 */
export const HELD_AT_MOST_MS = 60_000;

/** The saves of the entry page that is open. */
export type Writer = {
	/** How many saves have been sent: one more as each starts. */
	sent: () => number;
	/** A save is on its way now. */
	saving: () => boolean;
	/** Something is waiting to be saved, or on its way. */
	outstanding: () => boolean;
	/** Sends what is waiting, and resolves once nothing is on its way. */
	finish: () => Promise<void>;
};

type Win = {
	fetch: typeof fetch;
	location: Pick<Location, 'href' | 'origin' | 'pathname' | 'search'>;
};

export type SavedFirst = {
	/** Applies the rule while `writer`'s page is open; returns its end. */
	watch: (writer: Writer) => () => void;
	/** A navigation to `to` is starting, and was not cancelled. */
	leaving: (to: URL) => void;
};

type Held = {
	url: URL;
	/** Handed over, or asked again, by the rule. */
	decide: () => void;
	/** Handed over as it is: nobody will read it. */
	orphan: () => void;
};

/** A data request SvelteKit makes for a page other than the one on screen, or `null`. */
function dataRequestFor(
	input: RequestInfo | URL,
	init: RequestInit | undefined,
	location: Win['location']
): URL | null {
	const method = input instanceof Request ? input.method : (init?.method ?? 'GET');
	const url = new URL(input instanceof Request ? input.url : String(input), location.href);
	if (
		method.toUpperCase() !== 'GET' ||
		url.origin !== location.origin ||
		!url.pathname.endsWith(DATA_SUFFIX) ||
		!url.searchParams.has(INVALIDATED)
	) {
		return null;
	}
	const onScreen =
		url.pathname === dataPathOf(location.pathname) &&
		sameQuery(url.searchParams, new URLSearchParams(location.search));
	return onScreen ? null : url;
}

function isFor(url: URL, to: URL): boolean {
	return url.pathname === dataPathOf(to.pathname) && sameQuery(url.searchParams, to.searchParams);
}

/**
 * Wraps `win.fetch` once. `navigating` says whether a navigation is under way
 * (SvelteKit sets it before it asks for the page's data).
 */
export function createSavedFirst(
	win: Win,
	navigating: () => boolean,
	now: () => number = () => Date.now()
): SavedFirst {
	const original = win.fetch;
	let writer: Writer | null = null;
	let held: Held[] = [];

	/** Every held answer, handed over as it is. */
	function orphanAll(): void {
		const all = held;
		held = [];
		for (const entry of all) {
			entry.orphan();
		}
	}

	async function afterSaves(
		saves: Writer,
		input: RequestInfo | URL,
		init: RequestInit | undefined
	): Promise<Response> {
		if (saves.saving() || saves.outstanding()) {
			await saves.finish();
		}
		return original(input, init);
	}

	function hold(
		saves: Writer,
		url: URL,
		input: RequestInfo | URL,
		init: RequestInit | undefined
	): Promise<Response> {
		// SvelteKit keeps one preload: a newer one means the older answers are
		// read by nobody.
		orphanAll();

		const early = new AbortController();
		const answer = original(input, { ...init, signal: init?.signal ?? early.signal });
		// Held: a failure is the reader's to see, when there is one.
		answer.catch(() => {});
		const asked = { at: now(), sent: saves.sent(), clean: !saves.saving() };

		return new Promise<Response>((resolve, reject) => {
			const handOver = () => void answer.then(resolve, reject);
			held.push({
				url,
				orphan: handOver,
				decide: () => {
					const fresh =
						asked.clean &&
						saves.sent() === asked.sent &&
						!saves.outstanding() &&
						now() - asked.at <= HELD_AT_MOST_MS;
					if (fresh) {
						handOver();
						return;
					}
					early.abort();
					afterSaves(saves, input, init).then(resolve, reject);
				}
			});
		});
	}

	win.fetch = (input, init) => {
		const url = writer === null ? null : dataRequestFor(input, init, win.location);
		if (writer === null || url === null) {
			return original(input, init);
		}
		return navigating() ? afterSaves(writer, input, init) : hold(writer, url, input, init);
	};

	return {
		watch(saves) {
			orphanAll();
			writer = saves;
			return () => {
				if (writer === saves) {
					writer = null;
					orphanAll();
				}
			};
		},
		leaving(to) {
			const going = held.filter((entry) => isFor(entry.url, to));
			held = held.filter((entry) => !going.includes(entry));
			for (const entry of going) {
				entry.decide();
			}
		}
	};
}
