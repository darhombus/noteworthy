/**
 * The storage bar's figure as the editor last measured it, between loads.
 *
 * The bar's figure comes from the shell's load, which reads nothing from the
 * URL and so does not re-run as the person moves around. Once uploads finish,
 * the figure is out of date. This used to be fixed with
 * `invalidate(STORAGE_USAGE)`, and that is how a dropped connection threw the
 * page away. SvelteKit answers a refresh whose data request fails by trying
 * again for the root layout alone, and when that fails too it loads the address
 * as a new document (`load_root_error_page` → `native_navigation`, which sets
 * `location.href`). Offline, that new document is the browser's own "No
 * Internet" page, and the editor, its failed upload and its Try again go with
 * the old one. Nothing can cancel it: it is not a router navigation, so
 * `beforeNavigate` and `onNavigate` never see it.
 *
 * So the editor asks for the figure itself (`GET /media/upload`, the
 * allowance as the server reads it) with a plain `fetch`, whose failure means
 * only that the bar keeps its last figure. The shell shows that measurement
 * until its own load next runs (`forgetMeasuredUsage`), since any load is at
 * least as recent as a measurement made before it.
 * See docs/constraints.md, "A dropped connection never leaves the page".
 */
import { ALLOWANCE_BYTES } from './limits';

let measured = $state<number | null>(null);

/** Bytes in use as last measured since the shell's load ran, or `null`. */
export function measuredUsage(): number | null {
	return measured;
}

/** The shell's load has run again: its figure is the current one. */
export function forgetMeasuredUsage(): void {
	measured = null;
}

/**
 * Reads the allowance with `read` (`remainingAllowance`, from `./upload`,
 * passed in so the shell's bundle never carries the upload code) and keeps it
 * as the bar's figure. Never throws and never navigates: offline or signed out,
 * the bar keeps what it showed.
 */
export async function measureUsage(read: () => Promise<number | null>): Promise<void> {
	try {
		const remaining = await read();
		if (remaining !== null) {
			measured = ALLOWANCE_BYTES - remaining;
		}
	} catch {
		// No connection, or an answer that was not the allowance. Nothing to show.
	}
}
