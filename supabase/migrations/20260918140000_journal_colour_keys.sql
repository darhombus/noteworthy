-- journals.color holds a key, not a colour.
--
-- The column arrived from the old project holding a hex literal — '#1A56DB' as
-- the default, and one of eight hexes otherwise — which the app then matched
-- against a table to find a background and a label. That makes the database the
-- place a palette change has to happen, and it puts a presentation value in a
-- column that only ever needed an identifier.
--
-- journals.icon already worked the right way round: its default is 'book', a
-- name the app maps to a component. This makes colour match it. The eight keys
-- are blue, green, purple, orange, teal, red, indigo and amber, and the mapping
-- from each to its Tailwind classes lives in src/lib/journals/appearance.ts.
--
-- No CHECK constraint. The set is a presentation decision that will change when
-- the palette does, and pinning it here means a migration every time a colour is
-- added or renamed. The form action validates against the same list, and a value
-- that somehow escapes it falls back to blue rather than rendering nothing —
-- deliberate, and recorded in the comment below.

ALTER TABLE public.journals
  ALTER COLUMN color SET DEFAULT 'blue';

-- The old default, on any row that still carries it. Every other hex in the old
-- palette is mapped by name in the same statement so a journal keeps the colour
-- its owner picked rather than being reset to blue.
UPDATE public.journals
   SET color = CASE color
                 WHEN '#1A56DB' THEN 'blue'
                 WHEN '#1976D2' THEN 'blue'
                 WHEN '#2E7D32' THEN 'green'
                 WHEN '#6A1B9A' THEN 'purple'
                 WHEN '#E65100' THEN 'orange'
                 WHEN '#00695C' THEN 'teal'
                 WHEN '#C62828' THEN 'red'
                 WHEN '#283593' THEN 'indigo'
                 WHEN '#F57F17' THEN 'amber'
                 ELSE color
               END
 WHERE color LIKE '#%';

COMMENT ON COLUMN public.journals.color IS
  'A palette key — blue, green, purple, orange, teal, red, indigo, amber — not '
  'a colour and not a class name. src/lib/journals/appearance.ts maps each key '
  'to its Tailwind classes and label. Unrecognised values are rendered as blue '
  'rather than failing, so removing a key from the palette degrades instead of '
  'breaking existing rows.';

COMMENT ON COLUMN public.journals.icon IS
  'An icon key — book, notebook, pen, sparkles, leaf, heart, star, compass — '
  'resolved to an inline SVG by src/lib/components/JournalIcon.svelte. '
  'Unrecognised values fall back to book.';
