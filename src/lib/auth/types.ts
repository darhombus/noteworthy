/**
 * The verified identity for a request.
 *
 * This is derived from JWT claims rather than a Supabase `User`, because
 * identity is established with `getClaims()` — verified locally against the
 * cached JWKS — and never with a round trip to the auth server.
 *
 * Deliberately narrow: the app shell needs an id and something to display, and
 * anything wider invites a route to read a claim it should be reading from the
 * database instead.
 */
export type AuthUser = {
	id: string;
	email: string | null;
};
