// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '$lib/types/database';
import type { AuthUser } from '$lib/auth/types';
import type { Crumb } from '$lib/nav/breadcrumbs';
import type { Theme } from '$lib/theme/cookie';
import type { ServerTiming } from '$lib/server/timing';
import type { NewSession } from '$lib/supabase/server';
import type { NoticeName } from '$lib/toast/notices';

declare global {
	namespace App {
		// interface Error {}
		interface Locals {
			/** Request-scoped Supabase client. Created once per request in the hook. */
			supabase: SupabaseClient<Database>;
			/**
			 * The identity for this request, verified in `hooks.server.ts`, or `null`
			 * when the request is anonymous. Load functions and form actions read it
			 * from here; they never re-resolve it themselves.
			 */
			user: AuthUser | null;
			/**
			 * The choice for a session this request makes: the login and signup
			 * actions set it from "Remember me", `/auth/confirm` to `12h`,
			 * before calling the auth server. See `$lib/supabase/server`.
			 */
			newSession: NewSession;
			/**
			 * The colour scheme for this request, read from the `theme` cookie in
			 * `hooks.server.ts`. Always one of the three states — a missing or
			 * unrecognised cookie reads as `system` — so this is never absent.
			 */
			theme: Theme;
			/**
			 * This request's `Server-Timing`, made in `hooks.server.ts`. A load records
			 * a part of its own here (`measure`), and the hook puts it on the
			 * response. See `$lib/server/timing`.
			 */
			timing: ServerTiming;
		}
		interface PageData {
			/**
			 * The theme the server rendered this page with, put here by the root
			 * layout so `ThemeToggle` can show which of the three is on.
			 *
			 * Not optional, unlike `breadcrumbs` below: the root layout returns it on
			 * every route, signed in or out, so every page carries it.
			 */
			theme: Theme;
			/**
			 * The breadcrumb trail for this page, returned by its load function and
			 * read by the layout off `page.data`. Declared optional here because
			 * pages outside the shell — `/`, `/login`, `/signup` — have no trail,
			 * and the layout renders nothing when it is absent.
			 */
			breadcrumbs?: Crumb[];
			/**
			 * Drawn without the shell even for somebody signed in: the app's name and
			 * Log out only. Returned by `/reset-password` and `/auth/confirm`, and read
			 * by the root layout off `page.data`, so the root load reads nothing from
			 * the URL and is not re-run on every navigation. `shellUser` stays set, so
			 * the document still counts as drawn signed in (`$lib/auth/stale`).
			 */
			bare?: true;
			/**
			 * A notice the server set for this page (`nw-notice`), read and deleted
			 * by the page's own load, which returns its name here. The root layout
			 * draws it as a toast (`$lib/toast/notices`), in the server's HTML too.
			 */
			notice?: NoticeName | null;
		}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};
