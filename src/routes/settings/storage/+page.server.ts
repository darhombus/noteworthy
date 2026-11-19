import { resolve } from '$app/paths';
import { mediaBreakdown } from '$lib/media/page.server';
import type { Crumb } from '$lib/nav/breadcrumbs';
import type { PageServerLoad } from './$types';

/**
 * The caller's usage, worked out in the database by `media_breakdown()`: one
 * call, one row. `null` when it could not be read, and the page says so rather
 * than failing — there is nothing else here, but a 500 would say far less.
 */
export const load: PageServerLoad = async ({ locals }) => {
	return {
		usage: await mediaBreakdown(locals.supabase),
		breadcrumbs: [
			{ label: 'Settings', href: resolve('/settings') },
			{ label: 'Storage' }
		] satisfies Crumb[]
	};
};
