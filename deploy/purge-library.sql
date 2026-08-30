-- Start the library empty on a new host while keeping who you are.
--
-- Kept:    users (login, password hash, TOTP enrolment, quota), wishlist.
-- Cleared: everything describing files that were left behind on the old server,
--          so nothing in the UI points at data that does not exist here.
--
-- playback_positions rows reference files(id) ON DELETE CASCADE, so they go with
-- the files; they are listed explicitly for any row that predates that constraint.
PRAGMA foreign_keys = ON;
BEGIN;
DELETE FROM playback_positions;
DELETE FROM files;
DELETE FROM torrents;
DELETE FROM folders;
DELETE FROM quota_reservations;
-- Force a fresh sign-in on the new host rather than carrying old sessions over.
DELETE FROM refresh_tokens;
COMMIT;
VACUUM;
