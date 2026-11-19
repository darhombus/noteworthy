<script lang="ts">
	/**
	 * The Recycle Bin: what has been deleted and can still come back, and the
	 * files taken out of entries that are about to be cleared.
	 *
	 * The tabs are links (`?tab=`), so they work without script and the back
	 * button and a reload keep them; `$lib/bin/rows` has the rules for what each
	 * lists. Restoring is in each row's menu, which needs script like every
	 * other actions menu. An entry whose journal is deleted too asks first,
	 * because restoring it brings the journal back as well.
	 *
	 * Deleting for good is in the same menu, as Delete permanently; a waiting
	 * file has Delete now on its row; Empty bin sits by the heading on every
	 * tab, whenever the bin or the waiting list holds anything, and empties
	 * both whichever tab is showing. Each asks first (`DeleteForeverDialog`).
	 *
	 * What an action came to is a toast (`$lib/toast`): a success, "gone
	 * already" as info, and the one-press Restore's errors, which stay until
	 * closed. A restore's toast holds Open journal or Open entry, and stays
	 * until closed for it. Refusals inside a dialog stay in the dialog. Focus
	 * goes to the heading, since the row and the button that had it are gone.
	 *
	 * "Days left" is worked out from the browser's clock once the page runs,
	 * and checked again every minute, so a page left open across the night
	 * keeps telling the truth. The server's render uses its own clock, which
	 * says the same except within a minute or so of a day's boundary.
	 *
	 * A waiting file's "Clears Wed 07:00" (`$lib/bin/clearing`) is a time in
	 * the viewer's zone, which the server cannot know, so it is not rendered
	 * there at all: it appears once the browser's clock has been read, and
	 * follows it every minute like the days left.
	 */
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { flushSync, onMount, tick } from 'svelte';
	import ActionMenu from '$lib/components/ActionMenu.svelte';
	import {
		binSummary,
		deletedSeparately,
		finishedText,
		hasAnything,
		type Deleted,
		type ForeverTarget
	} from '$lib/bin/forever';
	import { clearsLabel } from '$lib/bin/clearing';
	import { daysLeftLabel } from '$lib/bin/retention';
	import {
		BIN_TABS,
		EMPTY,
		TAB_LABELS,
		binRows,
		entryTitle,
		fileKind,
		rowDetail,
		tabNote,
		tabQuery,
		type EntryRow,
		type FileRow,
		type JournalRow
	} from '$lib/bin/rows';
	import { provideThumbnailLinks } from '$lib/bin/thumbnail-links';
	import { formatSize } from '$lib/media/messages';
	import { createMediaLinks } from '$lib/media/page-links';
	import { error as toastError, info, success } from '$lib/toast/toasts.svelte';
	import BinThumbnail from './BinThumbnail.svelte';
	import DeleteForeverDialog from './DeleteForeverDialog.svelte';
	import RestoreWithJournalDialog from './RestoreWithJournalDialog.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let rows = $derived(binRows(data.tab, data.items, data.waiting));

	// ---------------------------------------------------------------------------
	// Thumbnails: a fresh set of links for each batch the load signs.
	// ---------------------------------------------------------------------------
	let links = $derived(createMediaLinks(data.thumbnails));
	$effect(() => {
		const current = links;
		current.start();
		return () => current.stop();
	});
	provideThumbnailLinks(() => links);

	// ---------------------------------------------------------------------------
	// Days left, and when waiting files clear, on the browser's clock once it
	// runs.
	// ---------------------------------------------------------------------------
	let clock = $state<number | null>(null);
	let now = $derived(clock ?? data.now);

	let tabRow = $state<HTMLElement | null>(null);

	onMount(() => {
		clock = Date.now();
		const timer = setInterval(() => (clock = Date.now()), 60 * 1000);

		// On a narrow screen the row scrolls, and the tab a link or a reload
		// opened may be out of sight at its far end.
		tabRow
			?.querySelector('[aria-current="page"]')
			?.scrollIntoView({ block: 'nearest', inline: 'nearest' });

		return () => clearInterval(timer);
	});

	// ---------------------------------------------------------------------------
	// Restoring
	// ---------------------------------------------------------------------------
	type Restorable = JournalRow | EntryRow;

	let confirm: RestoreWithJournalDialog;
	let restoreForm: HTMLFormElement;
	let pending = $state.raw<Restorable | null>(null);
	let heading = $state<HTMLElement | null>(null);

	/**
	 * Focus to the heading once an answer is drawn: the row, and the menu
	 * button or the dialog's opener that had focus, may be gone. The answer is
	 * a toast, which never takes focus (`$lib/toast`), so the heading is where
	 * the page picks up from.
	 */
	async function toHeading(): Promise<void> {
		await tick();
		heading?.focus();
	}

	function restore(row: Restorable): void {
		if (pending !== null) {
			return;
		}
		if (row.kind === 'entry' && row.journalDeleted) {
			confirm.open(row);
			return;
		}
		flushSync(() => {
			pending = row;
		});
		restoreForm.requestSubmit();
	}

	/**
	 * What to say once a restore has landed, with a link to where the item
	 * went. A toast with a link stays until closed (`$lib/toast/toasts.svelte`).
	 */
	async function restored(row: Restorable): Promise<void> {
		if (row.kind === 'journal') {
			success(`Restored “${row.title}”.`, {
				link: {
					href: resolve('/journals/[journalId]', { journalId: row.id }),
					label: 'Open journal'
				}
			});
		} else {
			success(
				row.journalDeleted
					? `Restored “${entryTitle(row.title)}” and its journal “${row.journalTitle}”.`
					: `Restored “${entryTitle(row.title)}” to ${row.journalTitle}.`,
				{
					link: {
						href: resolve('/journals/[journalId]/entries/[entryId]', {
							journalId: row.journalId,
							entryId: row.id
						}),
						label: 'Open entry'
					}
				}
			);
		}
		await toHeading();
	}

	const submitRestore: SubmitFunction = () => {
		const row = pending;
		return async ({ result, update }) => {
			if (result.type === 'error') {
				pending = null;
				toastError('Couldn’t reach the server. Check your connection, then try again.');
				await toHeading();
				return;
			}
			// `update()` reloads the list after a success only. After a refusal it
			// is reloaded here: "no longer in the Recycle Bin" is only worth saying
			// if the row goes too.
			if (result.type === 'failure') {
				await invalidateAll();
			} else {
				await update({ reset: false });
			}
			pending = null;
			if (result.type === 'failure') {
				const message =
					typeof result.data?.message === 'string' ? result.data.message : 'Couldn’t restore it.';
				// 404: no longer in the bin, which is news, not a fault. The list is
				// already up to date.
				if (result.status === 404) {
					info(message);
				} else {
					toastError(message);
				}
				await toHeading();
			} else if (result.type === 'success' && row !== null) {
				await restored(row);
			}
		};
	};

	function menuName(row: Restorable): string {
		return row.kind === 'journal' ? row.title : entryTitle(row.title);
	}

	// ---------------------------------------------------------------------------
	// Deleting for good
	// ---------------------------------------------------------------------------
	let forever: DeleteForeverDialog;

	let summary = $derived(binSummary(data.items, data.waiting, data.bytes));

	function deleteForever(row: Restorable): void {
		forever.open(
			row.kind === 'journal'
				? { kind: 'journal', row, separately: deletedSeparately(row.id, data.items) }
				: { kind: 'entry', row }
		);
	}

	function clearFile(row: FileRow): void {
		forever.open({ kind: 'file', row });
	}

	/** Its refusals stay in the dialog; what it came to is a toast. */
	async function finished(target: ForeverTarget, result: Deleted): Promise<void> {
		// Gone already: news, not a success.
		(result.gone ? info : success)(finishedText(target, result));
		await toHeading();
	}
