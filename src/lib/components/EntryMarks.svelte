<script lang="ts">
	/**
	 * One run of text, wrapped in its marks.
	 *
	 * Recursive rather than a chain of nested `{#if}`s, because marks nest in the
	 * order they arrive and five marks would otherwise be a five-deep pyramid
	 * written out twice — once for each ordering somebody happened to think of.
	 * Each render peels one mark off the front and hands the rest to itself; the
	 * empty list is the base case and prints the text.
	 *
	 * ---------------------------------------------------------------------------
	 * THE TEXT IS PRINTED, NOT INJECTED
	 * ---------------------------------------------------------------------------
	 * `{text}` is an ordinary Svelte interpolation, so `<script>` in an entry body
	 * arrives on the page as eight visible characters. There is no `{@html}` here
	 * or anywhere else in this app's rendering of an entry, which is why there is
	 * no HTML sanitiser either — nothing ever builds markup out of the document.
	 *
	 * ---------------------------------------------------------------------------
	 * LINKS
	 * ---------------------------------------------------------------------------
	 * `href` is the one value in a body the browser acts on rather than displays,
	 * and it has already been through `normalizeHref` in `render.ts` — which parses
	 * the URL and reads its protocol, so only `http:`, `https:` and `mailto:` ever
	 * reach this template. A refused href never becomes a `link` mark at all, so
	 * there is no case here for "link with a bad href": it renders as plain text.
	 *
	 * `rel="noopener noreferrer nofollow"` and `target="_blank"`, on every link:
	 *
	 *   `noopener` — without it a `_blank` link hands the opened page a live
	 *   `window.opener` pointing back at this tab, which it can navigate.
	 *   `noreferrer` — the address of a private journal entry is not something to
	 *   send to whatever a person happened to link to.
	 *   `nofollow` — the text of an entry is user input and this is a link out of
	 *   it; the app does not vouch for where it goes.
	 *
	 * `_blank` because losing the entry you are reading to a link you tapped is a
	 * worse outcome than an extra tab. Note that this is not announced to screen
	 * readers: WCAG asks for that at AAA, and a "(opens in a new tab)" after every
	 * link in a paragraph of them reads worse than it helps. Worth revisiting if
	 * entries turn out to be link-heavy.
	 */
	import type { RenderMark } from '$lib/entries/render';
	import Self from './EntryMarks.svelte';

	let {
		marks,
		text,
		editing = false
	}: { marks: RenderMark[]; text: string; editing?: boolean } = $props();

	let head = $derived(marks[0]);
	let rest = $derived(marks.slice(1));
</script>

{#if head === undefined}{text}{:else if head.type === 'bold'}<strong
		><Self marks={rest} {text} {editing} /></strong
	>{:else if head.type === 'italic'}<em><Self marks={rest} {text} {editing} /></em
	>{:else if head.type === 'strike'}<s><Self marks={rest} {text} {editing} /></s
	>{:else if head.type === 'highlight'}<mark><Self marks={rest} {text} {editing} /></mark>{:else}<a
		href={editing ? undefined : head.href}
		target="_blank"
		rel="noopener noreferrer nofollow"><Self marks={rest} {text} {editing} /></a
	>{/if}
