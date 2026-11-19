/**
 * The journal palette and icon set, and the one place a stored key becomes
 * something you can see.
 *
 * `journals.color` and `journals.icon` hold keys — 'blue', 'book' — never hex
 * values and never class names. The database's job is to remember which one was
 * chosen; deciding what blue looks like is this file's, and changing it here
 * changes it everywhere without a migration.
 *
 * ---------------------------------------------------------------------------
 * WHY THE CLASS STRINGS ARE WRITTEN OUT IN FULL
 * ---------------------------------------------------------------------------
 * Tailwind 4 finds classes by scanning source text. It does not evaluate
 * anything, so a class assembled at runtime — `bg-[${hex}]` — is a class
 * Tailwind never sees and never emits, and the element renders unstyled with no
 * error anywhere. Every string below is therefore complete and literal, which
 * is also why the same hex appears more than once instead of being factored out
 * into a constant.
 *
 * ---------------------------------------------------------------------------
 * UNKNOWN KEYS FALL BACK
 * ---------------------------------------------------------------------------
 * `toColor` and `toIcon` map anything unrecognised onto the default rather than
 * throwing. A row written before the palette changed, or by a script, is a
 * journal somebody still owns: showing it in blue is right, and failing a whole
 * list render over a spelling is not.
 */

export const JOURNAL_COLORS = [
	'blue',
	'green',
	'purple',
	'orange',
	'teal',
	'red',
	'indigo',
	'amber'
] as const;

export type JournalColor = (typeof JOURNAL_COLORS)[number];

export const JOURNAL_ICONS = [
	'book',
	'notebook',
	'pen',
	'sparkles',
	'leaf',
	'heart',
	'star',
	'compass'
] as const;

export type JournalIcon = (typeof JOURNAL_ICONS)[number];

/** Matches the column defaults in the database, so a row and a fresh form agree. */
export const DEFAULT_COLOR: JournalColor = 'blue';
export const DEFAULT_ICON: JournalIcon = 'book';

type ColorStyle = {
	label: string;
	/** A solid disc of the colour, for the picker. */
	swatch: string;
	/** The tinted tile the icon sits on, light and dark. */
	tile: string;
};

export const COLOR_STYLES: Record<JournalColor, ColorStyle> = {
	blue: {
		label: 'Blue',
		swatch: 'bg-[#1976D2]',
		tile: 'bg-[#E3F2FD] text-[#1565C0] dark:bg-[#12314B] dark:text-[#90CAF9]'
	},
	green: {
		label: 'Green',
		swatch: 'bg-[#2E7D32]',
		tile: 'bg-[#E8F5E9] text-[#2E7D32] dark:bg-[#17331C] dark:text-[#A5D6A7]'
	},
	purple: {
		label: 'Purple',
		swatch: 'bg-[#6A1B9A]',
		tile: 'bg-[#F3E5F5] text-[#6A1B9A] dark:bg-[#2C1638] dark:text-[#CE93D8]'
	},
	orange: {
		label: 'Orange',
		swatch: 'bg-[#E65100]',
		tile: 'bg-[#FBE9E7] text-[#E65100] dark:bg-[#3A1D08] dark:text-[#FFAB91]'
	},
	teal: {
		label: 'Teal',
		swatch: 'bg-[#00695C]',
		tile: 'bg-[#E0F2F1] text-[#00695C] dark:bg-[#0D2E2A] dark:text-[#80CBC4]'
	},
	red: {
		label: 'Red',
		swatch: 'bg-[#C62828]',
		tile: 'bg-[#FFEBEE] text-[#C62828] dark:bg-[#3A1517] dark:text-[#EF9A9A]'
	},
	indigo: {
		label: 'Indigo',
		swatch: 'bg-[#283593]',
		tile: 'bg-[#E8EAF6] text-[#283593] dark:bg-[#181C3A] dark:text-[#9FA8DA]'
	},
	amber: {
		label: 'Amber',
		swatch: 'bg-[#F57F17]',
		tile: 'bg-[#FFFDE7] text-[#946100] dark:bg-[#33280A] dark:text-[#FFE082]'
	}
};

export const ICON_LABELS: Record<JournalIcon, string> = {
	book: 'Book',
	notebook: 'Notebook',
	pen: 'Pen',
	sparkles: 'Sparkles',
	leaf: 'Leaf',
	heart: 'Heart',
	star: 'Star',
	compass: 'Compass'
};

export function isJournalColor(value: string): value is JournalColor {
	return (JOURNAL_COLORS as readonly string[]).includes(value);
}

export function isJournalIcon(value: string): value is JournalIcon {
	return (JOURNAL_ICONS as readonly string[]).includes(value);
}

/** A stored colour, or the default if it is not one this app knows about. */
export function toColor(value: string): JournalColor {
	return isJournalColor(value) ? value : DEFAULT_COLOR;
}

/** A stored icon, or the default if it is not one this app knows about. */
export function toIcon(value: string): JournalIcon {
	return isJournalIcon(value) ? value : DEFAULT_ICON;
}
