-- PURSUE DIRECTORY: DETAILED SETUP
--
-- Follow these steps in order. This setup uses manually shared, one-time
-- invitation links, so you do not need an email provider, SMTP, or Supabase
-- Auth email/redirect settings.
--
-- Before starting:
--   * Make sure you have access to the Supabase project with ref
--     bvstmtteutzfwqdiovrm and to the Git branch that deploys the Render site.
--   * Do not paste passwords, service-role keys, or invitation links into
--     source files, commits, screenshots, or public messages.
--
-- STEP 1 - Create/update the database objects
--   1. Open https://supabase.com/dashboard and select project
--      bvstmtteutzfwqdiovrm.
--   2. Open SQL Editor and choose New query.
--   3. Copy the entire contents of this file into the query editor and click
--      Run. Wait for the query to finish and check the Results panel for errors.
--      Running this script again is safe for the included table/column setup;
--      it does not set or reveal either password.
--
-- STEP 2 - Set the directory and editor passwords
--   1. Copy the password SQL example below into a separate SQL Editor query,
--      removing the leading "--" comment markers from every SQL line.
--   2. Replace both placeholders with two different, strong passwords, then
--      run that query. The database stores password hashes, not the raw values.
--   3. Save both passwords securely. Members use the directory password when
--      signing in; editors also use the editor password for editing/inviting.
--      Running the example again changes both passwords for everyone.
--   If a password contains a single quote, double that quote inside the SQL
--   literal, for example O'Hare must be written as O''Hare.
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
-- To change only the editor password later, run this separately after replacing
-- the placeholder with the new editor password:
-- update public.directory_settings
-- set edit_password_hash = extensions.crypt('<NEW EDITOR PASSWORD>', extensions.gen_salt('bf', 12)),
--     updated_at = now()
-- where id = true;
--
-- STEP 3 - Configure and deploy the Edge Function
--   1. Install the Supabase CLI using Supabase's official Windows instructions.
--   2. Open PowerShell in the repository root and sign in:
--        supabase login
--   3. Link this checkout to the project (the project ref is shown above):
--        supabase link --project-ref bvstmtteutzfwqdiovrm
--   4. In the Supabase Dashboard, open Edge Functions > Secrets (or the
--      equivalent secrets page in Project Settings) and add
--      SUPABASE_SERVICE_ROLE_KEY with the project's current
--      service-role/secret key. If a key was previously exposed, rotate it
--      before saving the replacement. Never put this key in app.js or commit it.
--   5. From the repository root, deploy the function:
--        supabase functions deploy pursue-directory
--      SUPABASE_URL is provided automatically by Supabase. APP_ORIGIN defaults
--      to https://pursuedirectory-leaders.onrender.com; if you set it yourself,
--      use that exact origin with no trailing slash.
--
-- STEP 4 - Publish the website
--   1. In app.js, SUPABASE_URL and SUPABASE_ANON_KEY must identify this same
--      Supabase project. The publishable/anon key may be used in the website;
--      never substitute the service-role key. If you use another Supabase
--      project, also update the Supabase hostnames in index.html's Content
--      Security Policy and preconnect link.
--   2. If Render deploys from Git, commit and push the changed website files
--      to the configured branch. Otherwise use your usual Render deployment
--      method. Wait for the deployment to finish.
--   3. Confirm the site opens at
--      https://pursuedirectory-leaders.onrender.com before creating the first
--      invitation.
--
-- STEP 5 - Create the first administrator's setup link
--   1. Copy the bootstrap query below into a new SQL Editor query, removing
--      the leading "--" comment markers from every SQL line.
--   2. Replace <FIRST_ADMIN_EMAIL> with the administrator's real email address.
--      Keep the surrounding single quotes and run only this query.
--   3. Copy the invitation_link returned in Results and send it privately to
--      that person. The link expires in seven days and can be used once.
--   4. The recipient opens the link on the device/browser where they want their
--      passkey, registers it, then signs in with their email, directory password,
--      and passkey.
--
-- STEP 6 - Invite additional members
--   After the first administrator signs in, open the directory's member
--   management area, enter a member's email, and choose Create invite link.
--   Copy the link and share it privately. Creating a replacement link revokes
--   that member's previous unused link. No email is sent automatically.
--
-- To revoke a member's access, delete their row from public.directory_accounts
-- using their email in the SQL Editor. This also removes their passkeys,
-- invitations, and sessions; this action cannot be undone.
-- Example (replace the placeholder, remove the leading "--", then run):
-- delete from public.directory_accounts
-- where email = lower('<MEMBER_EMAIL>');
--

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

