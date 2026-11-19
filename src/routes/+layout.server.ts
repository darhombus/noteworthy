import { ALLOWANCE_BYTES } from '$lib/media/limits';
import { allowanceRemaining } from '$lib/media/page.server';
import { STORAGE_USAGE } from '$lib/media/usage';
import { TIMING_COOKIE, timingOn } from '$lib/timing/cookie';
import type { LayoutServerLoad } from './$types';

/**
 * The shell's name and avatar come from `profiles`, not from the JWT's
 * `user_metadata`.
 *
 * Both carry `full_name` — the signup trigger copies it into
 * `raw_user_meta_data`, so the claim is there for free and costs no query. It
 * is still the wrong source: nothing syncs the two. The moment someone edits
 * their name in settings, the claim keeps the old value until the token
 * refreshes, and the shell would show a name the database disagrees with.
 * `avatar_url` is not in the token at all, so the token could never be the only
 * source anyway.
 *
 * One query per render buys a value that is always current, and `getClaims()`
 * already saved the auth round trip that this spends.
 *
 * Named columns only. `privacy_pin_hash` and `vault_secret_hash` are revoked
 * from `authenticated`, so `select('*')` fails outright rather than quietly
 * returning the rest.
 *
 * ---------------------------------------------------------------------------
 * THE STORAGE BAR
 * ---------------------------------------------------------------------------
 * `storageUsed` is read from `media_allowance_remaining()` — the function the
 * upload check calls, and an index read of the person's own folder — rather
 * than from `media_breakdown()`, which also walks every entry body to sort
 * what is in the bin or waiting to be cleared. The bar needs only the total. Both run in parallel
 * with the profile, so the bar costs no extra round trip.
 *
 * This load reads nothing from the URL, so client-side navigation does not
 * re-run it. The figure changes when a file is stored or removed. The Recycle
 * Bin invalidates `STORAGE_USAGE` once it has deleted for good. The editor does
 * not: once its uploads finish it measures the figure itself, and the layout
 * shows that until this load next runs (`$lib/media/usage-measured.svelte`),
 * because a refresh that fails offline makes SvelteKit load the address as a
 * new document. Deleting an entry into the bin changes no total, and other form
 * actions re-run every load anyway.
 */
export const load: LayoutServerLoad = async ({ locals, depends, cookies }) => {
	// Returned on every branch below, signed in or out: the toggle is offered on
	// the bare pages too, and it reads this to show which option is on.
	const theme = locals.theme;
	// Whether this browser asked for the timing readout (`/timing`). The
	// readout's code is loaded only when it did; see `$lib/timing/readout`.
	const timing = timingOn(cookies.get(TIMING_COOKIE));

	if (!locals.user) {
		return { shellUser: null, theme, storageUsed: null, timing };
	}

	depends(STORAGE_USAGE);

	const fallbackName = locals.user.email ?? 'Your account';

	const [{ data, error }, remaining] = await Promise.all([
		locals.supabase
			.from('profiles')
			.select('full_name, avatar_url')
			.eq('user_id', locals.user.id)
			.single(),
		allowanceRemaining(locals.supabase)
	]);

	// `null` when it could not be read: the bar is left out rather than showing
	// a figure nobody measured.
	const storageUsed = remaining === null ? null : ALLOWANCE_BYTES - remaining;

	if (error) {
		// A verified identity with no readable profile row shouldn't happen — the
		// trigger writes it at signup. Show the email rather than blanking the
		// shell or failing the whole render over a display name.
		return { shellUser: { name: fallbackName, avatarUrl: null }, theme, storageUsed, timing };
	}

	return {
		theme,
		storageUsed,
		timing,
		shellUser: {
			// full_name is NOT NULL but can be '' — the trigger COALESCEs a missing
			// display name to the empty string rather than rejecting the signup.
			name: data.full_name.length > 0 ? data.full_name : fallbackName,
			avatarUrl: data.avatar_url
		}
	};
};
