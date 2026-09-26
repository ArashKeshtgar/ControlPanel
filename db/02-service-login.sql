-- Dedicated SQL-auth login for core-api and hisplus-adapter.
-- Required sqlcmd variable: DB_PASSWORD (never hardcoded here).
--   sqlcmd -S . -E -i 02-service-login.sql -v DB_PASSWORD="..."
--
-- Least privilege: read/write on ControlPanelDb (no db_owner, no DDL), and
-- read-only on HisPlusDemo, which is all the direct-DB-read adapter needs.
USE master;
GO
IF SUSER_ID(N'controlpanel_svc') IS NULL
    CREATE LOGIN controlpanel_svc WITH PASSWORD = N'$(DB_PASSWORD)', CHECK_POLICY = ON;
ELSE
    ALTER LOGIN controlpanel_svc WITH PASSWORD = N'$(DB_PASSWORD)';
GO

USE ControlPanelDb;
GO
IF USER_ID(N'controlpanel_svc') IS NULL CREATE USER controlpanel_svc FOR LOGIN controlpanel_svc;
IF IS_ROLEMEMBER(N'db_owner', N'controlpanel_svc') = 1 ALTER ROLE db_owner DROP MEMBER controlpanel_svc;
ALTER ROLE db_datareader ADD MEMBER controlpanel_svc;
ALTER ROLE db_datawriter ADD MEMBER controlpanel_svc;
GO

USE HisPlusDemo;
GO
IF USER_ID(N'controlpanel_svc') IS NULL CREATE USER controlpanel_svc FOR LOGIN controlpanel_svc;
ALTER ROLE db_datareader ADD MEMBER controlpanel_svc;
GO
