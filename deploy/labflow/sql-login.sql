-- SQL login for the LabFlow API container. A Linux container can't use
-- Windows authentication (the connection string LabFlow uses on the host).
-- Idempotent. Run again after LabFlow's database/deploy.ps1 -Recreate,
-- which drops the database and with it this user:
--   sqlcmd -S . -E -b -i deploy/labflow/sql-login.sql -v LABFLOW_DB_PASSWORD="..."
USE master;
GO
IF SUSER_ID(N'labflow_svc') IS NULL
    CREATE LOGIN labflow_svc WITH PASSWORD = N'$(LABFLOW_DB_PASSWORD)', CHECK_POLICY = ON, DEFAULT_DATABASE = LabFlow;
ELSE
    ALTER LOGIN labflow_svc WITH PASSWORD = N'$(LABFLOW_DB_PASSWORD)';
GO
USE LabFlow;
GO
IF USER_ID(N'labflow_svc') IS NULL CREATE USER labflow_svc FOR LOGIN labflow_svc;
ALTER ROLE db_datareader ADD MEMBER labflow_svc;
ALTER ROLE db_datawriter ADD MEMBER labflow_svc;
-- NEXT VALUE FOR on the accession and MRN sequences needs UPDATE on them.
GRANT UPDATE ON OBJECT::lab.AccessionSeq TO labflow_svc;
GRANT UPDATE ON OBJECT::core.MrnSeq TO labflow_svc;
-- The access log is append-only for the application.
DENY UPDATE, DELETE ON SCHEMA::audit TO labflow_svc;
GO
