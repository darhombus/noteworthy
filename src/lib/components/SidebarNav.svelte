<script lang="ts">
	/**
	 * The navigation itself, without deciding where it sits.
	 *
	 * Rendered twice by the layout — once in the fixed sidebar for wide screens
	 * and once inside the panel that replaces it on narrow ones (`NavPanel`).
	 * Only one is ever displayed, because the other's container is
	 * `display: none`, which also keeps it out of the accessibility tree rather
	 * than leaving a second invisible copy of every link for a screen reader to
	 * read out.
	 */
	import { page } from '$app/state';
	import NavIcon from './NavIcon.svelte';
	import StorageBar from './StorageBar.svelte';
	import ThemeToggle from './ThemeToggle.svelte';
	import { isCurrent, NAV_ITEMS } from '$lib/nav/items';

	let {
		user,
		storageUsed
	}: {
		user: { name: string; avatarUrl: string | null };
		/** Bytes in the person's folder, or `null` if they could not be read. */
		storageUsed: number | null;
	} = $props();
</script>

<!--
	`min-h-0 overflow-y-auto` on the nav, so that a sidebar too short for its own
	contents scrolls the links and keeps the footer — theme and account — where it
	is. Without `min-h-0` the overflow never engages: a flex item's `min-height` is
	`auto`, which refuses to shrink below its content, so the box grows and pushes
	the footer out of the window instead.

	The narrow panel is the window's height too, so the same holds there: on a
	short screen, a phone on its side, the links scroll and the footer stays.
-->
<div class="flex h-full flex-col">
	<nav aria-label="Sections" class="min-h-0 flex-1 overflow-y-auto p-3">
		<ul class="space-y-1">
			{#each NAV_ITEMS as item (item.label)}
				{@const current = isCurrent(item, page.url.pathname)}
				<li>
					{#if item.href}
						<a
							href={item.href}
							aria-current={current ? 'page' : undefined}
							class="flex items-center gap-3 rounded-lg px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-[#1976D2]/40 {current
								? 'bg-[#1976D2] font-medium text-white dark:bg-[#1E3A5F] dark:text-[#F5F5F5]'
								: 'text-[#212121] hover:bg-[#E0E0E0] dark:text-[#F5F5F5] dark:hover:bg-[#3A3A3A]'}"
						>
							<NavIcon name={item.icon} />
							{item.label}
						</a>
					{:else}
						<!--
							A span, not a disabled link. There is nothing to navigate to yet,
							and an anchor without an href is not a link to anything — it would
							be announced as one and do nothing when followed.
						-->
						<span
							aria-disabled="true"
							class="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-[#9E9E9E] dark:text-[#757575]"
						>
							<NavIcon name={item.icon} />
							{item.label}
							<span
								class="ml-auto rounded-full border border-[#E0E0E0] px-2 py-0.5 text-[11px] dark:border-[#3A3A3A]"
							>
								Soon
							</span>
						</span>
					{/if}
				</li>
			{/each}
		</ul>
	</nav>

	<div class="border-t border-[#E0E0E0] p-3 dark:border-[#3A3A3A]">
		<!--
			First in the footer, above the theme: it is about what is in the
			sections above, where the theme and the account are about the person.
			Left out, not shown as "?%", when the figure could not be read.
		-->
		{#if storageUsed !== null}
			<div class="mb-3">
				<StorageBar used={storageUsed} />
			</div>
		{/if}

		<!--
			The old app's "Theme" sat at the bottom of the sidebar, and the bottom of
			the sidebar is still where it belongs: a preference set once, beside the
			account it is not stored on, rather than a seventh item competing with
			the six sections above it.
		-->
		<ThemeToggle class="mb-3" />

		<div class="flex items-center gap-3 px-1 py-2">
			{#if user.avatarUrl}
				<!-- Decorative: the name is right beside it. -->
				<img src={user.avatarUrl} alt="" class="h-8 w-8 shrink-0 rounded-full object-cover" />
			{:else}
				<span
					aria-hidden="true"
					class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#E0E0E0] text-sm font-medium text-[#616161] dark:bg-[#3A3A3A] dark:text-[#9E9E9E]"
				>
					{user.name.slice(0, 1).toUpperCase()}
				</span>
			{/if}
			<span class="min-w-0 flex-1 truncate text-sm text-[#212121] dark:text-[#F5F5F5]">
				{user.name}
			</span>
		</div>

		<form method="POST" action="/logout">
			<button
				type="submit"
				class="mt-1 w-full rounded-lg border border-[#E0E0E0] px-3 py-1.5 text-sm text-[#212121] hover:bg-[#E0E0E0] focus-visible:ring-2 focus-visible:ring-[#1976D2]/40 dark:border-[#3A3A3A] dark:text-[#F5F5F5] dark:hover:bg-[#3A3A3A]"
			>
				Logout
			</button>
		</form>
	</div>
</div>
