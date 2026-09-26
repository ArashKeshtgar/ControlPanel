-- Seeds the project registry: all 9 portfolio projects. Only HIS+ and
-- wUtility have adapters so far; the rest show "Offline" until theirs exist.
-- Existing rows are left untouched, so this never overwrites edits made on
-- the Manage ports page.
--
-- sqlcmd variables (so the same script works for both run modes). Values
-- are host or host:port only — no scheme — because Windows sqlcmd rejects
-- variable values containing '//'.
--   ADAPTER_HOST                       host for the not-yet-built adapters
--   WUTILITY_ADAPTER, HISPLUS_ADAPTER  host:port of the two real adapters
-- Local:  -v ADAPTER_HOST=localhost WUTILITY_ADAPTER=localhost:4001 HISPLUS_ADAPTER=localhost:4002
-- Docker: set by db/init.sh to the compose service names.
USE ControlPanelDb;
GO

MERGE dbo.Projects AS target
USING (VALUES
    (N'his-plus',       N'HIS+',                  N'Clinical', N'http://$(HISPLUS_ADAPTER)'),
    (N'wutility',       N'wUtility',              N'Clinical', N'http://$(WUTILITY_ADAPTER)'),
    (N'droffice',       N'DrOffice',              N'Clinical', N'http://$(ADAPTER_HOST):4003'),
    (N'smartledger',    N'SmartLedgerAI',         N'Career',   N'http://$(ADAPTER_HOST):4004'),
    (N'jobsearch',      N'JobSearch/engine',      N'Career',   N'http://$(ADAPTER_HOST):4005'),
    (N'ledgerdash',     N'LedgerDashboard',       N'Career',   N'http://$(ADAPTER_HOST):4006'),
    (N'english-engine', N'English Engine',        N'Career',   N'http://$(ADAPTER_HOST):4007'),
    (N'dbaops',         N'DbaOpsConsole',         N'Other',    N'http://$(ADAPTER_HOST):4008'),
    (N'mern',           N'mern-animation-project', N'Other',   N'http://$(ADAPTER_HOST):4009')
) AS source ([Key], DisplayName, Category, AdapterBaseUrl)
ON target.[Key] = source.[Key]
WHEN NOT MATCHED THEN
    INSERT ([Key], DisplayName, Category, AdapterBaseUrl)
    VALUES (source.[Key], source.DisplayName, source.Category, source.AdapterBaseUrl);
GO
-- Users are NOT seeded here: their bcrypt hashes are generated from
-- ADMIN_PASSWORD / VIEWER_PASSWORD by `npm run seed:users` in core-api.
