/**
 * The two pieces of arithmetic every menu in the app shares: where it goes when
 * it opens, and which item a key moves to. `AddMediaMenu` and `ActionMenu` both
 * use them, so a fix to either is a fix to both.
 *
 * Plain numbers in and out, so they are tested without a browser.
 */

/** A rectangle in window coordinates, as `getBoundingClientRect` gives it. */
export type Box = { left: number; top: number; right: number; bottom: number };

export type Placement = {
	/** Window coordinates of the menu's top-left corner. */
	left: number;
	top: number;
	/** The width to draw it at: its own, or narrower if the window is. */
	width: number;
	/** Whether it opened above the button because below did not fit. */
	above: boolean;
};

/** Space kept between a menu and the window's edge. */
export const MENU_GUTTER = 8;

/** Space between the button and the menu hanging off it (Tailwind's `mt-1`). */
export const MENU_OFFSET = 4;

/**
 * Where a menu of `width` × `height` goes, hanging off `button`, inside a
 * window of `viewport`.
 *
 * Horizontally it lines up with the button's left edge (`start`) or right edge
 * (`end`), then is pushed back inside a gutter at either side, and narrowed if
 * the window is narrower than the menu. A button near the right of a 320px
 * phone gets a menu that ends 8px from the edge rather than past it.
 *
 * Vertically it goes below the button, unless below is too short and above has
 * more room: the last card in a list sits near the bottom of the page, and a
 * menu below it would run off the window where nobody can scroll to it. When
 * neither side fits, the roomier one wins and the menu is kept inside the
 * window's gutter from the top, so its first item is never the part cut off.
 */
export function placeMenu(
	button: Box,
	size: { width: number; height: number },
	viewport: { width: number; height: number },
	align: 'start' | 'end'
): Placement {
	const width = Math.min(size.width, viewport.width - MENU_GUTTER * 2);
	const wanted = align === 'start' ? button.left : button.right - width;
	const left = Math.min(
		Math.max(wanted, MENU_GUTTER),
		Math.max(MENU_GUTTER, viewport.width - MENU_GUTTER - width)
	);

	const needed = size.height + MENU_OFFSET;
	const below = viewport.height - MENU_GUTTER - button.bottom;
	const aboveRoom = button.top - MENU_GUTTER;
	const above = below < needed && aboveRoom > below;
	const top = above ? Math.max(MENU_GUTTER, button.top - needed) : button.bottom + MENU_OFFSET;

	return { left, top, width, above };
}

/**
 * Which item a key moves focus to, from `index` in a menu of `count` items, or
 * `null` for a key that does not move it.
 *
 * Up and Down wrap round, as the WAI-ARIA menu pattern has them; Home and End
 * jump. `index` of -1 (focus somewhere that is not an item) moves as if from
 * before the first, so Down lands on the first and Up on the last.
 */
export function stepMenu(key: string, index: number, count: number): number | null {
	if (count === 0) {
		return null;
	}
	switch (key) {
		case 'ArrowDown':
			return (index + 1) % count;
		case 'ArrowUp':
			return index < 0 ? count - 1 : (index - 1 + count) % count;
		case 'Home':
			return 0;
		case 'End':
			return count - 1;
		default:
			return null;
	}
}
