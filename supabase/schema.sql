-- Catnap — online leaderboard for Supabase
-- Paste this whole file into Supabase → SQL Editor → New query → Run.
-- It is safe to run again: everything is created "if not exists" or replaced.
--
-- Security model
--   * Anyone can READ the public leaderboard view (names, times, scores).
--   * Nobody can write to the tables directly. The only way in is the
--     submit_score() function, which validates every submission:
--       - board ids must look right (daily-YYYY-MM-DD close to today,
--         level-1..60, or marathon-YYYY-Www for this, last or next week)
--       - for puzzles, the submitted cat positions must be a valid solution
--         of that exact board (Journey boards are stored here; a daily
--         board is fixed by its first valid submission)
--       - times / scores must be plausible, names are trimmed and limited
--       - at most 40 submissions per player per hour
--   * Player ids are never exposed; the view shows only a short hash.

create table if not exists public.boards (
  board      text primary key,
  regions    text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.scores (
  board      text not null,
  player     uuid not null,
  name       text not null,
  time_ms    integer,
  score      integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (board, player)
);
create index if not exists scores_by_time  on public.scores (board, time_ms);
create index if not exists scores_by_score on public.scores (board, score desc);
create index if not exists scores_by_player_recent on public.scores (player, updated_at);

-- one row per submission attempt, used only for rate limiting
create table if not exists public.submissions (
  player uuid not null,
  at     timestamptz not null default now()
);
create index if not exists submissions_by_player on public.submissions (player, at);

alter table public.boards enable row level security;
alter table public.scores enable row level security;
alter table public.submissions enable row level security;
revoke all on public.submissions from anon, authenticated;
revoke all on public.boards from anon, authenticated;
revoke all on public.scores from anon, authenticated;

-- Public, read-only view without player ids
create or replace view public.leaderboard as
  select board, name, time_ms, score, updated_at,
         left(encode(sha256(convert_to(player::text, 'UTF8')), 'hex'), 16) as pid
  from public.scores;
revoke all on public.leaderboard from anon, authenticated;
grant select on public.leaderboard to anon, authenticated;

-- Is `solution` (one column index per row) a valid answer for `regions`?
create or replace function public.catnap_valid_solution(p_regions text, p_solution integer[])
returns boolean language plpgsql immutable set search_path = public as $$
declare
  n int; r int; c int; reg text;
  used_cols int[] := '{}';
  used_regs text[] := '{}';
begin
  if p_regions is null or p_solution is null or p_regions !~ '^[0-9]+$' then return false; end if;
  n := round(sqrt(length(p_regions)));
  if n < 5 or n > 10 or n * n <> length(p_regions) then return false; end if;
  if (select count(distinct ch) from regexp_split_to_table(p_regions, '') as ch) <> n then return false; end if;
  if (select max(ch::int) from regexp_split_to_table(p_regions, '') as ch) >= n then return false; end if;
  if coalesce(array_length(p_solution, 1), 0) <> n then return false; end if;
  for r in 0 .. n - 1 loop
    c := p_solution[r + 1];
    if c is null or c < 0 or c >= n or c = any(used_cols) then return false; end if;
    used_cols := used_cols || c;
    reg := substr(p_regions, r * n + c + 1, 1);
    if reg = any(used_regs) then return false; end if;
    used_regs := used_regs || reg;
    if r > 0 and abs(c - p_solution[r]) <= 1 then return false; end if;
  end loop;
  return true;
end $$;

create or replace function public.submit_score(
  p_board    text,
  p_player   uuid,
  p_name     text,
  p_time_ms  integer   default null,
  p_score    integer   default null,
  p_regions  text      default null,
  p_solution integer[] default null
) returns json
language plpgsql security definer set search_path = public as $$
declare
  v_name text; v_day date; v_canon text; v_recent int; v_rank int; v_total int; v_best int;
begin
  v_name := left(btrim(regexp_replace(coalesce(p_name, ''), '[[:cntrl:]<>]', '', 'g')), 20);
  if length(v_name) < 1 then raise exception 'name required'; end if;
  if p_player is null then raise exception 'player required'; end if;

  delete from submissions where player = p_player and at < now() - interval '1 hour';
  select count(*) into v_recent from submissions where player = p_player;
  if v_recent >= 40 then raise exception 'too many submissions, try later'; end if;
  insert into submissions (player) values (p_player);

  -- Marathon: weekly high score
  if p_board ~ '^marathon-[0-9]{4}-W[0-9]{2}$' then
    -- players are in different time zones: accept last week, this week and the week of tomorrow
    if p_board not in ('marathon-' || to_char(now(), 'IYYY-"W"IW'),
                       'marathon-' || to_char(now() - interval '7 days', 'IYYY-"W"IW'),
                       'marathon-' || to_char(now() + interval '1 day', 'IYYY-"W"IW')) then
      raise exception 'not this week';
    end if;
    if p_score is null or p_score < 1 or p_score > 40000 then raise exception 'implausible score'; end if;
    insert into scores (board, player, name, score) values (p_board, p_player, v_name, p_score)
      on conflict (board, player) do update
      set score = greatest(scores.score, excluded.score), name = excluded.name, updated_at = now();
    select score into v_best from scores where board = p_board and player = p_player;
    select count(*) + 1 into v_rank from scores where board = p_board and score > v_best;
    select count(*) into v_total from scores where board = p_board;
    return json_build_object('rank', v_rank, 'total', v_total, 'best', v_best);
  end if;

  -- Puzzles: fastest time
  if p_board ~ '^daily-[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    v_day := substr(p_board, 7)::date;
    if v_day < current_date - 2 or v_day > current_date + 1 then raise exception 'daily too old'; end if;
  elsif p_board !~ '^level-([1-9]|[1-5][0-9]|60)$' then
    raise exception 'unknown board';
  end if;
  if p_time_ms is null or p_time_ms < 3000 or p_time_ms > 10800000 then raise exception 'implausible time'; end if;
  if not catnap_valid_solution(p_regions, p_solution) then raise exception 'invalid solution'; end if;

  select regions into v_canon from boards where board = p_board;
  if v_canon is null then
    if p_board like 'level-%' then raise exception 'unknown level'; end if;
    insert into boards (board, regions) values (p_board, p_regions) on conflict (board) do nothing;
    select regions into v_canon from boards where board = p_board;
  end if;
  if v_canon <> p_regions then raise exception 'board mismatch'; end if;

  insert into scores (board, player, name, time_ms) values (p_board, p_player, v_name, p_time_ms)
    on conflict (board, player) do update
    set time_ms = least(scores.time_ms, excluded.time_ms), name = excluded.name, updated_at = now();
  select time_ms into v_best from scores where board = p_board and player = p_player;
  select count(*) + 1 into v_rank from scores where board = p_board and time_ms < v_best;
  select count(*) into v_total from scores where board = p_board;
  return json_build_object('rank', v_rank, 'total', v_total, 'best', v_best);
end $$;

revoke all on function public.catnap_valid_solution(text, integer[]) from public, anon, authenticated;
revoke all on function public.submit_score(text, uuid, text, integer, integer, text, integer[]) from public, anon, authenticated;
grant execute on function public.submit_score(text, uuid, text, integer, integer, text, integer[]) to anon, authenticated;

-- The 60 Journey boards (generated from src/levels.js)
insert into public.boards (board, regions) values
  ('level-1', '1110111111133121333243333'),
  ('level-2', '0000210002334423344234444'),
  ('level-3', '0211122111221114444344443'),
  ('level-4', '1111011100311223342433444'),
  ('level-5', '1111022111243334443344433'),
  ('level-6', '2201122211222332443324433'),
  ('level-7', '022114222114222144223344223344225334'),
  ('level-8', '220000224013244333444433444433445553'),
  ('level-9', '111220131222333222333444335444335544'),
  ('level-10', '111300111333223344233344223444253344'),
  ('level-11', '111103111333211353211553245555225555'),
  ('level-12', '022222002221322224333244335444355444'),
  ('level-13', '0222224021222422222443333546333554633355663336666'),
  ('level-14', '0000011000011200344120334446333444655444465544466'),
  ('level-15', '221001221111222221322444332444354444'),
  ('level-16', '0221111222111122111142213114525344452533445553364'),
  ('level-17', '1110222111122211111224131222444442244455664445666'),
  ('level-18', '2213004221333422333445333444533644455364445666644'),
  ('level-19', '2222001333220132222013332211332254466655446666554'),
  ('level-20', '2222000222300122233002223300433333544633556663335'),
  ('level-21', '1143322041433322414533224445333244455333455553635556566657766666'),
  ('level-22', '1122200111122311112231111443115443355554435565553'),
  ('level-23', '0011111302111333021113334444443344455533444555554455555645557556'),
  ('level-24', '1110000111020011102001442233444445544445554644555'),
  ('level-25', '2222111022231311222333315533333453336644533366645533666455766666'),
  ('level-26', '2201111122001411222214442222444322444433244444556464477566644777'),
  ('level-27', '1144200314442203144422334444423544444555444445556667755567777555'),
  ('level-28', '1112220112222211132221333222333444233644526664455'),
  ('level-29', '0004441122244441224444332224443322644443526444635766666677776666'),
  ('level-30', '2221111022211311223333312222233142553333725533337275536677755666'),
  ('level-31', '000011111000011311000211313422213313442333333444463335444463666744466666777886666'),
  ('level-32', '3111110033311100331111023333312244333332463355776655557766666777'),
  ('level-33', '211111103224411133244433333244443333444444433554444433588444466888888777888888877'),
  ('level-34', '0022111300222213022533330555333305544443655577446557774465777744'),
  ('level-35', '000001111444001212440002222446622223746665555766665555777865855777865855777888855'),
  ('level-36', '0000001100440021000442213004422166554425655445556655555565577555'),
  ('level-37', '113335502133355522334444522333444525344444555377455555337768888377788888777788888'),
  ('level-38', '133333220133333322115333222155333332445556322455556366445576666445776666888777777'),
  ('level-39', '111102333111222443111122433112224433512254443555554444556664444766666848766668888'),
  ('level-40', '2211110022211004211114442223114452255546525565665555666677776666'),
  ('level-41', '112220000133222224333222244335252444355552246558582746888887776888888777888888877'),
  ('level-42', '2111111330214411133322441333334444433933444488399954448889995664899999566889799966888999996888888999'),
  ('level-43', '111000002113333322133333222755344266755554666757556666777776868777776888777777788'),
  ('level-44', '000222111000222231004222331444233331445233333445255555445556655755556888766666688'),
  ('level-45', '0001111113050111133355222133335552443333555244333355554444336555477333665555737766877777778888877779'),
  ('level-46', '333300022331100224333330224335335244335335544535555644555556664756666664777766864'),
  ('level-47', '2211111000221111140022111114442231111444223334444566666444556666644447666664444766668477776668849997'),
  ('level-48', '1113333000111333337011123337771442337777544333777755633377775666677778666677977866669997886669999999'),
  ('level-49', '011111334111222334133332344333333334663355444666555884665577884665557788666577888'),
  ('level-50', '1111000000111110003311122000031112330333551223337455112273775566667777555667787755566778885556679888'),
  ('level-51', '1112220444112222222411111244443111224444111122484477115248667777944886777998488877779888887799988888'),
  ('level-52', '011111111011711113022773133227773133424773335444677755466667758466777778466667888'),
  ('level-53', '2111111001221111111122121111112222231411222663344126663355442666694444766669848476666988887666999988'),
  ('level-54', '0000011111000000111122202041113222254461225555546122555556667255785556755778666677578886667777998886'),
  ('level-55', '1114444400211144440021166444402116644443751666448875566688887559688888779968888879998898887799999888'),
  ('level-56', '000003333140003332444403332444443333444653535444655555466666655886677655886665555'),
  ('level-57', '2220031111222203311122420311114442333331444333777744434477756444447777844774777988447777998447777799'),
  ('level-58', '2200111133222013133322233333332233333333422333333344433335354443369555774666955577666699987799999998'),
  ('level-59', '8800000000800002443188002244318882224333888822477388552447738665777777886777777787777777778777799777'),
  ('level-60', '1133202222143322266714322226771433226677443322266744455566674885956677888595699788899999778889999999')
on conflict (board) do update set regions = excluded.regions;
