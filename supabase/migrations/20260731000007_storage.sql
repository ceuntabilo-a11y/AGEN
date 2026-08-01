insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types) values
('portfolio','portfolio',true,10485760,array['image/jpeg','image/png','image/webp']),
('business-assets','business-assets',true,5242880,array['image/jpeg','image/png','image/webp','image/svg+xml'])
on conflict (id) do nothing;

drop policy if exists portfolio_images_public_read on storage.objects;
drop policy if exists portfolio_images_member_insert on storage.objects;
drop policy if exists portfolio_images_member_update on storage.objects;
drop policy if exists portfolio_images_member_delete on storage.objects;
drop policy if exists business_assets_public_read on storage.objects;
drop policy if exists business_assets_member_insert on storage.objects;
drop policy if exists business_assets_member_update on storage.objects;
drop policy if exists business_assets_member_delete on storage.objects;

create policy portfolio_images_public_read on storage.objects for select using (bucket_id='portfolio');
create policy portfolio_images_member_insert on storage.objects for insert to authenticated
with check (bucket_id='portfolio' and public.is_business_member(((storage.foldername(name))[1])::uuid));
create policy portfolio_images_member_update on storage.objects for update to authenticated
using (bucket_id='portfolio' and public.is_business_member(((storage.foldername(name))[1])::uuid));
create policy portfolio_images_member_delete on storage.objects for delete to authenticated
using (bucket_id='portfolio' and public.is_business_member(((storage.foldername(name))[1])::uuid));

create policy business_assets_public_read on storage.objects for select using (bucket_id='business-assets');
create policy business_assets_member_insert on storage.objects for insert to authenticated
with check (bucket_id='business-assets' and public.is_business_member(((storage.foldername(name))[1])::uuid));
create policy business_assets_member_update on storage.objects for update to authenticated
using (bucket_id='business-assets' and public.is_business_member(((storage.foldername(name))[1])::uuid));
create policy business_assets_member_delete on storage.objects for delete to authenticated
using (bucket_id='business-assets' and public.is_business_member(((storage.foldername(name))[1])::uuid));
