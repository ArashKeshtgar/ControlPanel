-- SQL logins for FinancePowerApp in a container, which can't use Windows
-- authentication (the connection string the API uses on the host).
-- Idempotent. Run again after database/deploy.ps1 -Recreate, which drops
-- the database and with it these users:
--   sqlcmd -S . -E -b -i deploy/finance/sql-login.sql -v FINANCE_DB_PASSWORD="..." FINANCE_READER_PASSWORD="..."
--
-- finance_svc     the API: read/write, the journal-number sequence, the
--                 Power App's procedures. No DDL.
-- finance_reader  finance-adapter: SELECT on only the columns its queries use
--                 (services/adapters/finance-adapter/src/app.ts). Never a
--                 document's payload, an account, a journal line or a name.
USE master;
GO
IF SUSER_ID(N'finance_svc') IS NULL
    CREATE LOGIN finance_svc WITH PASSWORD = N'$(FINANCE_DB_PASSWORD)', CHECK_POLICY = ON, DEFAULT_DATABASE = FinancePowerApp;
ELSE
    ALTER LOGIN finance_svc WITH PASSWORD = N'$(FINANCE_DB_PASSWORD)';
IF SUSER_ID(N'finance_reader') IS NULL
    CREATE LOGIN finance_reader WITH PASSWORD = N'$(FINANCE_READER_PASSWORD)', CHECK_POLICY = ON, DEFAULT_DATABASE = FinancePowerApp;
ELSE
    ALTER LOGIN finance_reader WITH PASSWORD = N'$(FINANCE_READER_PASSWORD)';
GO
USE FinancePowerApp;
GO
IF USER_ID(N'finance_svc') IS NULL CREATE USER finance_svc FOR LOGIN finance_svc;
ALTER ROLE db_datareader ADD MEMBER finance_svc;
ALTER ROLE db_datawriter ADD MEMBER finance_svc;
-- NEXT VALUE FOR gl.JournalNumber needs UPDATE on the sequence.
GRANT UPDATE ON OBJECT::gl.JournalNumber TO finance_svc;
GRANT EXECUTE ON SCHEMA::dbo TO finance_svc;
GO
IF USER_ID(N'finance_reader') IS NULL CREATE USER finance_reader FOR LOGIN finance_reader;
GRANT SELECT ON integ.Document (Source, Kind, Reference, DocumentDate, Total, [Status], Error, ReceivedUtc) TO finance_reader;
GRANT SELECT ON ar.Item (PartyId, DueDate, Balance) TO finance_reader;
GRANT SELECT ON ap.Item (DueDate, Balance) TO finance_reader;
GRANT SELECT ON org.Party (PartyId, PartyType) TO finance_reader;
GRANT SELECT ON dbo.AccountingPeriods ([Year], [Month], IsClosed) TO finance_reader;
GO
