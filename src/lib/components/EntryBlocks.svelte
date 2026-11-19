<script lang="ts">
	/**
	 * A list of blocks, rendered as the elements they are.
	 *
	 * Recursive: a blockquote holds blocks, a list item holds blocks, and both
	 * hand them back to this component. `render.ts` has already bounded the depth,
	 * so there is no runaway to guard against here.
	 *
	 * ---------------------------------------------------------------------------
	 * WHY AN ENTRY'S HEADING 1 COMES OUT AS <h2>
	 * ---------------------------------------------------------------------------
	 * The page's `<h1>` is the entry's title. A body heading is part of that entry,
	 * not a sibling of it, so rendering Heading 1 as a second `<h1>` would tell
	 * anyone navigating by heading level that the two were peers — and give the
	 * page two top-level headings, which is the kind of thing only a screen reader
	 * user ever notices.
	 *
	 * So the levels shift down by one: Heading 1 is `<h2>`, Heading 2 is `<h3>`.
	 * They are not *smaller* for it — `.entry-read` in `layout.css` gives those
	 * two elements the same sizes `.entry-edit` gives the editor's `<h1>` and
	 * `<h2>`, because a heading that shrinks the moment you stop editing looks
	 * like the app changed its mind about it.
	 *
	 * ---------------------------------------------------------------------------
	 * EMPTY PARAGRAPHS
	 * ---------------------------------------------------------------------------
	 * Kept, not skipped. An entry written through the old textarea stores a blank
	 * line as an empty paragraph, and dropping them would silently close up the
	 * spacing of every entry written before the editor existed. `.entry-read`
	 * gives `p:empty` a line's height so it holds its space, which is what the
	 * editor shows for the same document.
	 *
	 * ---------------------------------------------------------------------------
	 * THE SAME BLOCKS, AS THE EDITOR DRAWS THEM
	 * ---------------------------------------------------------------------------
	 * `editing` draws the body for the edit page before TipTap arrives
	 * (`EntryEditor`, THE WAIT), as ProseMirror is about to draw it, so that
	 * nothing moves when it does. Three things differ from the read view, and
	 * each is ProseMirror's choice rather than this app's:
	 *
	 *   headings are `<h1>` and `<h2>`, the schema's own elements, which
	 *   `.entry-edit` sizes — the same element the editor will put there;
	 *
	 *   a paragraph with nothing in it, or ending in a line break, holds a `<br>`
	 *   at its end, which is what ProseMirror puts there so that the empty line
	 *   has a height and the caret somewhere to go;
	 *
	 *   media is drawn as the editor's figure, collapse button and all
	 *   (`EntryEditMedia`), and `selected` is the item the editor opens with
	 *   selected, if any (`$lib/entries/opening`).
	 *
	 * Links keep their look and lose their `href` (`EntryMarks`).
	 */
	import type { RenderBlock, RenderInline } from '$lib/entries/render';
	import EntryEditMedia from './EntryEditMedia.svelte';
	import EntryImage from './EntryImage.svelte';
	import EntryMarks from './EntryMarks.svelte';
	import EntryPlayer from './EntryPlayer.svelte';
	import Self from './EntryBlocks.svelte';

	let {
		blocks,
		editing = false,
		selected = null
	}: { blocks: RenderBlock[]; editing?: boolean; selected?: RenderBlock | null } = $props();

	/** Where ProseMirror keeps a `<br>` at the end of a textblock: empty, or ending in a break. */
	function trailingBreak(inline: RenderInline[]): boolean {
		return editing && (inline.length === 0 || inline[inline.length - 1].kind === 'break');
	}
</script>

{#each blocks as block, index (index)}
	{#if block.kind === 'paragraph'}
		<p>
			{#each block.inline as node, position (position)}
				{#if node.kind === 'break'}<br />{:else}<EntryMarks
						marks={node.marks}
						text={node.text}
						{editing}
					/>{/if}
			{/each}{#if trailingBreak(block.inline)}<br />{/if}
		</p>
	{:else if block.kind === 'heading'}
		<svelte:element
			this={editing ? (block.level === 1 ? 'h1' : 'h2') : block.level === 1 ? 'h2' : 'h3'}
		>
			{#each block.inline as node, position (position)}
				{#if node.kind === 'break'}<br />{:else}<EntryMarks
						marks={node.marks}
						text={node.text}
						{editing}
					/>{/if}
			{/each}{#if trailingBreak(block.inline)}<br />{/if}
		</svelte:element>
	{:else if block.kind === 'blockquote'}
		<blockquote><Self blocks={block.blocks} {editing} {selected} /></blockquote>
	{:else if block.kind === 'bulletList'}
		<ul>
			{#each block.items as item, position (position)}
				<li><Self blocks={item} {editing} {selected} /></li>
			{/each}
		</ul>
	{:else if editing && (block.kind === 'image' || block.kind === 'video')}
		<EntryEditMedia
			kind={block.kind}
			path={block.path}
			width={block.width}
			height={block.height}
			selected={block === selected}
		/>
	{:else if editing && block.kind === 'audio'}
		<EntryEditMedia kind="audio" path={block.path} selected={block === selected} />
	{:else if block.kind === 'image'}
		<EntryImage path={block.path} width={block.width} height={block.height} />
	{:else if block.kind === 'video'}
		<EntryPlayer kind="video" path={block.path} width={block.width} height={block.height} />
	{:else if block.kind === 'audio'}
		<EntryPlayer kind="audio" path={block.path} />
	{:else}
		<ol start={block.start}>
			{#each block.items as item, position (position)}
				<li><Self blocks={item} {editing} {selected} /></li>
			{/each}
		</ol>
	{/if}
{/each}
