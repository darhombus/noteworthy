import { received } from '$lib/media/page-links';
import type { PageLoad } from './$types';

/** The server's data as it is, with the moment its thumbnails' links arrived (`received`). */
export const load: PageLoad = ({ data }) => ({ ...data, thumbnails: received(data.thumbnails) });
