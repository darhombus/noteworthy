const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Whether a route parameter could be a row id at all.
 *
 * Every id in this schema is a `uuid`, and PostgREST answers a filter on one
 * with a 400 and `22P02` — invalid input syntax — rather than an empty result.
 * That reaches the query layer as a thrown `DataError` and would render as a
 * 500, which is the wrong answer: `/journals/nonsense` is a page that does not
 * exist, not a server that broke. Checking the shape first turns it into a 404
 * and saves the round trip that would have failed.
 */
export function isUuid(value: string): boolean {
	return UUID.test(value);
}
