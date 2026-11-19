/**
 * A card that opens on a tap anywhere, built so that it can also hold a menu:
 * journal cards, entry cards, and the search page's entry results.
 *
 * A link wrapping buttons is invalid markup that browsers resolve however they
 * like, so the card is not one `<a>`. The link is the card's title, and its
 * `::after` is stretched over the whole card (`CARD`'s `relative` is what it
 * is measured against). A tap on the description, the counts, the icon or the
 * space between them lands on that `::after`, which belongs to the `<a>`: it is
 * a real link press, so the browser's own Ctrl+click, middle click and
 * no-script navigation work, and so does SvelteKit's `touchstart` preload.
 * The accessibility tree still has one link, named by the title alone.
 *
 * A menu goes after the link in the markup and is positioned (`ActionMenu`'s
 * wrapper is `relative`), which paints it, and lets it be clicked, above the
 * cover with no `z-index`. Neither the card nor the cover may take one: a
 * `z-index` on the card makes each card a stacking context, and an open menu
 * would then be painted under the next card; one on the cover puts it over the
 * menu button, and a tap on the button opens the card instead.
 *
 * Focus is drawn on the cover, so the ring goes round the card rather than
 * round the title's text (which a `truncate` title would also clip). Hover is
 * the card's border, keyed on the link being hovered: over the menu button the
 * link is not, so the border stays put.
 *
 * Written out in full for Tailwind's scanner: see the note at the top of
 * `$lib/journals/appearance`.
 */

/** The card's box. Its `relative` is what the link's cover fills. */
export const CARD =
	'relative rounded-xl border border-[#E0E0E0] bg-white p-5 shadow-sm has-[a:hover]:border-[#1976D2] dark:border-[#3A3A3A] dark:bg-[#1E1E1E] dark:has-[a:hover]:border-[#1976D2]';

/** The title's link, stretched over the card. */
export const CARD_LINK =
	'after:absolute after:inset-0 after:rounded-xl focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-[#1976D2]/40';
