<script lang="ts">
	/**
	 * The timing readout: a small box in the bottom corner of every page while
	 * this browser has asked for it at `/timing`. The root layout loads this
	 * component, and with it the recorder, only then; with the cookie absent no
	 * byte of it is fetched and nothing is listened to or observed.
	 *
	 * `fixed`, so it is laid over the page and moves nothing: the layout draws it
	 * first, before the shell, where anything in the flow would push the whole
	 * page down. `z-40`: over the sticky bars (`z-20`), under the progress bar
	 * (`z-50`) and the top layer, where every dialog is.
	 *
	 * Closed it is one line: how many rows, and the newest. Open, every row, the
	 * newest last, and Copy, which puts them on the clipboard as plain text.
	 *
	 * See docs/constraints.md, "The timing readout".
	 */
	import { afterNavigate, beforeNavigate } from '$app/navigation';
	import { match } from '$app/paths';
	import { page } from '$app/state';
	import { untrack } from 'svelte';
	import { startRecording, type Recorder, type RouteOf } from '$lib/timing/recorder';
	import { copyText, describeRow, localDateTime, type Row } from '$lib/timing/rows';

	let {
		box = $bindable(null)
	}: {
		/** Its own box, for the toasts to stay above (`$lib/toast/Toaster.svelte`). */
		box?: HTMLElement | null;
	} = $props();

	let rows = $state.raw<Row[]>([]);
	let open = $state(false);
	let copied = $state(false);

	let recorder: Recorder | null = null;

	// A page's route id, `null` for an address no page answers (`/logout`,
	// `/theme`): those are endpoints, not a page's action.
	const routeOf: RouteOf = async (url) => (await match(url))?.id ?? null;

	$effect(() => {
		const started = startRecording(
			untrack(() => page.route.id),
			routeOf,
			(next) => (rows = next)
		);
		recorder = started;
		return () => {
			recorder = null;
			started.destroy();
		};
	});

	// A form's answer is applied to the page through these: a refusal or a
	// success through `form` and `status`, its `update()`'s reload through
	// `data`, an error through `error`. A redirect is a navigation instead.
	$effect(() => {
		void page.data;
		void page.form;
		void page.status;
		void page.error;
		untrack(() => recorder?.pageUpdated());
	});

	beforeNavigate((navigation) => {
		if (navigation.type !== 'leave') {
			recorder?.navigationStarted({ type: navigation.type });
		}
	});

	afterNavigate((navigation) => {
		if (navigation.type === 'enter' || navigation.to === null) {
			return;
		}
		recorder?.navigationEnded({
			type: navigation.type,
			route: navigation.to.route.id,
			url: navigation.to.url
		});
	});

	let newest = $derived(rows.at(-1));

	function heading(): string {
		const connection = (navigator as Navigator & { connection?: { effectiveType?: string } })
			.connection?.effectiveType;
		return ['Noteworthy timing', localDateTime(new Date()), connection].filter(Boolean).join(' · ');
	}

	async function copy() {
		const text = copyText(rows, heading());
		try {
			await navigator.clipboard.writeText(text);
		} catch {
			// No clipboard API (an insecure address) or no permission: the old way.
			const field = document.createElement('textarea');
			field.value = text;
			field.setAttribute('readonly', '');
			field.style.position = 'fixed';
			field.style.opacity = '0';
			document.body.append(field);
			field.select();
			document.execCommand('copy');
			field.remove();
		}
		copied = true;
		setTimeout(() => (copied = false), 1500);
	}
</script>

<div
	bind:this={box}
	data-timing-readout
	class="fixed right-2 bottom-2 z-40 max-w-[calc(100vw-1rem)] font-mono text-[11px] leading-4"
>
	{#if open}
		<section
			aria-label="Timing readout"
			class="flex max-h-[60svh] w-[22rem] max-w-full flex-col rounded-lg border border-[#E0E0E0] bg-white shadow-sm dark:border-[#3A3A3A] dark:bg-[#1E1E1E]"
		>
			<div
				class="flex items-center gap-2 border-b border-[#E0E0E0] px-2 py-1 dark:border-[#3A3A3A]"
			>
				<span class="font-semibold text-[#212121] dark:text-[#F5F5F5]">Timing</span>
				<button
					type="button"
					onclick={copy}
					class="ml-auto rounded border border-[#E0E0E0] px-2 py-0.5 text-[#212121] hover:bg-[#F5F5F5] focus-visible:ring-2 focus-visible:ring-[#1976D2]/40 focus-visible:outline-none dark:border-[#3A3A3A] dark:text-[#F5F5F5] dark:hover:bg-[#2C2C2C]"
				>
					{copied ? 'Copied' : 'Copy'}
				</button>
				<button
					type="button"
					onclick={() => (open = false)}
					aria-expanded="true"
					class="rounded border border-[#E0E0E0] px-2 py-0.5 text-[#212121] hover:bg-[#F5F5F5] focus-visible:ring-2 focus-visible:ring-[#1976D2]/40 focus-visible:outline-none dark:border-[#3A3A3A] dark:text-[#F5F5F5] dark:hover:bg-[#2C2C2C]"
				>
					Close
				</button>
			</div>
			<ol class="min-h-0 flex-1 overflow-auto px-2 py-1 text-[#212121] dark:text-[#F5F5F5]">
				{#each rows as row, index (row)}
					<li data-timing-row data-kind={row.kind} class="py-0.5 break-words">
						{index + 1}. {describeRow(row)}
					</li>
				{:else}
					<li class="py-0.5 text-[#616161] dark:text-[#9E9E9E]">Nothing recorded yet.</li>
				{/each}
			</ol>
		</section>
	{:else}
		<button
			type="button"
			onclick={() => (open = true)}
			aria-expanded="false"
			aria-label="Timing readout, {rows.length} recorded"
			class="block max-w-[16rem] truncate rounded-lg border border-[#E0E0E0] bg-white px-2 py-1 text-left text-[#212121] shadow-sm hover:bg-[#F5F5F5] focus-visible:ring-2 focus-visible:ring-[#1976D2]/40 focus-visible:outline-none dark:border-[#3A3A3A] dark:bg-[#1E1E1E] dark:text-[#F5F5F5] dark:hover:bg-[#2C2C2C]"
		>
			⏱ {rows.length}{newest ? ` · ${describeRow(newest)}` : ''}
		</button>
	{/if}
</div>
