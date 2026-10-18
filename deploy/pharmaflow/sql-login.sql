-- SQL login for the PharmaFlow API container, which can't use Windows
-- authentication (the connection string the API uses on the host).
-- Idempotent. Run again after database/deploy.ps1 -Recreate, which drops
-- the database and with it this user:
--   sqlcmd -S . -E -b -i deploy/pharmaflow/sql-login.sql -v PHARMAFLOW_DB_PASSWORD="..."
USE master;
GO
IF SUSER_ID(N'pharmaflow_svc') IS NULL
    CREATE LOGIN pharmaflow_svc WITH PASSWORD = N'$(PHARMAFLOW_DB_PASSWORD)', CHECK_POLICY = ON, DEFAULT_DATABASE = PharmaFlow;
ELSE
    ALTER LOGIN pharmaflow_svc WITH PASSWORD = N'$(PHARMAFLOW_DB_PASSWORD)';
GO
USE PharmaFlow;
GO
IF USER_ID(N'pharmaflow_svc') IS NULL CREATE USER pharmaflow_svc FOR LOGIN pharmaflow_svc;
ALTER ROLE db_datareader ADD MEMBER pharmaflow_svc;
ALTER ROLE db_datawriter ADD MEMBER pharmaflow_svc;
-- NEXT VALUE FOR rx.RxNumber needs UPDATE on the sequence.
GRANT UPDATE ON OBJECT::rx.RxNumber TO pharmaflow_svc;
-- The access log (PHIPA) is append-only for the application.
DENY UPDATE, DELETE ON SCHEMA::audit TO pharmaflow_svc;
GO
