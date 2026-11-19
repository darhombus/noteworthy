/**
 * The shape a failed journal action sends back, and how the page reads it;
 * and the font and size the actions read from a submitted form.
 *
 * Shared rather than declared in `+page.server.ts` so the dialogs can import it
 * without importing a server module: `import type` is erased, but pointing
 * client code at a `.server.ts` file is a habit that stops being harmless the
 * moment somebody imports a value from it.
 */
import { isJournalFont, isTextSize, type JournalFont, type TextSize } from './fonts';

export type JournalFormErrors = {
	title?: string;
	description?: string;
	color?: string;
	icon?: string;
	font?: string;
	text_size?: string;
	/** Not attributable to one field. */
	form?: string;
};

const FIELDS = ['title', 'description', 'color', 'icon', 'font', 'text_size', 'form'] as const;

/**
 * The font and size from a submitted journal form, for the actions.
 *
 * A field that is not in the form at all is left out, so the column keeps what
 * it holds (or, on create, takes its default): a tab still running the app from
 * before the picker existed posts neither, and its edit must not fail for it.
 * A value that is there but not a key is refused. The database CHECKs the same
 * lists; this is what turns a hand-made POST into a message rather than a 500.
 */
export function readTypeFields(submitted: FormData): {
	fields: { font?: JournalFont; text_size?: TextSize };
	errors: Pick<JournalFormErrors, 'font' | 'text_size'>;
} {
	const fields: { font?: JournalFont; text_size?: TextSize } = {};
	const errors: Pick<JournalFormErrors, 'font' | 'text_size'> = {};

	const font = submitted.get('font');
	if (font !== null) {
		if (typeof font === 'string' && isJournalFont(font)) {
			fields.font = font;
		} else {
			errors.font = 'Pick a font.';
		}
	}

	const size = submitted.get('text_size');
	if (size !== null) {
		if (typeof size === 'string' && isTextSize(size)) {
			fields.text_size = size;
		} else {
			errors.text_size = 'Pick a size.';
		}
	}

	return { fields, errors };
}

/**
 * Pulls the errors out of an action result.
 *
 * `use:enhance` hands back `Record<string, unknown> | undefined` — a shape the
 * server chose and the client has to re-establish, because nothing types the
 * wire between them. Each field is checked rather than cast, so a payload that
 * is not what this expects degrades to an empty object instead of putting
 * `undefined` where a message should be.
 */
export function readFormErrors(data: Record<string, unknown> | undefined): JournalFormErrors {
	const source = data?.errors;
	if (typeof source !== 'object' || source === null) {
		return {};
	}

	const errors: JournalFormErrors = {};
	for (const field of FIELDS) {
		const message = (source as Record<string, unknown>)[field];
		if (typeof message === 'string' && message.length > 0) {
			errors[field] = message;
		}
	}
	return errors;
}
