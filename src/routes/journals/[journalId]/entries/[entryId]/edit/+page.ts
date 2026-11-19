import { received } from '$lib/media/page-links';
import type { PageLoad } from './$types';

/**
 * The server's data as it is, with the moment its media links arrived (`received`):
 * on a tap they follow the text in the same response, and are stamped when they land.
 */
export const load: PageLoad = ({ data }) => ({ ...data, media: received(data.media) });
