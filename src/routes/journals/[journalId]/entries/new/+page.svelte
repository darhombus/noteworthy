<script lang="ts">
	/**
	 * Writing a new entry. It saves itself, the same way an edit does.
	 *
	 * ---------------------------------------------------------------------------
	 * NOTHING EXISTS UNTIL THERE IS SOMETHING TO KEEP
	 * ---------------------------------------------------------------------------
	 * Autosave starts when the body stops being blank, by the same `isBlank` the
	 * actions use. Until then nothing is sent: a title or a date on its own is not
	 * an entry, and a "New entry" somebody opened and walked away from must not
	 * become one. Title and date travel with the first save that does happen.
	 *
	 * That leaves one thing on this page autosave cannot see: a title typed while
	 * the body is still blank. It is not a draft — nothing is sent, nothing is
	 * created — but it is somebody's words, so leaving asks about it, through the
	 * `unsent` option below. A date on its own is a default somebody adjusted, not
	 * writing, and does not count.
	 *
	 * The first save creates the row and every later one updates it, through the
	 * same controller, endpoint and status line as the edit page — see
	 * `$lib/entries/entry-autosave.svelte.ts`. The only thing this page adds is
	 * `create: true` on saves made before the row exists, and the id the row is
	 * created under, which the load chose before anything was written. A create
	 * whose reply was lost is sent again under the same id and lands on the row it
	 * already made — see `createEntryOnce`.
	 *
	 * ---------------------------------------------------------------------------
	 * BECOMING THE EDIT PAGE WITHOUT LEAVING
	 * ---------------------------------------------------------------------------
	 * Once the row exists, the address becomes the entry's edit route through
	 * SvelteKit's `replaceState` — shallow routing, so nothing navigates and nothing
	 * remounts. The editor keeps its focus, caret and undo history, and typing
	 * carries on. Reloading loads the real edit page, which opens what was saved.
	 *
	 * Shallow routing has one consequence that needs handling. The history entry
	 * remembers the page it was really made by, `/entries/new`, and when Back or
	 * Forward returns to it from another page SvelteKit renders *that*, under the
	 * edit address — a blank new-entry page, whose first keystroke would create a
	 * second entry. `afterNavigate` below notices the address and the page
	 * disagreeing and goes to the address properly.
	 *
	 * ---------------------------------------------------------------------------
	 * THE FORM IS STILL A FORM
	 * ---------------------------------------------------------------------------
	 * With no JavaScript nothing above runs: the body is a textarea, and Save
	 * posts to the action next door exactly as it always did. Those are inside
	 * `<noscript>`; with JavaScript on, the page is the editor's from the first
	 * frame, as on the edit page (`EntryEditor`, THE WAIT).
	 */
	import { enhance } from '$app/forms';
	import { afterNavigate, goto, replaceState } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { onMount, untrack } from 'svelte';
	import ConflictDialog from '$lib/components/ConflictDialog.svelte';
	import EntryEditor from '$lib/components/EntryEditor.svelte';
	import FontPreloads from '$lib/components/FontPreloads.svelte';
	import SaveStatus from '$lib/components/SaveStatus.svelte';
	import { isBlank, toBody } from '$lib/entries/body';
	import { entryConflict, type EntryDraft } from '$lib/entries/conflict.svelte';
	import { entryAutosave } from '$lib/entries/entry-autosave.svelte';
	import { createSaveTracker } from '$lib/entries/revision';
	import { draftSender } from '$lib/entries/send-draft';
	import { todayAsDateInput } from '$lib/format/date';
	import { entryType } from '$lib/journals/fonts';
	import { RECORDING_NOT_ADDED } from '$lib/media/recording';
	import type { Json } from '$lib/types/database';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	// Captured once, as the edit page captures its entry: a load re-running while
	// somebody types must not change which entry they are writing, and the id
	// above all.
	//
	// The date defaults to today in the browser's timezone. The database's
	// CURRENT_DATE would be UTC, which is a different day for part of every
	// evening. The echoed `form` values are what a refused no-JavaScript submit
	// sent back; with the editor running a refusal changes nothing on screen.
	const opened = untrack(() => ({
		journalId: data.journal.journal_id,
		entryId: data.entryId,
		title: form?.values.title ?? '',
		entryDate: form?.values.entryDate ?? todayAsDateInput(),
		body: toBody(form?.values.body ?? '')
	}));

	type Draft = EntryDraft;

	let title = $state(opened.title);
	let entryDate = $state(opened.entryDate);
	let doc = $state<string | null>(null);
	let editorReady = $state(false);

	/** Whether the row exists: a create has answered. Never goes back to false. */
	let created = $state(false);
	let mounted = false;

	const ids = { journalId: opened.journalId, entryId: opened.entryId };
	const saveUrl = resolve('/journals/[journalId]/entries/[entryId]/autosave', ids);
	const editUrl = resolve('/journals/[journalId]/entries/[entryId]/edit', ids);
	const readUrl = resolve('/journals/[journalId]/entries/[entryId]', ids);
	const journalUrl = resolve('/journals/[journalId]', { journalId: opened.journalId });

	/**
	 * No revision until the row exists; from the create's answer onwards, the
	 * revision this page's text is made from, as on the edit page. A create's
	 * unanswered saves are its own earlier creates, which a repeat is held to.
	 */
	const tracker = createSaveTracker(null);

	let editor = $state<ReturnType<typeof EntryEditor> | null>(null);

	/**
	 * The edit page's conflict handling (`$lib/entries/conflict.svelte`), from the
	 * moment the row exists: until then there is nothing anywhere else to change.
	 */
	const conflict = entryConflict({
		entryId: opened.entryId,
		url: () => saveUrl,
		tracker,
		live: () => created,
		autosave: () => autosave,
		sender: () => post,
		away: () => journalUrl,
		apply: (text) => {
			const body = editor?.replaceContent(text.content) ?? null;
			if (body === null) {
				return null;
			}
			title = text.title;
			entryDate = text.entryDate;
			return { title, entryDate, doc: body };
		}
	});

	const post = draftSender(tracker, () => saveUrl, {
		saved: conflict.hooks.saved,
		stale: (revision) => {
			// A repeated create refused as stale: the row exists, made here and
			// saved from somewhere else since. Whatever is chosen next is an update.
			becomeEntry();
			conflict.hooks.stale?.(revision);
		}
	});

	/** The row exists. See BECOMING THE EDIT PAGE above. */
	function becomeEntry(): void {
		if (created) {
			return;
		}
		created = true;
		// Only while this page is still the one on screen. A save flushed on the
		// way out finishes from the next page, and rewriting *that* page's address
		// to this entry's edit route would be wrong in a way nobody could explain.
		if (mounted) {
			replaceState(editUrl, {});
		}
	}

	/**
	 * `create: true` until a create has answered, whatever happened to the ones
	 * before it. A create that threw may still have landed, and only the server
	 * can tell — sending it again is how it finds out.
	 */
	async function send(draft: Draft): Promise<void> {
		if (created) {
			await post.send(draft);
			return;
		}

		await post.send(draft, { create: true });
		becomeEntry();
	}

	const TITLE_ONLY =
		'This title is not saved yet. Write something in the entry and it will save, title and all. Leave anyway?';

	/**
	 * A title with nothing under it, before the entry exists: the one piece of
	 * writing on this page autosave has not been handed. `doc` is null until the
	 * editor has taken over, and a body that does not exist yet is a blank one: a
	 * title typed while the editor is on its way has no Save button to keep it
	 * (`EntryEditor`, THE WAIT), so leaving asks about it then too.
	 */
	function titleOnly(): boolean {
		return (
			!created && title.trim().length > 0 && (doc === null || isBlank(JSON.parse(doc) as Json))
		);
	}

	/** True while a file is on its way in: leaving would lose it. */
	let uploading = $state(false);

	/** True while a recording is running, or stopped and not yet added: leaving would lose it. */
	let recording = $state(false);

	const UPLOADING =
		'A file is still being added to this entry. Leaving now would lose it. Leave anyway?';

	const autosave = entryAutosave<Draft>(send, {
		unsent: () => (titleOnly() ? TITLE_ONLY : null),
		holding: () => (uploading ? UPLOADING : recording ? RECORDING_NOT_ADDED : null)
	});

	onMount(() => {
		mounted = true;
		return () => {
			mounted = false;
		};
	});

	/*
	 * One effect over all three fields, as on the edit page, with one addition:
	 * before the row exists, a blank body is not a draft of anything.
	 *
	 * `reset` rather than simply not calling `change`, because a body can become
	 * blank again after something was already scheduled — typed, then deleted
	 * inside the debounce. Resetting cancels that and leaves nothing outstanding,
	 * so there is nothing to warn about on the way out either. A create already on
	 * the network is left to finish: the row it makes is then an entry like any
	 * other, and emptying it meets the edit page's own refusal.
	 */
	$effect(() => {
		const body = doc;
		if (body === null) {
			return;
		}
		const draft = { title, entryDate, doc: body };

		if (!untrack(() => created) && isBlank(JSON.parse(body) as Json)) {
			if (untrack(() => autosave.status.state) !== 'saving') {
				autosave.reset(draft);
			}
			return;
		}

		autosave.change(draft);
	});

	/** An entry's edit route, as the address bar shows it. Unanchored at the start for `base`. */
	const EDIT_ADDRESS = /\/journals\/([0-9a-f-]{36})\/entries\/([0-9a-f-]{36})\/edit$/i;

	afterNavigate(() => {
		// See BECOMING THE EDIT PAGE above. Only a history entry this page rewrote
		// puts an edit address in front of this page, so on every ordinary arrival
		// this does nothing. The ids come from the address, not from this page:
		// the page SvelteKit rendered here is a fresh one, with an id of its own.
		const shown = EDIT_ADDRESS.exec(location.pathname);
		if (shown !== null && location.pathname !== page.url.pathname) {
			const [, journalId, entryId] = shown;
			void goto(resolve('/journals/[journalId]/entries/[entryId]/edit', { journalId, entryId }), {
				replaceState: true
			});
		}
	});

	// Before the row exists, a "Saved" in the toolbar would be claiming something
	// about an entry that is not there. The status appears once there is
	// something to report — a save on its way, or one that failed — and stays.
	let showStatus = $derived(editorReady && (created || autosave.status.state !== 'saved'));
