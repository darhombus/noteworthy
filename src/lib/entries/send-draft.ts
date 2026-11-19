/**
 * The request an entry page's autosave makes, and the revision it carries.
 *
 * `postDraft` is one POST to the autosave endpoint, and names the failure if
 * it fails. `draftSender` is what both entry pages hand the autosave
 * controller: it sends each draft with the revision the page's text was made
 * from, a fresh save id and the page's unanswered saves (`./revision`), adopts
 * each answer's revision, and holds once the entry has changed somewhere else
 * (until a choice in the conflict modal, `./conflict.svelte`) or for good once
 * it has gone to the Recycle Bin. `$lib/data/entries`, SAVES, has the rule the
 * server applies.
 */
import { SaveFailed } from './autosave';
import type { SaveTracker } from './revision';

/** Behind the conflict modal, in the toolbar's status, until a choice is made. */
export const STALE_MESSAGE = 'this entry changed somewhere else.';
export const DELETED_MESSAGE = 'this entry is in the Recycle Bin.';

/** A save refused because the entry changed somewhere else; `revision` is the entry's now. */
export class StaleSave extends SaveFailed {
	readonly revision: number;

	constructor(revision: number) {
		super('stale', STALE_MESSAGE);
		this.name = 'StaleSave';
		this.revision = revision;
	}
}

/** How long a save may take, answer and all, before it counts as failed. */
export const SAVE_LIMIT_MS = 15_000;

/** The endpoint's JSON, read with care: any field may be missing. */
type Answer = { message?: unknown; revision?: unknown; reason?: unknown };

/**
 * Posts one draft to an autosave endpoint, and returns the entry's revision
 * after it, or names the failure if it fails.
 *
 * Every branch throws `SaveFailed` with a kind, because the cases are
 * different things to tell somebody and only one of them is "try again".
 * `response.redirected` is checked as well as the status: the hook answers 401
 * for this route rather than bouncing to `/login`, but if that rule is ever
 * edited away a followed redirect would arrive here as a perfectly ordinary 200
 * holding the login page — and reporting that as a save is how an entry
 * silently stops being written.
 *
 * A request not answered, body and all, within `SAVE_LIMIT_MS` is aborted and
 * fails as a dropped connection does, with the same words and Try again.
 * Before the limit a request sent and never answered left "Saving…" on screen
 * for good, with every later save queued behind it. Giving up is safe because
 * the server may still apply it: `draftSender` names it in the next save as
 * one of this page's own, and the server refuses it if it lands after a newer
 * one. The timer is a `setTimeout`, not `AbortSignal.timeout`, so a test's
 * fake clock reaches it.
 */
export async function postDraft(url: string, body: unknown): Promise<{ revision: number }> {
	const abort = new AbortController();
	const limit = setTimeout(() => abort.abort(), SAVE_LIMIT_MS);
	try {
		return await answerOf(
			await fetch(url, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body),
				signal: abort.signal
			})
		);
	} catch (thrown) {
		if (thrown instanceof SaveFailed) {
			throw thrown;
		}
		throw new SaveFailed('offline', 'check your connection.');
	} finally {
		clearTimeout(limit);
	}
}

/** What the endpoint's answer says, read while the time limit still runs. */
async function answerOf(response: Response): Promise<{ revision: number }> {
	if (response.status === 401 || response.redirected) {
		throw new SaveFailed('signed-out', 'you have been signed out.');
	}

	let answer: Answer | null;
	try {
		answer = (await response.json()) as Answer;
	} catch (thrown) {
		// Cut off by the limit: as unanswered as a request that never came back.
		if (thrown instanceof DOMException && thrown.name === 'AbortError') {
			throw thrown;
		}
		answer = null;
	}

	if (response.ok) {
		if (typeof answer?.revision === 'number') {
			return { revision: answer.revision };
		}
		throw new SaveFailed('server', 'something went wrong.');
	}

	if (response.status === 409 && answer?.reason === 'stale') {
		throw new StaleSave(typeof answer.revision === 'number' ? answer.revision : 0);
	}
	if (response.status === 410) {
		throw new SaveFailed('deleted', DELETED_MESSAGE);
	}

	const message =
		typeof answer?.message === 'string' && answer.message.length > 0
			? answer.message
			: 'something went wrong.';
	throw new SaveFailed(response.status === 400 && answer !== null ? 'invalid' : 'server', message);
}

export type DraftSender = {
	/** The save function for the controller. */
	send: (draft: object, options?: { create?: boolean }) => Promise<void>;
	/** Saving goes on after a stale refusal: a choice was made, and the tracker holds its revision. */
	resume: () => void;
};

export type DraftSenderHooks = {
	/** A save was applied: the entry is at `revision`, written by `saveId`. */
	saved?: (revision: number, saveId: string) => void;
	/** A save was refused as stale; the entry is at `revision`. */
	stale?: (revision: number) => void;
};

/**
 * What a page hands its autosave controller, sending each draft to `url()`
 * with the tracker's revision.
 *
 * `create` says the entry does not exist yet (the new-entry page, until a
 * create has answered); a create names no revision, and its unanswered saves
 * are its own earlier creates. Once a save is refused as stale, every later
 * call throws the same failure without a request until `resume`; once deleted,
 * for good. The text stays in the editor either way.
 */
export function draftSender(
	tracker: SaveTracker,
	url: () => string,
	hooks: DraftSenderHooks = {}
): DraftSender {
	let ended: SaveFailed | null = null;

	return {
		send: async (draft, options = {}) => {
			if (ended !== null) {
				throw ended;
			}
			const { saveId, unanswered } = tracker.next();
			const body =
				options.create === true
					? { ...draft, create: true, saveId, unanswered }
					: { ...draft, revision: tracker.revision, saveId, unanswered };
			let revision: number;
			try {
				({ revision } = await postDraft(url(), body));
			} catch (thrown) {
				// Whatever went wrong, this save may have been applied: a request that
				// threw can have reached the server. The next save says so.
				tracker.unanswered(saveId);
				if (
					thrown instanceof SaveFailed &&
					(thrown.kind === 'stale' || thrown.kind === 'deleted')
				) {
					ended = thrown;
				}
				if (thrown instanceof StaleSave) {
					hooks.stale?.(thrown.revision);
				}
				throw thrown;
			}
			tracker.saved(revision);
			hooks.saved?.(revision, saveId);
		},
		resume: () => {
			if (ended?.kind === 'stale') {
				ended = null;
			}
		}
	};
}
