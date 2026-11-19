-- A new account arrives with one journal, so the first thing somebody writes
-- does not have to begin with a decision about where it goes.
--
-- This extends fn_handle_new_user rather than adding a second trigger. Both
-- rows belong to the same moment, and one function means one place to read for
-- what a new account is made of. Atomicity is the same either way: an error
-- raised in an AFTER INSERT trigger on auth.users aborts the insert, so a
-- failure here fails the signup whether it lives in one function or two.
--
-- Everything about the function's security posture is restated below rather
-- than assumed. CREATE OR REPLACE does carry the owner and the privileges
-- across — but it carries whatever they happen to be, which is not the same as
-- stating what they must be, and SECURITY DEFINER and search_path are part of
-- the replacement text and would be silently dropped if left out. The signature
-- is unchanged, so this replaces in place rather than creating a second
-- overload and no DROP FUNCTION is needed.
--
-- The journal takes the column defaults for colour (#1A56DB) and icon (book)
-- and leaves description NULL, so changing those defaults reaches new accounts
-- without touching this function.

CREATE OR REPLACE FUNCTION public.fn_handle_new_user()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.profiles (user_id, full_name)
  VALUES (
    NEW.id,
    COALESCE(
      NEW.raw_user_meta_data->>'full_name',
      NEW.raw_user_meta_data->>'name',
      ''
    )
  );

  INSERT INTO public.journals (user_id, title)
  VALUES (NEW.id, 'Journal');

  RETURN NEW;
END;
$function$;

ALTER FUNCTION public.fn_handle_new_user() OWNER TO postgres;

REVOKE EXECUTE ON FUNCTION public.fn_handle_new_user() FROM PUBLIC, anon, authenticated;