create table if not exists public.directory_accounts (
  user_id uuid primary key default gen_random_uuid(),
  email text not null unique,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.directory_accounts
  drop constraint if exists directory_accounts_user_id_fkey;

alter table public.directory_accounts
  alter column user_id set default gen_random_uuid();

create table if not exists public.directory_passkeys (
  credential_id text primary key,
  user_id uuid not null references public.directory_accounts (user_id) on delete cascade,
  public_key text not null,
  counter bigint not null default 0,
  transports text[] not null default array[]::text[],
  created_at timestamptz not null default now()
);

create index if not exists directory_passkeys_user_id_idx
  on public.directory_passkeys (user_id);

create table if not exists public.directory_invitations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.directory_accounts (user_id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_by uuid references public.directory_accounts (user_id) on delete set null,
  created_at timestamptz not null default now()
);

-- Bootstrap the first directory account after running this script. Replace the
-- email, run this query, and privately share the returned link with that person:
-- with new_account as (
--   insert into public.directory_accounts (email)
--   values (lower('<FIRST_ADMIN_EMAIL>'))
--   on conflict (email) do update set is_active = true
--   returning user_id
-- ),
-- new_token as (
--   select encode(extensions.gen_random_bytes(32), 'hex') as token
-- ),
-- new_invitation as (
--   insert into public.directory_invitations (user_id, token_hash, expires_at)
--   select new_account.user_id,
--          encode(extensions.digest(new_token.token, 'sha256'), 'hex'),
--          now() + interval '7 days'
--   from new_account cross join new_token
--   returning id
-- )
-- select 'https://pursuedirectory-leaders.onrender.com/#invite=' || new_token.token
--   as invitation_link
-- from new_token cross join new_invitation;
-- After that person registers a passkey and signs in, editors can invite others
-- from the directory's member-management screen.
-- To revoke access, delete their row from public.directory_accounts; their
-- passkeys, invitations, and sessions are removed automatically.

create table if not exists public.directory_passkey_challenges (
  id uuid primary key default gen_random_uuid(),
  challenge text not null,
  challenge_type text not null check (challenge_type in ('registration', 'authentication')),
  user_id uuid references public.directory_accounts (user_id) on delete cascade,
  invitation_id uuid references public.directory_invitations (id) on delete cascade,
  email text,
  expires_at timestamptz not null
);

alter table public.directory_passkey_challenges
  add column if not exists invitation_id uuid references public.directory_invitations (id) on delete cascade;

create table if not exists public.directory_sessions (
  token_hash text primary key,
  user_id uuid not null references public.directory_accounts (user_id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

alter table public.directory_accounts enable row level security;
alter table public.directory_passkeys enable row level security;
alter table public.directory_invitations enable row level security;
alter table public.directory_passkey_challenges enable row level security;
alter table public.directory_sessions enable row level security;

revoke all on public.directory_accounts from anon, authenticated;
revoke all on public.directory_passkeys from anon, authenticated;
revoke all on public.directory_invitations from anon, authenticated;
revoke all on public.directory_passkey_challenges from anon, authenticated;
revoke all on public.directory_sessions from anon, authenticated;
grant all on public.directory_accounts to service_role;
grant all on public.directory_passkeys to service_role;
grant all on public.directory_invitations to service_role;
grant all on public.directory_passkey_challenges to service_role;
grant all on public.directory_sessions to service_role;

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
