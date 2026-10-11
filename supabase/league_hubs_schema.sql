-- Persistent league directory used by the CFB League Hub landing flow.
-- Run once in Supabase SQL Editor before using Create a League.

create table if not exists public.league_hubs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 2 and 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists league_hubs_name_idx
  on public.league_hubs (lower(name));

alter table public.league_hubs enable row level security;

-- League hubs are a signed-in directory: members can choose their league,
-- while only the commissioner who created a league may change or remove it.
drop policy if exists "league_hubs_select_authenticated" on public.league_hubs;
create policy "league_hubs_select_authenticated"
  on public.league_hubs for select
  to authenticated
  using (true);

drop policy if exists "league_hubs_insert_owner" on public.league_hubs;
create policy "league_hubs_insert_owner"
  on public.league_hubs for insert
  to authenticated
  with check (user_id = auth.uid());

drop policy if exists "league_hubs_update_owner" on public.league_hubs;
create policy "league_hubs_update_owner"
  on public.league_hubs for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "league_hubs_delete_owner" on public.league_hubs;
create policy "league_hubs_delete_owner"
  on public.league_hubs for delete
  to authenticated
  using (user_id = auth.uid());
