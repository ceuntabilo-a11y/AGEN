create policy clients_self_read on public.clients for select using (user_id = auth.uid());
create policy clients_self_update on public.clients for update using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy appointments_client_read on public.appointments for select
using (exists (select 1 from public.clients c where c.id = client_id and c.user_id = auth.uid()));

create policy memory_client_read on public.client_memory for select
using (exists (select 1 from public.clients c where c.id = client_id and c.user_id = auth.uid()));

create policy portfolio_public_read on public.portfolio_items for select using (published and client_consent);
create policy services_public_read on public.services for select using (active);
create policy specialties_public_read on public.specialties for select using (active);
create policy professionals_public_read on public.professionals for select using (active);
create policy businesses_client_read on public.businesses for select
using (exists (select 1 from public.clients c where c.business_id = businesses.id and c.user_id = auth.uid()));
create policy branches_client_read on public.branches for select
using (exists (select 1 from public.clients c where c.business_id = branches.business_id and c.user_id = auth.uid()));

comment on policy appointments_client_read on public.appointments is 'El cliente ve sus reservas; cambios pasan por funciones seguras y políticas del negocio.';