</script>

<svelte:head><title>Recycle Bin · Noteworthy</title></svelte:head>

<main>
	<div class="mx-auto max-w-3xl px-4 py-10 sm:px-6">
		<div class="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
			<!-- Focus comes here after an answer (`toHeading`), never by Tab. -->
			<h1
				bind:this={heading}
				tabindex="-1"
				class="text-2xl font-semibold text-[#212121] focus-visible:outline-none dark:text-[#F5F5F5]"
			>
				Recycle Bin
			</h1>
			{#if hasAnything(summary)}
				<button
					type="button"
					onclick={() => forever.open({ kind: 'bin', summary })}
					class="rounded-lg border border-[#C62828]/40 px-3 py-1.5 text-sm font-medium text-[#C62828] hover:bg-red-50 focus-visible:ring-2 focus-visible:ring-[#C62828]/40 focus-visible:outline-none dark:border-red-400/40 dark:text-red-300 dark:hover:bg-red-950"
				>
					Empty bin
				</button>
			{/if}
		</div>

		<!--
			Links, not an ARIA tablist: each is a page of its own, with an address.
			On a narrow screen the row scrolls sideways rather than wrapping, so
			"Waiting to be cleared" stays one label on one line. The negative margin
			lets it scroll to the screen's edge instead of stopping short at the
			page's padding.
		-->
		<nav
			bind:this={tabRow}
			aria-label="Recycle Bin"
			data-tabs
			class="-mx-4 mt-6 scrollbar-app overflow-x-auto overscroll-x-contain px-4 sm:-mx-6 sm:px-6"
		>
			<ul class="flex w-max min-w-full gap-1 border-b border-[#E0E0E0] dark:border-[#3A3A3A]">
				{#each BIN_TABS as tab (tab)}
					{@const current = tab === data.tab}
					<li class="shrink-0">
						<a
							href="{resolve('/bin')}{tabQuery(tab)}"
							aria-current={current ? 'page' : undefined}
							class="-mb-px block border-b-2 px-3 py-2 text-sm whitespace-nowrap focus-visible:ring-2 focus-visible:ring-[#1976D2]/40 focus-visible:outline-none {current
								? 'border-[#1976D2] font-medium text-[#1976D2] dark:border-[#90CAF9] dark:text-[#90CAF9]'
								: 'border-transparent text-[#616161] hover:text-[#212121] dark:text-[#9E9E9E] dark:hover:text-[#F5F5F5]'}"
						>
							{TAB_LABELS[tab]}
						</a>
					</li>
				{/each}
			</ul>
		</nav>

		<p class="mt-4 text-sm text-[#616161] dark:text-[#9E9E9E]">{tabNote(data.tab)}</p>

		{#if rows.length === 0}
			<p
				class="mt-6 rounded-xl border border-dashed border-[#E0E0E0] bg-white px-6 py-12 text-center text-sm text-[#616161] dark:border-[#3A3A3A] dark:bg-[#1E1E1E] dark:text-[#9E9E9E]"
			>
				{EMPTY[data.tab]}
			</p>
		{:else}
			<ul
				aria-label={TAB_LABELS[data.tab]}
				class="mt-6 divide-y divide-[#E0E0E0] rounded-xl border border-[#E0E0E0] bg-white shadow-sm dark:divide-[#3A3A3A] dark:border-[#3A3A3A] dark:bg-[#1E1E1E]"
			>
				{#each rows as row (row.kind === 'file' ? `file:${row.path}` : `${row.kind}:${row.id}`)}
					<li class="flex items-start gap-3 px-4 py-3" data-row={row.kind}>
						{#if row.kind === 'file'}
							{@const kind = fileKind(row.type)}
							<BinThumbnail path={row.path} {kind} />
							<div class="min-w-0 flex-1">
								<p class="font-medium text-[#212121] dark:text-[#F5F5F5]">{kind}</p>
								<p class="mt-0.5 text-sm text-[#616161] dark:text-[#9E9E9E]">
									{formatSize(row.size)}
								</p>
								<!--
									The time only once the page runs (`clock`), never from the
									server, whose zone is UTC: the server's HTML and the first
									render in the browser both stop at "Removed from an entry".
								-->
								<p class="mt-0.5 text-sm text-[#616161] dark:text-[#9E9E9E]" data-clears>
									{clock === null
										? 'Removed from an entry'
										: `Removed from an entry · ${clearsLabel(row.deletedAt, clock)}`}
								</p>
							</div>
							<button
								type="button"
								onclick={() => clearFile(row)}
								aria-label="Delete now: {kind}, {formatSize(row.size)}"
								class="-my-0.5 shrink-0 rounded-lg px-2 py-1.5 text-sm font-medium text-[#C62828] hover:bg-red-50 focus-visible:ring-2 focus-visible:ring-[#C62828]/40 focus-visible:outline-none dark:text-red-300 dark:hover:bg-red-950"
							>
								Delete now
							</button>
						{:else}
							<div class="min-w-0 flex-1">
								<p class="font-medium wrap-anywhere text-[#212121] dark:text-[#F5F5F5]">
									{#if row.kind === 'entry' && entryTitle(row.title) === 'Untitled'}
										<span class="italic">Untitled</span>
									{:else}
										{menuName(row)}
									{/if}
								</p>
								<p class="mt-0.5 text-sm wrap-anywhere text-[#616161] dark:text-[#9E9E9E]">
									{rowDetail(row)}
								</p>
								<p class="mt-0.5 text-sm text-[#616161] dark:text-[#9E9E9E]" data-days-left>
									{#if pending !== null && pending.kind === row.kind && pending.id === row.id}
										Restoring…
									{:else}
										{daysLeftLabel(row.deletedAt, now)}
									{/if}
								</p>
							</div>
							<div class="-my-1 -mr-2">
								<ActionMenu
									name={menuName(row)}
									items={[
										{
											label:
												row.kind === 'entry' && row.journalDeleted
													? 'Restore with journal'
													: 'Restore',
											run: () => restore(row)
										},
										{
											label: 'Delete permanently',
											destructive: true,
											run: () => deleteForever(row)
										}
									]}
								/>
							</div>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}
	</div>
</main>

<!-- The one-press restore. Its fields are the row the menu was opened on. -->
<form bind:this={restoreForm} method="POST" action="?/restore" use:enhance={submitRestore} hidden>
	<input type="hidden" name="kind" value={pending?.kind ?? ''} />
	<input type="hidden" name="id" value={pending?.id ?? ''} />
</form>

<RestoreWithJournalDialog bind:this={confirm} onrestored={(row) => void restored(row)} />

<DeleteForeverDialog
	bind:this={forever}
	onfinished={(target, result) => void finished(target, result)}
/>
