-- Read-only SQL login for labflow-adapter. LabFlow holds health
-- information, so labflow_reader gets SELECT only on the status and time
-- columns the adapter counts (services/adapters/labflow-adapter/src/app.ts):
-- no patient, test, value, comment or message payload. Idempotent. Run again
-- after LabFlow's database/deploy.ps1 -Recreate, which drops its users:
--   sqlcmd -S . -E -b -i deploy/labflow/reader-login.sql -v LABFLOW_READER_PASSWORD="..."
USE master;
GO
IF SUSER_ID(N'labflow_reader') IS NULL
    CREATE LOGIN labflow_reader WITH PASSWORD = N'$(LABFLOW_READER_PASSWORD)', CHECK_POLICY = ON, DEFAULT_DATABASE = LabFlow;
ELSE
    ALTER LOGIN labflow_reader WITH PASSWORD = N'$(LABFLOW_READER_PASSWORD)';
GO
USE LabFlow;
GO
IF USER_ID(N'labflow_reader') IS NULL CREATE USER labflow_reader FOR LOGIN labflow_reader;
GRANT SELECT ON sched.Appointment (Status, StartUtc) TO labflow_reader;
GRANT SELECT ON lab.Requisition (Status) TO labflow_reader;
GRANT SELECT ON lab.Result (Status, AbnormalFlag, CriticalCalledAt) TO labflow_reader;
-- Added by LabFlow at start-up (050, 051); granted once they exist.
IF OBJECT_ID(N'lab.ElectronicOrder') IS NOT NULL
    GRANT SELECT ON lab.ElectronicOrder (Status) TO labflow_reader;
IF OBJECT_ID(N'lab.OutboundMessage') IS NOT NULL
    GRANT SELECT ON lab.OutboundMessage (SentAt, Attempts) TO labflow_reader;
GO