</script>

<svelte:head><title>New entry · {data.journal.title} · Noteworthy</title></svelte:head>

<FontPreloads files={data.fontFiles} />

<main>
	<div class="mx-auto max-w-3xl px-4 py-10 sm:px-6">
		<!-- The save status is in the editor's pinned toolbar row; see the edit page. -->
		<h1 class="text-2xl font-semibold text-[#212121] dark:text-[#F5F5F5]">New entry</h1>
		<p class="mt-1 text-sm text-[#616161] dark:text-[#9E9E9E]">In {data.journal.title}</p>

		{#if form?.errors.form}
			<p
				role="alert"
				class="mt-6 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
			>
				{form.errors.form}
			</p>
		{/if}

		<!-- The journal's font and size, for the title field and the body alone (`layout.css`, ENTRY FONTS). -->
		<form method="POST" use:enhance class="mt-6 space-y-5" {...entryType(data.journal)}>
			<div>
				<label for="title" class="block text-sm font-medium text-[#212121] dark:text-[#F5F5F5]">
					Title <span class="font-normal text-[#616161] dark:text-[#9E9E9E]">(optional)</span>
				</label>
				<!-- `data-editor-shortcuts`: Ctrl/Cmd+K here does not open search (`$lib/search/shortcut`). -->
				<input
					id="title"
					name="title"
					type="text"
					maxlength="200"
					data-editor-shortcuts
					bind:value={title}
					aria-invalid={form?.errors.title ? 'true' : undefined}
					aria-describedby={form?.errors.title ? 'title-error' : undefined}
					class="entry-title-field mt-1 w-full rounded-lg border border-[#E0E0E0] bg-white px-3 py-2 text-[#212121] focus:border-[#1976D2] focus:ring-2 focus:ring-[#1976D2]/30 dark:border-[#3A3A3A] dark:bg-[#121212] dark:text-[#F5F5F5]"
				/>
				{#if form?.errors.title}
					<p id="title-error" class="mt-1 text-sm text-red-600 dark:text-red-400">
						{form.errors.title}
					</p>
				{/if}
			</div>

			<div>
				<label for="entryDate" class="block text-sm font-medium text-[#212121] dark:text-[#F5F5F5]">
					Date
				</label>
				<!--
					The day the entry is about, which `entries.entry_date` holds separately
					from `created_at` — so an entry written tonight about yesterday sorts
					and reads as yesterday.
				-->
				<input
					id="entryDate"
					name="entryDate"
					type="date"
					bind:value={entryDate}
					aria-invalid={form?.errors.entryDate ? 'true' : undefined}
					aria-describedby={form?.errors.entryDate ? 'entryDate-error' : undefined}
					class="mt-1 rounded-lg border border-[#E0E0E0] bg-white px-3 py-2 text-[#212121] focus:border-[#1976D2] focus:ring-2 focus:ring-[#1976D2]/30 dark:border-[#3A3A3A] dark:bg-[#121212] dark:text-[#F5F5F5]"
				/>
				<p class="mt-1 text-xs text-[#616161] dark:text-[#9E9E9E]">
					The day this entry is about, not the day you typed it.
				</p>
				{#if form?.errors.entryDate}
					<p id="entryDate-error" class="mt-1 text-sm text-red-600 dark:text-red-400">
						{form.errors.entryDate}
					</p>
				{/if}
			</div>

			<div>
				<!--
					Not a `<label for>`, as on the edit page: the editor and the
					no-JavaScript textarea both point back here with `aria-labelledby`.
				-->
				<span id="body-label" class="block text-sm font-medium text-[#212121] dark:text-[#F5F5F5]">
					Entry
				</span>
				<EntryEditor
					bind:this={editor}
					content={opened.body}
					owner={data.owner}
					media={data.media}
					remaining={data.remaining}
					onUploading={(busy) => (uploading = busy)}
					onRecording={(holding) => (recording = holding)}
					labelledBy="body-label"
					describedBy={form?.errors.body ? 'body-error' : undefined}
					invalid={Boolean(form?.errors.body)}
					onReady={() => (editorReady = true)}
					onDocChange={(value) => (doc = value)}
				>
					{#snippet saveStatus(returnFocus: () => void)}
						{#if showStatus}
							<SaveStatus
								status={autosave.display}
								onRetry={() => void autosave.flush()}
								{returnFocus}
							/>
						{/if}
					{/snippet}
				</EntryEditor>
				{#if form?.errors.body}
					<p id="body-error" class="mt-1 text-sm text-red-600 dark:text-red-400">
						{form.errors.body}
					</p>
				{/if}
			</div>

			<div class="flex flex-wrap items-center justify-end gap-3">
				<!--
					"Done", as on the edit page: with JavaScript there is no Save to
					press, because saving is not something this page waits to be told.
					Before the entry exists it goes back to the journal, since there is
					nothing yet to read. From the first frame, as on the edit page, so
					nothing changes as the editor arrives.
				-->
				<a
					data-needs-js
					href={created ? readUrl : journalUrl}
					class="rounded-lg border border-[#E0E0E0] px-4 py-2 text-sm text-[#212121] hover:bg-[#F5F5F5] focus-visible:ring-2 focus-visible:ring-[#1976D2]/40 dark:border-[#3A3A3A] dark:text-[#F5F5F5] dark:hover:bg-[#2C2C2C]"
				>
					Done
				</a>
				<!--
					The no-JavaScript half of the switch. Nothing autosaves here, so the
					page keeps the button it always had. `data-no-js`: see NO JAVASCRIPT
					in `EntryEditor`.
				-->
				<noscript data-no-js>
					<a
						href={journalUrl}
						class="rounded-lg border border-[#E0E0E0] px-4 py-2 text-sm text-[#212121] hover:bg-[#F5F5F5] focus-visible:ring-2 focus-visible:ring-[#1976D2]/40 dark:border-[#3A3A3A] dark:text-[#F5F5F5] dark:hover:bg-[#2C2C2C]"
					>
						Cancel
					</a>
					<button
						type="submit"
						class="rounded-lg bg-[#1976D2] px-4 py-2 text-sm font-medium text-white hover:bg-[#1565C0] focus-visible:ring-2 focus-visible:ring-[#1976D2]/40"
					>
						Save entry
					</button>
				</noscript>
			</div>
		</form>
	</div>
	<ConflictDialog {conflict} />
</main>
