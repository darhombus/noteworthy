import type { PostgrestError, PostgrestSingleResponse } from '@supabase/supabase-js';

/**
 * A query in `$lib/data` that the database refused.
 *
 * The layer throws rather than handing `{ data, error }` back to every caller.
 * A failed read in a load function has no partial answer worth rendering — it
 * is a 500 — and letting it bubble keeps the happy path free of a null check
 * after every call. A form action, which does have something better to do than
 * throw, catches this and returns `fail()` with wording only the call site
 * knows how to choose.
 *
 * `postgrest` is kept whole rather than flattened to a message: `code` is what
 * distinguishes a policy refusal (42501) from a constraint violation (23514),
 * and a caller that wants to tell them apart needs it.
 */
export class DataError extends Error {
	readonly operation: string;
	readonly postgrest: PostgrestError;

	constructor(operation: string, postgrest: PostgrestError) {
		super(`${operation}: ${postgrest.message}`);
		this.name = 'DataError';
		this.operation = operation;
		this.postgrest = postgrest;
	}
}

/**
 * Returns the rows, or throws `DataError` naming the operation that failed.
 *
 * `operation` is a short phrase for the log and the stack — "list journals",
 * not a user-facing sentence.
 *
 * Typed against PostgREST's own response union rather than a hand-written
 * `{ data, error }`: every shape a query can resolve to is that union with a
 * different argument — `T[]` for a list, `T` after `single()`, `T | null` after
 * `maybeSingle()` — so one signature covers all three and each keeps the type
 * it actually has. A structural stand-in collapses the success and failure
 * halves and infers `T | null` everywhere instead.
 */
export function ok<T>(operation: string, result: PostgrestSingleResponse<T>): T {
	if (result.error !== null) {
		throw new DataError(operation, result.error);
	}
	return result.data;
}
