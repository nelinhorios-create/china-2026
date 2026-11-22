-- China 2026 · álbuns de fotos (rode depois do fotos.sql; pode rodar de novo)
-- Qualquer viajante cria álbuns e coloca qualquer foto num álbum; só quem criou renomeia ou apaga o álbum
-- (apagar o álbum não apaga as fotos: elas voltam para "sem álbum").

create table if not exists public.albums (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 60),
  created_by uuid not null default auth.uid() references auth.users on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.albums enable row level security;
drop policy if exists "viajantes veem albuns" on public.albums;
create policy "viajantes veem albuns" on public.albums for select using (public.is_traveler());
drop policy if exists "viajantes criam albuns" on public.albums;
create policy "viajantes criam albuns" on public.albums for insert with check (public.is_traveler() and created_by = auth.uid());
drop policy if exists "quem criou renomeia" on public.albums;
create policy "quem criou renomeia" on public.albums for update using (created_by = auth.uid()) with check (created_by = auth.uid());
drop policy if exists "quem criou apaga" on public.albums;
create policy "quem criou apaga" on public.albums for delete using (created_by = auth.uid());
grant select, insert, update, delete on public.albums to authenticated;
grant all on public.albums to service_role;
do $$ begin
  alter publication supabase_realtime add table public.albums;
exception when duplicate_object then null; end $$;

alter table public.photos add column if not exists album_id uuid references public.albums (id) on delete set null;

-- colocar/tirar uma foto de um álbum (vale para fotos de qualquer viajante)
create or replace function public.set_photo_album(p_photo uuid, p_album uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_traveler() then raise exception 'sem permissao'; end if;
  update public.photos set album_id = p_album where id = p_photo;
  if p_album is not null then
    insert into public.notify_queue (edit_id, author, op, body)
    values ('photo:' || p_photo, auth.uid(), 'PHOTO_MOVE', jsonb_build_object('album', p_album));
  end if;
end $$;
revoke all on function public.set_photo_album(uuid, uuid) from public, anon;
grant execute on function public.set_photo_album(uuid, uuid) to authenticated;

-- avisos: álbum novo, fotos novas (com o álbum, se tiver)
create or replace function public.queue_album() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.notify_queue (edit_id, author, op, body) values ('album:' || new.id, new.created_by, 'ALBUM', jsonb_build_object('name', new.name, 'album', new.id));
  return new;
end $$;
drop trigger if exists albums_notify on public.albums;
create trigger albums_notify after insert on public.albums for each row execute function public.queue_album();

create or replace function public.queue_photo() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.notify_queue (edit_id, author, op, body)
  values ('photo:' || new.id, new.author, 'PHOTO', jsonb_build_object('day', new.day, 'album', new.album_id));
  return new;
end $$;
