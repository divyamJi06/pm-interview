-- Removes the api_keys table.
--
-- Provider keys (Cohere) are stored in the candidate's browser localStorage and
-- nowhere else. They are sent to the interview server per request and held in
-- memory for one round, so the app never needs to persist them. A database copy
-- of a live third-party credential is a liability we do not want: readable by
-- anyone with database access, and duplicated into backups we do not control.
--
-- This drops the table and every row in it. `drop table if exists` means it is
-- safe to run on a project that never had the table.

drop table if exists public.api_keys;