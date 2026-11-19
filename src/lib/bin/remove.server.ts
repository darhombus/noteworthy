/**
 * The second half of deleting for good: removing the files.
 *
 * ---------------------------------------------------------------------------
 * ROWS FIRST, THEN FILES
 * ---------------------------------------------------------------------------
 * By the time this runs, the database function has removed the rows and
 * returned the paths nothing names any more. The entries' delete trigger
 * released every one of them in that same transaction, so each is already a
 * waiting file: if this step fails, or never runs, the file shows under
 * Waiting to be cleared and `remove-unused-media` takes it later. The other
 * order could leave an entry that can be restored with its files gone.
 *
 * ---------------------------------------------------------------------------
 * HOW
 * ---------------------------------------------------------------------------
 * Through Storage's API with the person's own session, never a service key:
 * the owner's own-folder DELETE policy decides what may go, and
 * `storage.objects` refuses a direct DELETE anyway. In batches of 1,000, the
 * most one request may name, as the nightly job sends them. A path outside the
 * person's folder is dropped before sending; the functions never return one,
 * and this does not rely on it.
 *
 * ---------------------------------------------------------------------------
 * WHAT COUNTS AS LEFT
 * ---------------------------------------------------------------------------
 * Storage answers with the objects it removed. A name missing from that answer
 * is either already gone (a second tab got there first, which is fine) or was
 * not removed (a refusal comes back as a 200 that leaves the name out, the same
 * as "not there"). A batch that errors or throws may have removed some, all or
 * none of its names. So nothing unconfirmed is guessed at: if any path is, the
 * waiting list is read once, and what is still on it is what was left. When
 * even that read fails, every unconfirmed path is counted as left, since saying
 * "some files will be cleared later" about files that are gone costs less than
 * saying nothing about files that are not.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { listWaitingFiles } from '$lib/data/bin';
import { MEDIA_BUCKET } from '$lib/media/paths';
import type { Database } from '$lib/types/database';

/** The most names Storage takes in one delete request. */
export const REMOVE_BATCH = 1000;

/** What happened to the files: how many were asked for, and which are still waiting. */
export type FilesRemoved = { requested: number; left: string[] };

export async function removeFiles(
	supabase: SupabaseClient<Database>,
	userId: string,
	paths: readonly string[]
): Promise<FilesRemoved> {
	const folder = `${userId}/`;
	const own = [...new Set(paths)].filter((path) => path.startsWith(folder));
	const confirmed = new Set<string>();

	for (let start = 0; start < own.length; start += REMOVE_BATCH) {
		const batch = own.slice(start, start + REMOVE_BATCH);
		try {
			const { data, error } = await supabase.storage.from(MEDIA_BUCKET).remove(batch);
			if (error !== null) {
				console.warn('bin: removing a batch of files failed', error);
				continue;
			}
			for (const object of data) {
				confirmed.add(object.name);
			}
		} catch (thrown) {
			console.warn('bin: removing a batch of files failed', thrown);
		}
	}

	const unconfirmed = own.filter((path) => !confirmed.has(path));
	if (unconfirmed.length === 0) {
		return { requested: own.length, left: [] };
	}

	try {
		const waiting = new Set((await listWaitingFiles(supabase)).map((file) => file.path));
		return { requested: own.length, left: unconfirmed.filter((path) => waiting.has(path)) };
	} catch (thrown) {
		console.warn('bin: reading what is still waiting failed', thrown);
		return { requested: own.length, left: unconfirmed };
	}
}
