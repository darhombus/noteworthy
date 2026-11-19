/**
 * What the save status shows, worked out from the controller's snapshots.
 *
 * A display rule and nothing else. `./autosave` decides when to save, what to
 * send and when to try again; this only decides how that looks, and it changes
 * none of it — it reads the same snapshots the controller has always reported,
 * in the order it reports them.
 *
 * ---------------------------------------------------------------------------
 * A FAILURE STAYS UNTIL SOMETHING SUCCEEDS
 * ---------------------------------------------------------------------------
 * The controller's own state leaves a failure the moment anything happens next.
 * Typing after a failed save is `pending`, the retry that follows is `saving`,
 * and shown as they are, the status went from the failure back to "Saving…"
 * and then to the failure again on every retry. In the pinned toolbar row that
 * meant the row shrinking and growing under somebody's typing — and it meant a
 * new alert, announced again, each time a retry failed, when nothing new had
 * gone wrong.
 *
 * So once a save has failed, the failure is what shows until a save succeeds.
 * A retry on the wire shows inside it, as `retrying`, rather than replacing it.
 *
 * ---------------------------------------------------------------------------
 * TELLING A SUCCESS FROM A KEYSTROKE
 * ---------------------------------------------------------------------------
 * The snapshots do not say "that save worked", so it is read off the order they
 * come in, which is why this is a reducer over the sequence and not a function
 * of the latest snapshot alone:
 *
 *   `saving` then `saved` or `pending`  — the request came back fine. `pending`
 *                                         means more was typed while it was
 *                                         out; still a success.
 *   `failed` then `pending`             — typed again after the failure. Not a
 *                                         success; the failure stays.
 *   `saving` then `failed`              — the retry failed too. The failure
 *                                         stays, with whatever message it now
 *                                         carries.
 *   anything then `saved`               — nothing is outstanding any more, so
 *                                         there is no failure left to report.
 *                                         Besides a success, that is an edit
 *                                         undone back to what is stored, or the
 *                                         new-entry page emptying the body before
 *                                         the entry exists.
 *
 * The controller only reports `pending` straight after `saving` when a save has
 * just landed: a change made while a save is in flight announces nothing (see
 * `change` in `./autosave`), which is what makes the first rule sound.
 */
import type { AutosaveSnapshot, FailureKind, SaveState } from './autosave';

export type SaveDisplay =
	| { kind: 'saved' }
	/** Waiting on the debounce or on the network — one look for both, as ever. */
	| { kind: 'saving' }
	| {
			kind: 'failed';
			failure: FailureKind;
			message: string;
			/** A save is on the wire since the failure: a retry, or a newer edit. */
			retrying: boolean;
	  };

/** The display, plus the controller state it was last given — the rules need it. */
export type SaveDisplayState = { display: SaveDisplay; last: SaveState };

export const INITIAL_SAVE_DISPLAY: SaveDisplayState = {
	display: { kind: 'saved' },
	last: 'saved'
};

/** The message the controller gives any failure it cannot name, used if one arrives bare. */
const UNNAMED_FAILURE = 'Could not save. Try again.';

export function nextSaveDisplay(
	current: SaveDisplayState,
	snapshot: AutosaveSnapshot
): SaveDisplayState {
	const last = snapshot.state;

	if (snapshot.state === 'failed') {
		return {
			last,
			display: {
				kind: 'failed',
				failure: snapshot.failure ?? 'server',
				message: snapshot.message ?? UNNAMED_FAILURE,
				retrying: false
			}
		};
	}

	if (current.display.kind === 'failed') {
		const succeeded = current.last === 'saving';
		if (!succeeded && snapshot.state !== 'saved') {
			return {
				last,
				display: { ...current.display, retrying: snapshot.state === 'saving' }
			};
		}
	}

	return {
		last,
		display: snapshot.state === 'saved' ? { kind: 'saved' } : { kind: 'saving' }
	};
}
