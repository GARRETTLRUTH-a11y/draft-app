-- Fixes claim transfer on season import: the original
-- "season_participants_insert_self" policy only lets a row's own user_id
-- insert it, so when a host bulk-copies draft_participants -> season_participants
-- for OTHER users during import, every row but the host's own is silently
-- rejected by RLS (the whole insert fails, since it's one statement).
--
-- This adds a second, OR'd insert policy: the season host can insert a
-- season_participants row for anyone, as long as it's their own season.
-- Run this once in the Supabase SQL editor.

drop policy if exists "season_participants_insert_owner" on public.season_participants;

create policy "season_participants_insert_owner"
  on public.season_participants for insert
  to authenticated
  with check (
    exists (
      select 1 from public.seasons
      where seasons.id = season_participants.season_id
        and seasons.user_id = auth.uid()
    )
  );
