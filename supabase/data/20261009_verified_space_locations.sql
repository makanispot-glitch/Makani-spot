-- Verified 2026-10-09 against Google's selected place pages, name + Sheikh Zayed.
-- Americana: next to Ezz Plaza, Sheikh Zayed; Trivium: Sheikh Zayed, tenants on Al Bustan.
-- Only maps_url changes (updated_at is managed by the existing trigger).
begin;
do $backfill$
declare v_hash text; v_units text; v_bookings text; v_rows integer;
begin
  select md5(string_agg((to_jsonb(s)-'maps_url'-'updated_at')::text,'|' order by id)) into v_hash from public.spaces s;
  select md5(string_agg(to_jsonb(u)::text,'|' order by id)) into v_units from public.space_units u;
  select md5(string_agg(to_jsonb(b)::text,'|' order by id)) into v_bookings from public.bookings b;
  update public.spaces set maps_url=case id
    when '5b154ac3-6d5d-442e-8fdb-22b9e10279b0'::uuid then 'https://www.google.com/maps/place/%D8%A3%D9%85%D8%B1%D9%8A%D9%83%D8%A7%D9%86%D8%A7+%D8%A8%D9%84%D8%A7%D8%B2%D8%A7+-+%D8%B2%D8%A7%D9%8A%D8%AF%E2%80%AD/@30.0275138,31.0132317,744m/data=!3m2!1e3!4b1!4m6!3m5!1s0x14585a6a5fac05e3:0x2d871f3c2b02f918!8m2!3d30.0275138!4d31.0132317!16s%2Fg%2F11gbgcp7_3?entry=ttu&g_ep=EgoyMDI2MTAwNi4wIKXMDSoASAFQAw%3D%3D'
    when '3e9188df-d76e-416f-9b7e-f31ea737605f'::uuid then 'https://www.google.com/maps/place/Trivium+Zayed/@30.0266787,31.2430653,47595m/data=!3m1!1e3!4m10!1m2!2m1!1sTrivium+Mall+Sheikh+Zayed!3m6!1s0x14585b3688e45d0b:0xb257d34095cb979b!8m2!3d30.0260235!4d31.0096028!15sChlUcml2aXVtIE1hbGwgU2hlaWtoIFpheWVkkgEPYnVzaW5lc3NfY2VudGVy4AEA!16s%2Fg%2F11h2gwmqz8?entry=ttu&g_ep=EgoyMDI2MTAwNi4wIKXMDSoASAFQAw%3D%3D'
  end
  where maps_url is null and not is_deleted and region='الشيخ زايد'
    and ((id='5b154ac3-6d5d-442e-8fdb-22b9e10279b0' and name='امريكانا بلازا')
      or (id='3e9188df-d76e-416f-9b7e-f31ea737605f' and name='Trivium Mall Sheikh Zayed'));
  get diagnostics v_rows=row_count;
  if v_rows<>2 then raise exception 'Expected exactly two verified locations, updated %',v_rows; end if;
  if v_hash is distinct from (select md5(string_agg((to_jsonb(s)-'maps_url'-'updated_at')::text,'|' order by id)) from public.spaces s)
    or v_units is distinct from (select md5(string_agg(to_jsonb(u)::text,'|' order by id)) from public.space_units u)
    or v_bookings is distinct from (select md5(string_agg(to_jsonb(b)::text,'|' order by id)) from public.bookings b) then
    raise exception 'Unrelated data changed; backfill rolled back';
  end if;
end;
$backfill$;
commit;
select count(*) as total_spaces,count(*) filter(where maps_url is not null) as mapped,
md5(string_agg((to_jsonb(s)-'maps_url'-'updated_at')::text,'|' order by id)) as spaces_core_hash from public.spaces s;
