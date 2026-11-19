-- Widens the signup trigger's display-name lookup.
--
-- Email signup puts the name in `options.data.full_name`, so the function read
-- `raw_user_meta_data->>'full_name'` and nothing else. Google's OIDC profile
-- calls the same field `name`, so a Google user would have landed with an empty
-- `full_name` and no obvious cause. Trying both now means the provider can be
-- added later without a data backfill.
--
-- Everything else about the function is unchanged: still SECURITY DEFINER with
-- search_path pinned to public, still owned by postgres, EXECUTE still revoked
-- from PUBLIC, anon and authenticated. The signature is identical, so this
-- REPLACEs in place rather than creating a second overload.

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
  RETURN NEW;
END;
$function$;

ALTER FUNCTION public.fn_handle_new_user() OWNER TO postgres;

REVOKE EXECUTE ON FUNCTION public.fn_handle_new_user() FROM PUBLIC, anon, authenticated;
