-- Critical fix: players could never actually persist "ready to advance"
-- or extension requests. season_data lives entirely on the seasons row,
-- and the only UPDATE policy required user_id = auth.uid() (the host).
-- Every non-host write was silently rejected by RLS -- 0 rows matched,
-- no error thrown -- so the client's optimistic local update made it
-- LOOK like it worked in that one browser, while nothing was ever saved
-- to the database. This is why other players' "ready" clicks never
-- showed up for anyone, including themselves after a refresh.
--
-- This lets anyone who has claimed a team in the season (not just the
-- host) update season_data too. Run this once in the Supabase SQL editor.

drop policy if exists "seasons_update_owner" on public.seasons;
drop policy if exists "seasons_update_owner_or_participant" on public.seasons;

create policy "seasons_update_owner_or_participant"
  on public.seasons for update
  to authenticated
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.season_participants
      where season_participants.season_id = seasons.id
        and season_participants.user_id = auth.uid()
    )
  )
  with check (
    user_id = auth.uid()
    or exists (
      select 1 from public.season_participants
      where season_participants.season_id = seasons.id
        and season_participants.user_id = auth.uid()
    )
  );
