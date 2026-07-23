-- Season Check-In tool: "ready to advance" + extension requests.
-- Mirrors the drafts / draft_participants pattern already used by this app.
-- Run this once in the Supabase SQL editor (Project > SQL Editor > New query).

create table if not exists public.seasons (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  season_data jsonb not null,
  is_joinable boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.season_participants (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.seasons(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  player_name text not null,
  role text not null check (role in ('host', 'participant')),
  created_at timestamptz not null default now(),
  unique (season_id, player_name),
  unique (season_id, user_id)
);

alter table public.seasons enable row level security;
alter table public.season_participants enable row level security;

-- Any signed-in user can look up a season by id (needed for shareable room
-- links), but only the owner can create/update/delete it.
create policy "seasons_select_authenticated"
  on public.seasons for select
  to authenticated
  using (true);

create policy "seasons_insert_owner"
  on public.seasons for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "seasons_update_owner"
  on public.seasons for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "seasons_delete_owner"
  on public.seasons for delete
  to authenticated
  using (user_id = auth.uid());

-- Any signed-in user can see who has claimed which player slot, claim an
-- open slot for themselves, leave their own slot, or (if they're the season
-- host) remove someone else's claim.
create policy "season_participants_select_authenticated"
  on public.season_participants for select
  to authenticated
  using (true);

create policy "season_participants_insert_self"
  on public.season_participants for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "season_participants_delete_self_or_host"
  on public.season_participants for delete
  to authenticated
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.seasons
      where seasons.id = season_participants.season_id
        and seasons.user_id = auth.uid()
    )
  );

-- Enable realtime so the room page's postgres_changes subscriptions fire.
alter publication supabase_realtime add table public.seasons;
alter publication supabase_realtime add table public.season_participants;
