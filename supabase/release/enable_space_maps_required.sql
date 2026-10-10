-- Apply through Supabase migrations immediately AFTER the updated forms are published.
-- This switch is server-owned; clients cannot bypass the required field after activation.
create or replace function public.space_maps_required()
returns boolean language sql stable set search_path=public as $$ select true $$;
notify pgrst, 'reload schema';
