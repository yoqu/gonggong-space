#!/usr/bin/env bash
# Exports the shell commands Bot owners decided on, for replaying them through the daemon's 帮我审批 rules:
#   GONGGONG_DATABASE_URL=postgres://… bash scripts/approval-corpus.sh > corpus.jsonl
#   GG_REPLAY=$PWD/corpus.jsonl cargo test -p gonggong --lib replay_owner_decisions -- --ignored --nocapture
# The file holds hosts, tokens and paths from real runs: keep it out of the repository.
set -euo pipefail
: "${GONGGONG_DATABASE_URL:?set GONGGONG_DATABASE_URL}"
psql "$GONGGONG_DATABASE_URL" -qAtX -v ON_ERROR_STOP=1 <<'SQL'
set default_transaction_read_only = on;
select json_build_object(
  'id', a.id,
  'status', a.status,
  'reason', a.reason,
  -- The command the daemon judged: generic titles leave it to the detail (`$ cmd`, then the call's description);
  -- Codex titles it in backticks.
  'cmd', case
    when a.title in ('Run command', 'Terminal')
      then regexp_replace(regexp_replace(a.detail, E'\n[^\n]*$', ''), '^\$ ', '')
    when a.title ~ '^`[\s\S]*`$' then substr(a.title, 2, length(a.title) - 2)
    else a.title end,
  -- Older daemons clipped the detail to 200 characters: such a command cannot be replayed.
  'clipped', a.title in ('Run command', 'Terminal') and length(a.detail) = 202,
  'cwd', coalesce(gb.workspace_path, gb.cd_path, '/ws/unknown'),
  'extra', gb.extra_dirs
)
from approvals a
join runs r on r.id = a.run_id
left join group_bots gb on gb.group_id = r.group_id and gb.bot_id = r.bot_id
where a.tool_kind = 'execute' and a.title not like 'mcp.%'
order by a.created_at;
SQL
