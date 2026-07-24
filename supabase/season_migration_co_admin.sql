-- Adds a "co-admin" tier: someone the host designates who can toggle
-- other players' ready status, without getting the rest of Commissioner
-- Controls (season settings, advancing the week, extension approvals,
-- reminders, renaming/removing players, Discord posting).
--
-- Also fixes a real bug found along the way: season_participants never had
-- an UPDATE policy at all, so the existing "rename a player" feature has
-- been silently failing under RLS (same class of bug as the earlier
-- seasons-table one) -- 0 rows updated, no error surfaced. This adds that
-- policy too, scoped to the host only.

alter table public.season_participants
  add column if not exists is_co_admin boolean not null default false;

drop policy if exists "season_participants_update_host" on public.season_participants;

create policy "season_participants_update_host"
  on public.season_participants for update
  to authenticated
  using (
    exists (
      select 1 from public.seasons
      where seasons.id = season_participants.season_id
        and seasons.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.seasons
      where seasons.id = season_participants.season_id
        and seasons.user_id = auth.uid()
    )
  );
