/**
 * What an edit to an entry has to satisfy, in one place.
 *
 * There are two ways to write an entry now and they must agree about every rule.
 * `POST .../autosave` is the one that runs while somebody types; the form action
 * on the edit page is the one that runs when there is no JavaScript, or when the
 * editor's chunk never arrived and the field is still a textarea. Two copies of
 * "is this date real" would be two chances to answer differently, and the one
 * that ran less often would be the one nobody noticed was wrong.
 *
 * The new-entry action shares `submittedBody` and nothing else. Its body comes
 * from the same editor, so it has to come through the same door; its other rules
 * genuinely differ — a blank date there means today, and here it means a mistake.
 *
 * Nothing here touches the database or knows what a request is. It takes what
 * arrived and returns either the patch to apply or the messages to show.
 */
import { MAX_MEDIA_PER_ENTRY } from '$lib/media/limits';
import { tooManyMessage } from '$lib/media/messages';
import { isBlank, toBody, toPlainText, type EntryBody } from './body';
import { parseDocument, type SanitizeContext } from './document';
import { countMedia, hasMedia } from './media';

export const MAX_TITLE = 200;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export type EntryEditErrors = {
	title?: string;
	body?: string;
	entryDate?: string;
};

export type EntryEditInput = {
	title: string;
	entryDate: string;
	/** The TipTap document, as JSON, once the editor is running. */
	doc: string | null;
	/** The textarea's plain text, for a submit that predates the editor. */
	body: string;
} & BodyContext;

/**
 * Who is writing, and — for a submit from the textarea — what is stored now.
 *
 * `stored` is read by the caller only when `doc` is absent, because only the
 * textarea path needs it; see `submittedBody`.
 */
export type BodyContext = SanitizeContext & { stored?: EntryBody };

export type BodyResult = { ok: true; content: EntryBody } | { ok: false; message: string };

export type EntryEditPatch = {
	title: string | null;
	content: EntryBody;
	entry_date: string;
};

export type EntryEditResult =
	{ ok: true; patch: EntryEditPatch } | { ok: false; errors: EntryEditErrors };

/** What to say when `doc` is not a document at all. */
export const UNREADABLE_BODY = 'Could not read what was written. Try again.';

/** What to say when the textarea tries to replace a body that holds media. */
export const TEXTAREA_KEEPS_MEDIA =
	'This entry has photos, video or audio, which the plain text box can’t keep, so its text can’t be changed here. Put the text back as it was to save the title and date, or edit the entry with JavaScript on.';

function normalisedText(text: string): string {
	return text.replace(/\r\n/g, '\n').trim();
}

/**
 * The body a browser sent, as the document to store — or the reason it cannot
 * be stored.
 *
 * The body arrives under one of two names and this is the only place that knows
 * it. `doc` is the TipTap document and comes from the editor; `body` is the
 * textarea's plain text and is what the server-rendered field posts before the
 * editor has taken over. Exactly one is ever present, because the editor removes
 * the textarea when it mounts — `doc` wins anyway, since the richer of the two
 * is never the one to discard.
 *
 * Neither path trusts the browser. `parseDocument` rebuilds the document from
 * the allowed vocabulary rather than approving what arrived — media nodes
 * included, which keep only paths in `context.owner`'s own folder — and `toBody`
 * constructs the document itself out of text.
 *
 * ---------------------------------------------------------------------------
 * THE TEXTAREA AND AN ENTRY WITH PHOTOS
 * ---------------------------------------------------------------------------
 * The textarea holds text and nothing else, so `toBody` of what it posts is a
 * document with no photos in it. Saving that over an entry that has photos would
 * delete them without a word — and their files would then be unreferenced, and
 * cleared from Storage for good by the cleanup job.
 *
 * So when the stored body holds media, the textarea never replaces it. The edit
 * page renders the textarea read-only in that case and says why; this is the
 * rule behind that, for a submit that arrives anyway. If the text is what the
 * stored body already reads as, the stored body is kept exactly as it is and
 * the title and date save normally. If the text was changed, the submit is
 * refused with `TEXTAREA_KEEPS_MEDIA` rather than silently dropping either the
 * edit or the photos.
 *
 * Whether blank is allowed is the caller's rule, not this function's; so is
 * everything about the title and date.
 */
