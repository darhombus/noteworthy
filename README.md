# Noteworthy

Noteworthy is a journaling web app. You keep several journals, write entries in a rich-text
editor that saves as you type, add photos, video and audio recordings, and search everything
you have written. Each account sees only its own journals and entries.

## Stack

- SvelteKit 2 and Svelte 5, in TypeScript
- Tailwind CSS 4
- TipTap 3 for the entry editor
- Supabase: Postgres with row-level security, Auth and Storage
- Deployed on Vercel

## Running it locally

You need Node 24 and Docker (the local Supabase stack runs in containers).

1. Install the dependencies, including the Supabase CLI: `npm install`
2. Start the local Supabase stack, which applies every migration in `supabase/migrations`:
   `npx supabase start`
3. Copy `.env.example` to `.env` and fill in `PUBLIC_SUPABASE_URL` (the local API,
   `http://127.0.0.1:54421`) and `PUBLIC_SUPABASE_PUBLISHABLE_KEY` (the publishable key that
   `npx supabase start` prints; `npx supabase status` shows it again).
4. Start the app: `npm run dev`, then open `http://localhost:5173`.

Emails the local stack sends, such as a password reset, arrive in Mailpit at
`http://127.0.0.1:54424`. `npm run check` type-checks the app and `npm run lint` runs Prettier
and ESLint.

The tests and internal docs are kept in a private repository; the public copy of this code
leaves them out.
