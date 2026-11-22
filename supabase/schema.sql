-- China 2026 · estrutura do banco no Supabase
-- Rode uma vez no SQL Editor do projeto (Run). Pode rodar de novo sem estragar nada.

-- 1) Lista de viajantes: só estes e-mails conseguem criar conta e ver o roteiro
create table if not exists public.allowed_emails (email text primary key);
alter table public.allowed_emails enable row level security;  -- ninguém lê pelo app

create or replace function public.is_traveler() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.allowed_emails a where a.email = lower(coalesce(auth.jwt() ->> 'email', '')));
$$;

create or replace function public.check_allowed_email() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.allowed_emails where email = lower(new.email)) then
    raise exception 'E-mail fora da lista de viajantes';
  end if;
  return new;
end $$;
drop trigger if exists check_allowed_email on auth.users;
create trigger check_allowed_email before insert on auth.users
  for each row execute function public.check_allowed_email();

-- 2) Perfis (nome, cor e preferências de notificação)
create table if not exists public.profiles (
  id uuid primary key references auth.users on delete cascade,
  name text,
  color text default '#2C7660',
  settings jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
drop policy if exists "viajantes leem perfis" on public.profiles;
create policy "viajantes leem perfis" on public.profiles for select using (public.is_traveler());
drop policy if exists "cada um edita o seu perfil" on public.profiles;
create policy "cada um edita o seu perfil" on public.profiles for update using (id = auth.uid()) with check (id = auth.uid());

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, name)
  values (new.id, coalesce(nullif(new.raw_user_meta_data ->> 'name', ''), split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- 3) Roteiro base (carregado pelo arquivo de carga, que NÃO fica no GitHub)
create table if not exists public.trip (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.trip enable row level security;
drop policy if exists "viajantes leem o roteiro" on public.trip;
create policy "viajantes leem o roteiro" on public.trip for select using (public.is_traveler());

-- 4) Edições dos viajantes (itens novos, ajustes, ocultos, feitos)
create table if not exists public.edits (
  id text primary key,
  body jsonb not null,
  author uuid references auth.users on delete set null,
  updated_at timestamptz not null default now()
);
alter table public.edits enable row level security;
drop policy if exists "viajantes leem edicoes" on public.edits;
create policy "viajantes leem edicoes" on public.edits for select using (public.is_traveler());
drop policy if exists "viajantes criam edicoes" on public.edits;
create policy "viajantes criam edicoes" on public.edits for insert with check (public.is_traveler() and author = auth.uid());
drop policy if exists "viajantes mudam edicoes" on public.edits;
create policy "viajantes mudam edicoes" on public.edits for update using (public.is_traveler()) with check (public.is_traveler() and author = auth.uid());
drop policy if exists "viajantes apagam edicoes" on public.edits;
create policy "viajantes apagam edicoes" on public.edits for delete using (public.is_traveler());

-- tempo real: o app recebe as mudanças dos outros na hora
do $$ begin
  alter publication supabase_realtime add table public.edits;
exception when duplicate_object then null; end $$;

-- 5) Notificações: aparelhos inscritos, fila de alterações e registro do que já foi enviado
create table if not exists public.push_subs (
  endpoint text primary key,
  user_id uuid not null references auth.users on delete cascade,
  sub jsonb not null,
  device text,
  created_at timestamptz not null default now()
);
alter table public.push_subs enable row level security;
drop policy if exists "cada um cuida dos seus aparelhos" on public.push_subs;
create policy "cada um cuida dos seus aparelhos" on public.push_subs for all
  using (user_id = auth.uid()) with check (user_id = auth.uid() and public.is_traveler());

create table if not exists public.notify_queue (
  id bigserial primary key,
  edit_id text not null,
  author uuid,
  op text not null,
  body jsonb,
  old jsonb,
  created_at timestamptz not null default now()
);
alter table public.notify_queue enable row level security;  -- só a função de envio lê

create table if not exists public.notif_log (
  key text primary key,
  sent_at timestamptz not null default now()
);
alter table public.notif_log enable row level security;

create or replace function public.queue_edit_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    insert into public.notify_queue (edit_id, author, op, body, old) values (old.id, auth.uid(), 'DELETE', null, old.body);
    return old;
  end if;
  insert into public.notify_queue (edit_id, author, op, body, old)
  values (new.id, new.author, tg_op, new.body, case when tg_op = 'UPDATE' then old.body end);
  return new;
end $$;
drop trigger if exists edits_notify on public.edits;
create trigger edits_notify after insert or update or delete on public.edits
  for each row execute function public.queue_edit_change();
