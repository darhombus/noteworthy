<script lang="ts">
	/**
	 * The six sidebar icons, inline for the same reasons as JournalIcon: six
	 * shapes do not justify a dependency, and `currentColor` lets the active and
	 * disabled states colour them without either knowing about the other.
	 */
	import type { NavIconName } from '$lib/nav/items';

	let { name, class: className = 'h-5 w-5' }: { name: NavIconName; class?: string } = $props();

	const PATHS: Record<NavIconName, string[]> = {
		dashboard: ['M4 4h7v7H4V4Z', 'M13 4h7v4h-7V4Z', 'M13 10h7v10h-7V10Z', 'M4 13h7v7H4v-7Z'],
		journals: [
			'M4 19.5A2.5 2.5 0 0 1 6.5 17H20',
			'M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z'
		],
		analytics: ['M4 20V10', 'M10 20V4', 'M16 20v-7', 'M22 20H2'],
		tags: [
			'M12.6 2.7 21 11a2 2 0 0 1 0 2.8l-6.2 6.2a2 2 0 0 1-2.8 0L3.7 11.7A2 2 0 0 1 3 10.3V4a1 1 0 0 1 1-1h6.3a2 2 0 0 1 1.4.6Z',
			'M7.5 7.5h.01'
		],
		bin: [
			'M3 6h18',
			'M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2',
			'M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6',
			'M10 11v6',
			'M14 11v6'
		],
		settings: [
			'M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z',
			'M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 9 19.4a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 4.6 9a1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1Z'
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
	{#each PATHS[name] as d (d)}
		<path {d} />
	{/each}
</svg>
