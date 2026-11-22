-- China 2026 · álbum de fotos (rode depois do schema.sql; pode rodar de novo)
-- Fotos ficam num bucket PRIVADO ("fotos"): só viajantes logados veem; cada um envia e apaga só as suas.

create table if not exists public.photos (
  id uuid primary key default gen_random_uuid(),
  path text not null,
  thumb text not null,
  day text,
  caption text default '',
  w int, h int,
  author uuid not null default auth.uid() references auth.users on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.photos enable row level security;
drop policy if exists "viajantes veem fotos" on public.photos;
create policy "viajantes veem fotos" on public.photos for select using (public.is_traveler());
drop policy if exists "viajantes enviam fotos" on public.photos;
create policy "viajantes enviam fotos" on public.photos for insert with check (public.is_traveler() and author = auth.uid());
drop policy if exists "cada um edita as suas fotos" on public.photos;
create policy "cada um edita as suas fotos" on public.photos for update using (author = auth.uid()) with check (author = auth.uid());
drop policy if exists "cada um apaga as suas fotos" on public.photos;
create policy "cada um apaga as suas fotos" on public.photos for delete using (author = auth.uid());
grant select, insert, update, delete on public.photos to authenticated;
grant all on public.photos to service_role;
do $$ begin
  alter publication supabase_realtime add table public.photos;
exception when duplicate_object then null; end $$;

-- bucket privado, só JPEG, até 6 MB por arquivo (o app reduz as fotos antes de enviar)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('fotos', 'fotos', false, 6291456, array['image/jpeg'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "fotos: viajantes veem" on storage.objects;
create policy "fotos: viajantes veem" on storage.objects for select to authenticated
  using (bucket_id = 'fotos' and public.is_traveler());
drop policy if exists "fotos: cada um envia na sua pasta" on storage.objects;
create policy "fotos: cada um envia na sua pasta" on storage.objects for insert to authenticated
  with check (bucket_id = 'fotos' and public.is_traveler() and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "fotos: cada um apaga as suas" on storage.objects;
create policy "fotos: cada um apaga as suas" on storage.objects for delete to authenticated
  using (bucket_id = 'fotos' and (storage.foldername(name))[1] = auth.uid()::text);

-- aviso de fotos novas (a função "push" junta: "Fulano adicionou 5 fotos")
create or replace function public.queue_photo() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.notify_queue (edit_id, author, op, body) values ('photo:' || new.id, new.author, 'PHOTO', jsonb_build_object('day', new.day));
  return new;
end $$;
drop trigger if exists photos_notify on public.photos;
create trigger photos_notify after insert on public.photos for each row execute function public.queue_photo();
