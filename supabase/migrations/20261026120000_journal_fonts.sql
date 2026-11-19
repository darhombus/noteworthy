-- A font and a text size for each journal's entries (PRD 14, Section 1).
--
-- Two columns, both additive: every existing journal, and every journal created
-- by code that does not know about them (`main`'s createJournal, the signup
-- trigger's default journal), takes the defaults, which draw entries exactly as
-- they were drawn before. `main` names its columns on insert, update and select,
-- so nothing it sends or reads changes.
--
-- CHECKs list the values, unlike `color` and `icon` (20260918140000), which hold
-- keys the app validates and the database does not. Here the set is decided by
-- the PRD, so adding or removing a font is a migration: drop the constraint and
-- add it again with the new list. The app still draws any value it does not
-- know as Default and Normal ($lib/journals/fonts), so a row written before a
-- font is removed from the app never breaks a page.
--
-- No trigger changes. fn_journals_set_updated_at stamps updated_at only when
-- title, description, color, icon or a counter moves, and these two are not in
-- its list, so changing a journal's font or size does not move it up the
-- journals list (ordered by updated_at DESC): it is a reading preference, not
-- an edit. The other triggers on journals fire on is_hidden and deleted_at only.

ALTER TABLE public.journals
  ADD COLUMN font text NOT NULL DEFAULT 'default'
    CONSTRAINT journals_font_check CHECK (font IN (
      'default', 'inter', 'atkinson-hyperlegible', 'opendyslexic', 'lora',
      'merriweather', 'literata', 'eb-garamond', 'jetbrains-mono', 'caveat',
      'dancing-script'
    )),
  ADD COLUMN text_size text NOT NULL DEFAULT 'normal'
    CONSTRAINT journals_text_size_check CHECK (text_size IN ('small', 'normal', 'big'));

-- Column grants add to the lists in 20260921120000_narrow_client_writes; they
-- take nothing away, so updated_at stays in the UPDATE grant.
GRANT INSERT (font, text_size) ON public.journals TO anon, authenticated;
GRANT UPDATE (font, text_size) ON public.journals TO anon, authenticated;

COMMENT ON COLUMN public.journals.font IS
  'The font of this journal''s entries: a key from src/lib/journals/fonts.ts. '
  '''default'' is the entry font the app always had and downloads nothing.';

COMMENT ON COLUMN public.journals.text_size IS
  'The text size of this journal''s entries: small (16px), normal (18px) or '
  'big (20px). See src/lib/journals/fonts.ts.';
