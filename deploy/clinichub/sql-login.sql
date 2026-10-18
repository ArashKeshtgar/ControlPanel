-- SQL login for the ClinicHub container, which can't use Windows
-- authentication. ClinicHub creates its own databases (the catalog and one
-- per clinic, at start-up and when an administrator opens a clinic), so the
-- login may create databases (dbcreator) and owns the ones it creates; it
-- has no other server-wide right and no access to any other database.
-- Idempotent:
--   sqlcmd -S . -E -b -i deploy/clinichub/sql-login.sql -v CLINICHUB_DB_PASSWORD="..."
USE master;
GO
IF SUSER_ID(N'clinichub_svc') IS NULL
    CREATE LOGIN clinichub_svc WITH PASSWORD = N'$(CLINICHUB_DB_PASSWORD)', CHECK_POLICY = ON;
ELSE
    ALTER LOGIN clinichub_svc WITH PASSWORD = N'$(CLINICHUB_DB_PASSWORD)';
ALTER SERVER ROLE dbcreator ADD MEMBER clinichub_svc;
GO
