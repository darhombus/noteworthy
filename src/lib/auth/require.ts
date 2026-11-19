import { error } from '@sveltejs/kit';
import type { AuthUser } from './types';

/**
 * The verified user, on a route the hook has already guarded.
 *
 * The hook redirects an anonymous request to /login before any load or action
 * runs, so the throw is unreachable. It exists because `locals.user` is typed
 * nullable and the alternative is a non-null assertion that would hide a real
 * regression if the guard were ever narrowed. The same reasoning, and the same
 * function, as the one in `routes/journals/+page.server.ts`.
 */
export function requireUser(user: App.Locals['user']): AuthUser {
	if (!user) {
		error(401, 'Not signed in.');
	}
	return user;
}
