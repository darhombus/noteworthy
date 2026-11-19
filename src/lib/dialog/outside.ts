/**
 * A click outside a modal dialog closes it, unless the dialog holds something
 * that would be lost.
 *
 * ---------------------------------------------------------------------------
 * THE RULE, AND HOW A DIALOG TAKES PART
 * ---------------------------------------------------------------------------
 * `closeOnOutsideClick` is installed once, on the document, by the root
 * layout. It applies to every `<dialog>` opened with `showModal()`, so a new
 * dialog takes part without importing anything:
 *
 *   - A dialog with nothing unsaved in it closes on a click outside. Nothing to
 *     do: that is the default. The two delete confirmations are such dialogs.
 *   - A dialog holding changes sets `data-unsaved` on its `<dialog>` while any
 *     field differs from what it held when it opened. Then an outside click does
 *     nothing, so nothing typed is lost. Compared with the opening values, not
 *     "touched": typing something and changing it back is unchanged, and it
 *     closes.
 *   - A dialog with a save in flight sets `data-saving` until the save has
 *     finished. Then an outside click does nothing, so the dialog is still
 *     there to show the save failing.
 *
 * In Svelte: `data-unsaved={changed || undefined}`. `undefined` removes the
 * attribute; `false` would set it to the string "false", which still counts.
 *
 * Escape is not this module's: a modal dialog closes on it by itself.
 *
 * ---------------------------------------------------------------------------
 * WHAT COUNTS AS OUTSIDE
 * ---------------------------------------------------------------------------
 * The browser's own light dismiss (`closedby="any"`) is not used for this. It
 * closes unconditionally: the only way to veto it is its `cancel` event, which
 * Escape fires too, and Chromium stops honouring a veto after the first. It
 * is also missing from every shipping Safari.
 *
 * So this is script, taken from the nav panel's Safari path. A click on the
 * dim reaches the page as a click on the `<dialog>` element itself, since the
 * backdrop has no element of its own. It counts only when the press began
 * there too, and both are outside the dialog's box. So a drag that starts
 * inside, selecting text in a field say, and ends over the dim does not
 * close it. The box check, not the target alone, because a dialog whose
 * content does not fill it (padding, a gap) would otherwise close on a click
 * inside itself.
 *
 * Capture phase, so nothing inside a dialog stopping propagation can
 * swallow it.
 */

/** The attributes a dialog sets to stay open; see above. */
export const UNSAVED = 'data-unsaved';
export const SAVING = 'data-saving';

/** Whether the dialog has asked to stay open. */
export function keepsOpen(dialog: Element): boolean {
	return dialog.hasAttribute(UNSAVED) || dialog.hasAttribute(SAVING);
}

/** Whether a point is outside the element's box. */
export function isOutside(element: Element, x: number, y: number): boolean {
	const box = element.getBoundingClientRect();
	return x < box.left || x >= box.right || y < box.top || y >= box.bottom;
}

/** The open modal dialog an event reached through its dim, if it did. */
function dimOf(event: MouseEvent): HTMLDialogElement | null {
	const target = event.target;
	return target instanceof HTMLDialogElement &&
		target.open &&
		target.matches(':modal') &&
		isOutside(target, event.clientX, event.clientY)
		? target
		: null;
}

/** Installs the rule on `root`. Returns what removes it. */
export function closeOnOutsideClick(root: Document): () => void {
	let pressed: HTMLDialogElement | null = null;

	function onPointerDown(event: PointerEvent): void {
		pressed = dimOf(event);
	}

	function onClick(event: MouseEvent): void {
		const dialog = dimOf(event);
		const whole = dialog !== null && dialog === pressed;
		pressed = null;
		if (whole && !keepsOpen(dialog)) {
			dialog.close();
		}
	}

	root.addEventListener('pointerdown', onPointerDown, true);
	root.addEventListener('click', onClick, true);
	return () => {
		root.removeEventListener('pointerdown', onPointerDown, true);
		root.removeEventListener('click', onClick, true);
	};
}
