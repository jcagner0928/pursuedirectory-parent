-- Pursue password-only directory setup.
-- Run this in Supabase Dashboard > SQL Editor before deploying the Edge Function.
--
-- This creates a password HASH table; the raw shared password is never stored
-- or exposed to the browser. After running this script, set the password using
-- the SQL statement in the comments below (replace the placeholder with a new,
-- strong password first):
--
-- insert into public.directory_settings (id, password_hash, edit_password_hash)
-- values (
--   true,
--   extensions.crypt('<CHOOSE A DIRECTORY PASSWORD>', extensions.gen_salt('bf', 12)),
--   extensions.crypt('<CHOOSE A DIFFERENT EDITOR PASSWORD>', extensions.gen_salt('bf', 12))
-- )
-- on conflict (id) do update
--   set password_hash = excluded.password_hash,
--       edit_password_hash = excluded.edit_password_hash,
--       updated_at = now();
--
-- To rotate only the editor password later:
-- update public.directory_settings
-- set edit_password_hash = extensions.crypt('<NEW EDITOR PASSWORD>', extensions.gen_salt('bf', 12)),
--     updated_at = now()
-- where id = true;
--
-- Do not put a Supabase secret/service-role key or the shared password in the
-- website source. Configure SUPABASE_SERVICE_ROLE_KEY as an Edge Function
-- secret instead.
--
-- Deploy from the repository root after installing the Supabase CLI and linking
-- this project. Use a newly rotated service-role key; the previously shared
-- secret should be considered compromised:
--   supabase link --project-ref bvstmtteutzfwqdiovrm
--   supabase secrets set SUPABASE_SERVICE_ROLE_KEY=<NEW_SERVICE_ROLE_KEY>
--   supabase functions deploy pursue-directory
--
-- SUPABASE_URL is provided automatically in the Edge Function environment.
-- Replace SUPABASE_ANON_KEY in index.html with the matching project's valid
-- publishable key before using the website.

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.directory_settings (
  id boolean primary key default true check (id),
  password_hash text not null,
  edit_password_hash text,
  updated_at timestamptz not null default now()
);

alter table public.directory_settings
  add column if not exists edit_password_hash text;

alter table public.directory_settings
  add column if not exists teams text[] default array[
    'Worship Team',
    'Tech Team',
    'Outreach Team',
    'Prayer Team',
    'Craft Team',
    'T-shirt Team'
  ]::text[];

alter table public.directory_settings enable row level security;
revoke all on public.directory_settings from anon, authenticated;
grant all on public.directory_settings to service_role;

create table if not exists public.directory_login_attempts (
  ip_hash text primary key,
  window_started_at timestamptz not null default now(),
  attempts integer not null default 0
);

alter table public.directory_login_attempts enable row level security;
revoke all on public.directory_login_attempts from anon, authenticated;
grant all on public.directory_login_attempts to service_role;

create or replace function public.verify_directory_password(
  p_password text,
  p_ip_hash text
)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  attempt_count integer;
  stored_hash text;
  is_valid boolean;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'forbidden';
  end if;

  insert into public.directory_login_attempts (ip_hash, attempts)
  values (p_ip_hash, 1)
  on conflict (ip_hash) do update
    set attempts = case
          when directory_login_attempts.window_started_at < now() - interval '15 minutes' then 1
          else directory_login_attempts.attempts + 1
        end,
        window_started_at = case
          when directory_login_attempts.window_started_at < now() - interval '15 minutes' then now()
          else directory_login_attempts.window_started_at
        end
  returning attempts into attempt_count;

  if attempt_count > 10 then
    raise exception 'too many password attempts; try again later';
  end if;

  select password_hash into stored_hash
  from public.directory_settings
  where id = true;

  if stored_hash is null then
    return false;
  end if;

  is_valid := stored_hash = extensions.crypt(p_password, stored_hash);
  if is_valid then
    delete from public.directory_login_attempts where ip_hash = p_ip_hash;
  end if;
  return is_valid;
