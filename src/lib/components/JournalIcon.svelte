<script lang="ts">
	/**
	 * The eight journal icons, as inline SVG.
	 *
	 * Inline rather than an icon package: eight shapes do not justify a
	 * dependency, and inlining means they inherit `currentColor` from the tile
	 * they sit on, so a colour key styles the icon without either knowing about
	 * the other.
	 *
	 * `aria-hidden` throughout. The icon repeats the journal's identity, never
	 * adds to it — the title is always beside it, and in the picker each button
	 * carries its own label.
	 */
	import { type JournalIcon, toIcon } from '$lib/journals/appearance';

	let {
		icon,
		class: className = 'h-5 w-5'
	}: {
		/** A stored value, not necessarily a known key — it is resolved here. */
		icon: string;
		class?: string;
	} = $props();

	const PATHS: Record<JournalIcon, string[]> = {
		book: [
			'M4 19.5A2.5 2.5 0 0 1 6.5 17H20',
			'M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z'
		],
		notebook: [
			'M6 3h12a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6V3Z',
			'M6 3v18',
			'M3 7h3',
			'M3 12h3',
			'M3 17h3',
			'M10 8h6'
		],
		pen: ['M12 20h9', 'M16.5 3.5a2.12 2.12 0 0 1 3 3L7.5 18.5 3 20l1.5-4.5 12-12Z'],
		sparkles: [
			'M12 3.5 13.8 8.2 18.5 10 13.8 11.8 12 16.5 10.2 11.8 5.5 10 10.2 8.2 12 3.5Z',
			'M18.5 15.5 19.3 17.7 21.5 18.5 19.3 19.3 18.5 21.5 17.7 19.3 15.5 18.5 17.7 17.7 18.5 15.5Z'
		],
		leaf: [
			'M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.5 19 2c1 2 2 4.2 2 8 0 5.5-4.8 10-10 10Z',
			'M2 21c0-3 1.9-5.4 5.1-6'
		],
		heart: [
			'M19 14c1.5-1.5 3-3.2 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.8 0-3 .5-4.5 2-1.5-1.5-2.7-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4 3 5.5l7 7 7-7Z'
		],
		star: ['M12 2.5l2.9 5.9 6.6.9-4.8 4.6 1.2 6.5-5.9-3.1-5.9 3.1 1.2-6.5L2.5 9.3l6.6-.9L12 2.5Z'],
		compass: [
			'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z',
			'm16.2 7.8-2.1 6.4-6.3 2.1 2.1-6.4 6.3-2.1Z'
		]
	};
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
	{#each PATHS[toIcon(icon)] as d (d)}
		<path {d} />
	{/each}
</svg>
