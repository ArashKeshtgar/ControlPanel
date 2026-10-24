-- SQL logins for the clinic platform's containers (a Linux container can't use Windows authentication). Idempotent:
-- run by deploy/vps/migrate.sh after the PharmaFlow and FinancePowerApp databases are up to date, with the passwords
-- from the clinic secrets (deploy/vps/make-clinic-secrets.sh):
--   sqlcmd ... -i deploy/clinic/sql-logins.sql -v CLINICHUB_DB_PASSWORD=... PHARMAFLOW_DB_PASSWORD=... FINANCE_DB_PASSWORD=...
USE master;
GO
-- ClinicHub creates its catalog and one database per clinic itself (EF migrations), so it may create databases; it
-- owns those it creates and nothing else on the server.
IF SUSER_ID(N'clinichub_svc') IS NULL
    CREATE LOGIN clinichub_svc WITH PASSWORD = N'$(CLINICHUB_DB_PASSWORD)', CHECK_POLICY = ON;
ELSE
    ALTER LOGIN clinichub_svc WITH PASSWORD = N'$(CLINICHUB_DB_PASSWORD)';
ALTER SERVER ROLE dbcreator ADD MEMBER clinichub_svc;
IF SUSER_ID(N'pharmaflow_svc') IS NULL
    CREATE LOGIN pharmaflow_svc WITH PASSWORD = N'$(PHARMAFLOW_DB_PASSWORD)', CHECK_POLICY = ON, DEFAULT_DATABASE = PharmaFlow;
ELSE
    ALTER LOGIN pharmaflow_svc WITH PASSWORD = N'$(PHARMAFLOW_DB_PASSWORD)';
IF SUSER_ID(N'finance_svc') IS NULL
    CREATE LOGIN finance_svc WITH PASSWORD = N'$(FINANCE_DB_PASSWORD)', CHECK_POLICY = ON, DEFAULT_DATABASE = FinancePowerApp;
ELSE
    ALTER LOGIN finance_svc WITH PASSWORD = N'$(FINANCE_DB_PASSWORD)';
GO

-- PharmaFlow: reads and writes its tables; the schema comes from database/*.sql (migrate.sh), not from the API.
USE PharmaFlow;
GO
IF USER_ID(N'pharmaflow_svc') IS NULL CREATE USER pharmaflow_svc FOR LOGIN pharmaflow_svc;
ALTER ROLE db_datareader ADD MEMBER pharmaflow_svc;
ALTER ROLE db_datawriter ADD MEMBER pharmaflow_svc;
-- NEXT VALUE FOR on the prescription numbers needs UPDATE on the sequence.
GRANT UPDATE ON OBJECT::rx.RxNumber TO pharmaflow_svc;
-- Who opened which patient (PHIPA) is append-only for the application.
DENY UPDATE, DELETE ON SCHEMA::audit TO pharmaflow_svc;
GO

-- FinancePowerApp: the same; the books are corrected with reversing entries, never by editing rows (the API's rule).
USE FinancePowerApp;
GO
IF USER_ID(N'finance_svc') IS NULL CREATE USER finance_svc FOR LOGIN finance_svc;
ALTER ROLE db_datareader ADD MEMBER finance_svc;
ALTER ROLE db_datawriter ADD MEMBER finance_svc;
GRANT UPDATE ON OBJECT::gl.JournalNumber TO finance_svc;
GO
