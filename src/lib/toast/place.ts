/**
 * The toasts' rules that need no page: how many are kept, which show, and how
 * far the on-screen keyboard lifts them. `Toaster.svelte` measures; this
 * decides. See docs/constraints.md, "Toasts".
 */

export type ToastKind = 'success' | 'info' | 'error';

/** At most this many at once. */
export const MAX_TOASTS = 3;

/** Success and info go by themselves after this long, unless paused. */
export const TOAST_MS = 6000;

/** Between two toasts, and between the stack and anything it must clear. */
export const TOAST_GAP = 8;

/** The stack's distance from the bottom edge when nothing else is there. */
export const TOAST_EDGE = 16;

/**
 * At most `max`, the newest kept. The oldest that is not an error goes first:
 * an error stays until somebody closes it, and losing one unread would be a
 * silent failure. Only when every one is an error does the oldest error go.
 */
export function keepNewest<T extends { kind: ToastKind }>(
	list: readonly T[],
	max = MAX_TOASTS
): T[] {
	const kept = [...list];
	while (kept.length > max) {
		const oldest = kept.findIndex((toast) => toast.kind !== 'error');
		kept.splice(oldest === -1 ? 0 : oldest, 1);
	}
	return kept;
}

/** The same words twice in a row show once: the later is left out. */
export function distinctInARow<T extends { kind: ToastKind; text: string }>(
	list: readonly T[]
): T[] {
	return list.filter(
		(toast, index) =>
			index === 0 || toast.text !== list[index - 1].text || toast.kind !== list[index - 1].kind
	);
}

/**
 * Which toasts show: all of them when the stack fits, or else only one, the
 * newest error if there is any and the newest of all if not.
 */
export function chooseShown<T extends { kind: ToastKind }>(list: readonly T[], fits: boolean): T[] {
	if (fits || list.length <= 1) {
		return [...list];
	}
	const error = list.findLast((toast) => toast.kind === 'error');
	return [error ?? list[list.length - 1]];
}

/** What `window.visualViewport` reports, as far as the lift needs it. */
export type ViewportLike = { offsetTop: number; height: number; scale: number };

/**
 * How far the on-screen keyboard reaches up from the bottom of the window.
 *
 * Chrome on Android (since 108) and Safari on iOS shrink only the visual
 * viewport for the keyboard (`interactive-widget=resizes-visual`, Chrome's
 * default), so a `fixed` element at the bottom of the window stays where it
 * was, behind the keyboard. The visual viewport's bottom is where the window
 * can still be seen; the rest is covered.
 *
 * Nothing while the page is zoomed in: a pinch shrinks the visual viewport
 * too, and that is not a keyboard.
 */
export function keyboardLift(innerHeight: number, viewport: ViewportLike | null): number {
	if (viewport === null || Math.abs(viewport.scale - 1) > 0.01) {
		return 0;
	}
	return Math.max(0, innerHeight - (viewport.offsetTop + viewport.height));
}

/**
 * The keyboard counts as open once it covers more than this. Chrome's URL bar,
 * which hides and shows as the page scrolls, is 56px: not a keyboard.
 */
export const KEYBOARD_MIN = 100;

/**
 * Whether the on-screen keyboard is open: the visual viewport shorter than the
 * window by more than `KEYBOARD_MIN`, wherever it is scrolled to. Not the lift,
 * which is nothing once the visual viewport is scrolled to the window's bottom
 * with the keyboard still open. Never while pinch-zoomed, as for the lift.
 */
export function keyboardOpen(innerHeight: number, viewport: ViewportLike | null): boolean {
	if (viewport === null || Math.abs(viewport.scale - 1) > 0.01) {
		return false;
	}
	return innerHeight - viewport.height > KEYBOARD_MIN;
}

/**
 * Whether a navigation leaves the page its toasts were shown on. The page is
 * the address's path: a navigation that changes only the query or the hash (a
 * shallow `replaceState`, the search page's own address) stays on it.
 */
export function leavesPage(from: URL | null | undefined, to: URL | null | undefined): boolean {
	return from?.pathname !== to?.pathname;
}

/**
 * The stack's distance from the bottom of the window: clear of the keyboard
 * and of the timing readout's box, whichever reaches higher. `readoutTop` is
 * the readout's top edge measured from the bottom of the window, or `null`
 * with no readout.
 */
export function stackOffset(lift: number, readoutTop: number | null): number {
	return Math.max(lift + TOAST_EDGE, readoutTop === null ? 0 : readoutTop + TOAST_GAP);
}

/**
 * Whether toasts of these heights fit, one above the other, between the
 * stack's bottom and the ceiling (both measured from the top of the window).
 */
export function stackFits(heights: readonly number[], bottom: number, ceiling: number): boolean {
	const needed =
		heights.reduce((sum, height) => sum + height, 0) + TOAST_GAP * (heights.length - 1);
	return needed <= bottom - ceiling - TOAST_GAP;
}