export function submittedBody(doc: string | null, body: string, context: BodyContext): BodyResult {
	if (doc === null) {
		const stored = context.stored;
		if (stored !== undefined && hasMedia(stored)) {
			return normalisedText(body) === normalisedText(toPlainText(stored))
				? { ok: true, content: stored }
				: { ok: false, message: TEXTAREA_KEEPS_MEDIA };
		}
		return { ok: true, content: toBody(body) };
	}

	const content = parseDocument(doc, context);
	if (content === null) {
		return { ok: false, message: UNREADABLE_BODY };
	}

	// The per-entry cap, on what survived the sanitiser. The editor stops
	// offering uploads at the cap, but a paste can carry photos past it, and a
	// client that is not the editor can send anything.
	const count = countMedia(content);
	if (count > MAX_MEDIA_PER_ENTRY) {
		return { ok: false, message: tooManyMessage(count) };
	}

	return { ok: true, content };
}

/** What renaming from the list can say went wrong. */
export type RenameErrors = {
	title?: string;
	/** Not attributable to the field. */
	form?: string;
};

export type TitleResult = { ok: true; title: string | null } | { ok: false; message: string };

/**
 * A title as typed, as the column value — or why it cannot be one.
 *
 * Shared by the editor's saves and by renaming from the list, so the two cannot
 * disagree about what a title is. Trimmed first, and the limit counts what is
 * left. Blank is not an error: `entries.title` is nullable, an entry without
 * one is shown as "Untitled", and blank is stored as `null` rather than `''` so
 * "no title" is one value in the column instead of two.
 */
export function validateTitle(raw: string): TitleResult {
	const title = raw.trim();
	if (title.length > MAX_TITLE) {
		return { ok: false, message: `Keep the title to ${MAX_TITLE} characters or fewer.` };
	}
	return { ok: true, title: title.length > 0 ? title : null };
}

/** Turns what a browser sent into the columns to write, or the reasons not to. */
export function validateEntryEdit(input: EntryEditInput): EntryEditResult {
	const titled = validateTitle(input.title);
	const entryDate = input.entryDate.trim();
	const errors: EntryEditErrors = {};

	if (!titled.ok) {
		errors.title = titled.message;
	}

	const submitted = submittedBody(input.doc, input.body, {
		owner: input.owner,
		stored: input.stored
	});
	const content = submitted.ok ? submitted.content : null;
	if (!submitted.ok) {
		errors.body = submitted.message;
	}

	/*
	 * A blank body is refused, and under autosave that matters more than it used
	 * to rather than less.
	 *
	 * The tempting reading is that autosave should save whatever is there,
	 * including nothing. But the entry row is the only copy — there is no draft
	 * store and no history — so saving an empty document is the one write in this
	 * app that destroys something and cannot be undone after a reload. Somebody
	 * who selects all and deletes, meaning to retype, would have a second to
	 * change their mind before autosave made it permanent.
	 *
	 * So the rule from the manual-save days stays: an empty body does not save,
	 * and the editor says so. What was already stored is still stored, the words
	 * on screen are still on screen, and typing anything clears it.
	 */
	if (content !== null && isBlank(content)) {
		errors.body = 'Write something before this can save.';
	}

	// Unlike the new-entry form, an empty date is an error rather than a fallback
	// to today. The entry already has a date; blanking the field is not a request
	// to reset it to now, and silently doing that would move an entry somebody
	// wrote about last month.
	if (!DATE_ONLY.test(entryDate)) {
		errors.entryDate = 'Give the date as a real day.';
	}

	if (content === null || !titled.ok || Object.keys(errors).length > 0) {
		return { ok: false, errors };
	}

	return {
		ok: true,
		patch: {
			title: titled.title,
			content,
			entry_date: entryDate
		}
	};
}

/** The first message in a fixed order, so one failure reads as one sentence. */
export function firstError(errors: EntryEditErrors): string {
	return errors.body ?? errors.entryDate ?? errors.title ?? 'Could not save.';
}
