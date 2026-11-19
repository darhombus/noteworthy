import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';
import adapter from '@sveltejs/adapter-auto';
import { sveltekit } from '@sveltejs/kit/vite';

export default defineConfig({
	plugins: [
		tailwindcss(),
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},

			// adapter-auto only supports some environments, see https://svelte.dev/docs/kit/adapter-auto for a list.
			// If your environment is not supported, or you settled on a specific environment, switch out the adapter.
			// See https://svelte.dev/docs/kit/adapters for more information about adapters.
			adapter: adapter(),

			// `resolve()` returns the same absolute path wherever it runs. SvelteKit's
			// default (`true`) makes it relative to the request being served whenever
			// a request is in progress, and a value built at import keeps whatever the
			// first request made of it: after a server's first request was `/wake`,
			// every trail's Journals crumb was `./journals`, which on an entry's page
			// is a 404. See docs/constraints.md, "Paths are absolute".
			paths: { relative: false }
		})
	],
	server: {
		// The untracked probe folder is not source: nothing in it is served or tested.
		// Watched, it was crawled by the browser test project's own Vite server (Vitest
		// closes the others' watchers in run mode, not that one), on the process that
		// serves every test's module transforms; at 73 MB and 1,716 files it doubled
		// `broadcast.test.ts`'s first test (two fresh imports) to 3–3.7 s, and it timed
		// out at 5 s now and then. See docs/constraints.md, "The editor's keys after a
		// click on a player". Vite already leaves `test-results` alone; this adds probes.
		watch: { ignored: ['**/probes/**'] }
	},
	build: {
		// A font file is never inlined into the stylesheet as a data URL, however
		// small: inlined, it would be part of every page's first load whether the
		// page draws it or not. The smallest is 7.2 KB today, over Vite's 4 KB
		// default, but nothing should depend on that. Everything else keeps the
		// default (`undefined`). See docs/constraints.md, "Journal fonts".
		assetsInlineLimit: (file) => (file.endsWith('.woff2') ? false : undefined)
	},
	optimizeDeps: {
		// Bundled up front, because Vite finding one of these mid-run rebuilds its
		// dependency cache and loads ProseMirror's module a second time: "Duplicate
		// use of selection JSON ID gapcursor", and the browser tests fail. Any new
		// direct import of a `@tiptap/pm/*` or `prosemirror-*` module goes here in
		// the same change. See docs/constraints.md, "Database and tooling".
		include: [
			'@tiptap/pm/gapcursor',
			'@tiptap/pm/history',
			'@tiptap/pm/model',
			'@tiptap/pm/transform'
		]
	},
	test: {
		expect: { requireAssertions: true },
		projects: [
			{
				extends: './vite.config.ts',
				test: {
					name: 'client',
					browser: {
						enabled: true,
						provider: playwright(),
						instances: [{ browser: 'chromium', headless: true }]
					},
					// Components, and the modules that only mean anything in a browser:
					// `image.ts` decodes and re-encodes photos through a canvas, which
					// is not something Node can be asked to do.
					include: ['src/**/*.svelte.{test,spec}.{js,ts}', 'src/**/*.browser.{test,spec}.{js,ts}'],
					exclude: ['src/lib/server/**']
				}
			},

			{
				extends: './vite.config.ts',
				test: {
					name: 'server',
					environment: 'node',
					include: ['src/**/*.{test,spec}.{js,ts}'],
					exclude: ['src/**/*.svelte.{test,spec}.{js,ts}', 'src/**/*.browser.{test,spec}.{js,ts}']
				}
			},

			{
				extends: './vite.config.ts',
				test: {
					name: 'rls',
					environment: 'node',
					include: ['tests/rls/**/*.test.ts'],
					testTimeout: 30000,
					hookTimeout: 30000,
					fileParallelism: false
				}
			},

			// Sits beside 'rls' rather than inside 'server' for the same reason that
			// one does: it talks to the running local stack, so it needs the longer
			// timeouts and has no business running as part of a pure unit sweep.
			{
				extends: './vite.config.ts',
				test: {
					name: 'auth',
					environment: 'node',
					include: ['tests/auth/**/*.test.ts'],
					testTimeout: 30000,
					hookTimeout: 30000,
					fileParallelism: false
				}
			},

			// The query layer in src/lib/data, driven with a real SupabaseClient
			// against the running local stack. Same shape as 'rls' and 'auth', and
			// serial for the same reason: these files create and destroy accounts,
			// and reading a row back as `postgres` while another file is writing is
			// a race nobody needs.
			{
				extends: './vite.config.ts',
				test: {
					name: 'data',
					environment: 'node',
					include: ['tests/data/**/*.test.ts'],
					testTimeout: 30000,
					hookTimeout: 30000,
					fileParallelism: false
				}
			}
		]
	}
});
