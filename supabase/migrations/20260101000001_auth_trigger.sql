-- Creates a profiles row whenever a user signs up. Lives on auth.users, so it
-- is NOT included in `supabase db dump` (which covers the public schema only).

CREATE OR REPLACE FUNCTION public.fn_handle_new_user()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.profiles (user_id, full_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', ''));
  RETURN NEW;
END;
$function$;

ALTER FUNCTION public.fn_handle_new_user() OWNER TO postgres;

REVOKE EXECUTE ON FUNCTION public.fn_handle_new_user() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.fn_handle_new_user();

-- ---------------------------------------------------------------------------
-- Event trigger: enable RLS on any new table in public.
-- Event triggers are database-wide rather than schema-scoped, so `supabase db
-- dump` carries the function body but not the trigger that fires it. Without
-- this statement rls_auto_enable() exists and never runs.
-- ---------------------------------------------------------------------------

DROP EVENT TRIGGER IF EXISTS ensure_rls;

CREATE EVENT TRIGGER ensure_rls
  ON ddl_command_end
  WHEN TAG IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
  EXECUTE FUNCTION public.rls_auto_enable();

REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon, authenticated;