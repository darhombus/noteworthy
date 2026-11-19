<script lang="ts" module>
	/**
	 * The toolbar's twelve shapes, inline for the same reason as `NavIcon` and
	 * `JournalIcon`: a handful of paths does not justify a dependency, and
	 * `currentColor` lets the pressed, idle and unavailable states colour them
	 * without any of the three knowing about the others.
	 *
	 * Drawn as strokes on the same 24-unit grid and at the same weight as the
	 * other two icon sets, including `bold`, `italic`, `strikethrough`, `h1` and
	 * `h2` — which are letterforms and could just as easily have been text. Text
	 * would have been less code and would have looked it: a bold "B" beside a
	 * stroked list icon is two different drawings of the same size, and the eye
	 * reads the row as two rows.
	 *
	 * The type and the table live in `module` rather than in the instance script:
	 * a type has to be there to be importable by name at all, and one copy of the
	 * paths for the whole app beats one per rendered icon.
	 */
	export type ToolbarIconName =
		| 'undo'
		| 'redo'
		| 'h1'
		| 'h2'
		| 'bold'
		| 'italic'
		| 'strikethrough'
		| 'highlight'
		| 'bulletList'
		| 'orderedList'
		| 'blockquote'
		| 'link'
		| 'addMedia'
		| 'collapseAll'
		| 'expandAll';

	const PATHS: Record<ToolbarIconName, string[]> = {
		undo: ['M9 14 4 9l5-5', 'M4 9h10.5a5.5 5.5 0 0 1 0 11H11'],
		redo: ['m15 14 5-5-5-5', 'M20 9H9.5a5.5 5.5 0 0 0 0 11H13'],
		// The shared "H" plus a numeral: a stroked 1, and a 2 whose diagonal and
		// base are one path.
		h1: ['M4 12h8', 'M4 18V6', 'M12 18V6', 'm17 12 3-2v8'],
		h2: ['M4 12h8', 'M4 18V6', 'M12 18V6', 'M21 18h-4c0-4 4-3 4-6 0-1.5-2-2.5-4-1'],
		bold: ['M6 12h9a4 4 0 0 1 0 8H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h7a4 4 0 0 1 0 8'],
		italic: ['M19 4h-9', 'M14 20H5', 'm15 4-6 16'],
		strikethrough: ['M16 4H9a3 3 0 0 0-2.83 4', 'M14 12a4 4 0 0 1 0 8H6', 'M4 12h16'],
		highlight: [
			'm9 11-6 6v3h9l3-3',
			'm22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4'
		],
		bulletList: ['M8 6h13', 'M8 12h13', 'M8 18h13', 'M3 6h.01', 'M3 12h.01', 'M3 18h.01'],
		orderedList: [
			'M10 6h11',
			'M10 12h11',
			'M10 18h11',
			'M4 6h1v4',
			'M4 10h2',
			'M6 18H4c0-1 2-2 2-3s-1-1.5-2-1'
		],
		// A rule down the left with the text indented beside it — which is what a
		// blockquote actually looks like once it is rendered, and what tells this
		// apart from the two list icons next to it. The obvious alternative,
		// stacked lines with a short bar, put three lines-with-something-at-the-left
		// icons in a row and they read as one repeated shape at 16px.
		blockquote: ['M5 5v14', 'M10 7h10', 'M10 12h10', 'M10 17h6'],
		link: [
			'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71',
			'M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71'
		],
		// A picture frame with a hill and a sun, and a plus in the corner: the
		// picture says what goes in, the plus says this one adds rather than
		// formats. Drawn like the rest, so it does not read as a different set.
		addMedia: [
			'M4 5h11a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1',
			'm3 15 4-4 5 4',
			'M11.5 9.5h.01',
			'M19 4v6',
			'M22 7h-6'
		],
		// Two chevrons meeting, and two parting: the row closing up, and opening.
		collapseAll: ['m7 20 5-5 5 5', 'm7 4 5 5 5-5'],
		expandAll: ['m7 15 5 5 5-5', 'm7 9 5-5 5 5']
	};
</script>

<script lang="ts">
	let { name, class: className = 'h-4 w-4' }: { name: ToolbarIconName; class?: string } = $props();
</script>

<svg
	class={className}
	viewBox="0 0 24 24"
	fill="none"
	stroke="currentColor"
	stroke-width="1.75"
	stroke-linecap="round"
	stroke-linejoin="round"
	aria-hidden="true"
>
	{#each PATHS[name] as d (d)}
		<path {d} />
	{/each}
</svg>