end;
$$;

revoke all on function public.verify_directory_password(text, text) from public, anon, authenticated;
grant execute on function public.verify_directory_password(text, text) to service_role;

create table if not exists public.directory_edit_login_attempts (
  ip_hash text primary key,
  window_started_at timestamptz not null default now(),
  attempts integer not null default 0
);

alter table public.directory_edit_login_attempts enable row level security;
revoke all on public.directory_edit_login_attempts from anon, authenticated;
grant all on public.directory_edit_login_attempts to service_role;

create or replace function public.verify_directory_edit_password(
  p_password text,
  p_ip_hash text
)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  attempt_count integer;
  stored_hash text;
  is_valid boolean;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'forbidden';
  end if;

  insert into public.directory_edit_login_attempts (ip_hash, attempts)
  values (p_ip_hash, 1)
  on conflict (ip_hash) do update
    set attempts = case
          when directory_edit_login_attempts.window_started_at < now() - interval '15 minutes' then 1
          else directory_edit_login_attempts.attempts + 1
        end,
        window_started_at = case
          when directory_edit_login_attempts.window_started_at < now() - interval '15 minutes' then now()
          else directory_edit_login_attempts.window_started_at
        end
  returning attempts into attempt_count;

  if attempt_count > 10 then
    raise exception 'too many password attempts; try again later';
  end if;

  select edit_password_hash into stored_hash
  from public.directory_settings
  where id = true;

  if stored_hash is null then
    return false;
  end if;

  is_valid := stored_hash = extensions.crypt(p_password, stored_hash);
  if is_valid then
    delete from public.directory_edit_login_attempts where ip_hash = p_ip_hash;
  end if;
  return is_valid;
end;
$$;

revoke all on function public.verify_directory_edit_password(text, text) from public, anon, authenticated;
grant execute on function public.verify_directory_edit_password(text, text) to service_role;

create table if not exists public.people (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 1 and 200),
  email text,
  phone text,
  grade text not null default 'Other'
    check (grade in ('7th grade', '8th grade', 'Freshman', 'Sophomore', 'Junior', 'Senior', 'Adult', 'Other')),
  roles text[] check (
    roles is null or roles <@ array['Teacher', 'Parent', 'Volunteer']::text[]
  ),
  photo_path text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint people_require_contact check (
    nullif(trim(email), '') is not null
    or nullif(trim(phone), '') is not null
  )
);

alter table public.people
  add column if not exists created_by uuid references auth.users (id) on delete set null;
alter table public.people
  add column if not exists grade text not null default 'Other'
  check (grade in ('7th grade', '8th grade', 'Freshman', 'Sophomore', 'Junior', 'Senior', 'Adult', 'Other'));
alter table public.people
  add column if not exists roles text[]
  check (roles is null or roles <@ array['Teacher', 'Parent', 'Volunteer']::text[]);
alter table public.people
  add column if not exists emergency_contact_name text;
alter table public.people
  add column if not exists emergency_contact_phone text;
alter table public.people
  add column if not exists emergency_contact_relationship text;
alter table public.people
  add column if not exists teams text[] default array[]::text[];
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'people' and column_name = 'role'
  ) then
    execute 'update public.people set roles = array[role] where roles is null and role is not null';
  end if;
end;
$$;
alter table public.people alter column created_by drop not null;
alter table public.people enable row level security;
revoke all on public.people from anon, authenticated;
grant all on public.people to service_role;

drop policy if exists "Signed-in members can view people" on public.people;
drop policy if exists "Members can add people" on public.people;

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'pursue-people',
  'pursue-people',
  false,
  20971520,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Signed-in members can view Pursue photos" on storage.objects;
drop policy if exists "Members can upload their own Pursue photos" on storage.objects;
drop policy if exists "Members can remove their own Pursue photos" on storage.objects;
