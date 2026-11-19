import type { SupabaseClient } from '@supabase/supabase-js';
import type { AuthUser } from './types';
import type { Database } from '$lib/types/database';

/**
 * Resolves a request's identity from its cookies.
 *
 * `getClaims()` verifies the access token locally with WebCrypto against the
 * cached JWKS, because the project signs with ES256 — no round trip to
 * /auth/v1/user, on this or any other request.
 *
 * Anything unverifiable is anonymous rather than an error: a tampered
 * signature, an expired token and an absent cookie all arrive here as `null`
 * and the request continues as a signed-out one. The tradeoff is deliberate —
 * a transient failure to reach the JWKS endpoint also reads as signed out, so
 * an auth outage logs people out instead of returning 500s.
 *
 * It takes the client rather than the event so that it can be exercised against
 * a client pointed at the local stack, which is what `tests/auth` does. The hook
 * is the only caller in the app.
 */
export async function verifiedUser(supabase: SupabaseClient<Database>): Promise<AuthUser | null> {
	return (await verifiedSession(supabase))?.user ?? null;
}

/**
 * The verified identity, and the two claims the session's limit is decided
 * from (`$lib/auth/session-limit`): its `session_id` (`''` if a token ever
 * came without one, which then matches no recorded choice) and its `amr`.
 */
export type VerifiedSession = { user: AuthUser; id: string; amr: unknown };

export async function verifiedSession(
	supabase: SupabaseClient<Database>
): Promise<VerifiedSession | null> {
	try {
		const { data, error } = await supabase.auth.getClaims();

		if (error || !data) {
			return null;
		}

		const { claims } = data;
		return {
			user: { id: claims.sub, email: claims.email ?? null },
			id: typeof claims.session_id === 'string' ? claims.session_id : '',
			amr: claims.amr
		};
	} catch {
		return null;
	}
}
