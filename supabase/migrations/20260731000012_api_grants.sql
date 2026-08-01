-- Supabase roles need table privileges before row-level security policies apply.
grant usage on schema public to anon, authenticated, service_role;
grant select, insert, update, delete on all tables in schema public to authenticated, service_role;
grant usage, select on all sequences in schema public to authenticated, service_role;
grant execute on all functions in schema public to anon, authenticated, service_role;

grant select on public.businesses, public.branches, public.specialties,
  public.professionals, public.professional_specialties, public.services,
  public.professional_services, public.professional_availability,
  public.portfolio_items to anon;

alter default privileges in schema public grant select, insert, update, delete on tables to authenticated, service_role;
alter default privileges in schema public grant usage, select on sequences to authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
