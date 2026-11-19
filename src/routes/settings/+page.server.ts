import { redirect } from '@sveltejs/kit';
import { resolve } from '$app/paths';
import type { PageServerLoad } from './$types';

/**
 * Settings has one part so far, Storage, and this is its front door until
 * there are more. The sidebar links to Storage directly; this is for the
 * breadcrumb and for anybody who types the address.
 */
export const load: PageServerLoad = () => {
	redirect(307, resolve('/settings/storage'));
};
