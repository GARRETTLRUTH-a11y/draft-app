-- Links a Discord account to an app account, so a click on the "I'm
-- Ready" button (or the /link slash command) in Discord can be tied back
-- to a real, authenticated app user. Run this once in the Supabase SQL
-- editor.

create table if not exists public.discord_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  discord_user_id text not null,
  discord_username text,
  linked_at timestamptz not null default now(),
  unique (user_id),
  unique (discord_user_id)
);

-- Short-lived one-time tokens created by the /link slash command
-- (identifies the Discord user, nothing else) and redeemed by
-- /api/discord/link once the person clicks the magic link while signed
-- into the app. Never touched directly by client-side RLS -- only the
-- service role (used by the interactions route and the link route) reads
-- or writes this table, so no policies grant client access.
create table if not exists public.discord_link_tokens (
  token text primary key,
  discord_user_id text not null,
  discord_username text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

alter table public.discord_links enable row level security;
alter table public.discord_link_tokens enable row level security;

-- A signed-in user can see and manage only their own link. Anyone can
-- also look up who claims to have linked which team (season room shows
-- "linked" status for every player), so select is broad like the other
-- season tables.
create policy "discord_links_select_authenticated"
  on public.discord_links for select
  to authenticated
  using (true);

create policy "discord_links_delete_self"
  on public.discord_links for delete
  to authenticated
  using (user_id = auth.uid());

-- No insert/update policy: linking always goes through /api/discord/link
-- (service role), which validates the one-time token first. This keeps a
-- user from just inserting an arbitrary discord_user_id for themselves.
