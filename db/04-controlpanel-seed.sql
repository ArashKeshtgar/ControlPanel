-- Seeds the project registry: every portfolio project. The ones on
-- ADAPTER_HOST have no adapter yet and show "Offline" until theirs exist,
-- on the port listed here.
-- Existing rows are left untouched, so this never overwrites edits made on
-- the Manage ports page.
--
-- sqlcmd variables (so the same script works for both run modes). Values
-- are host or host:port only — no scheme — because Windows sqlcmd rejects
-- variable values containing '//'.
--   ADAPTER_HOST       host for the not-yet-built adapters
--   *_ADAPTER          host:port of each real adapter (WUTILITY, HISPLUS,
--                      LEDGERDASH, REBIOMED, LESSONS, CLINICHUB, LABFLOW,
--                      CLINICREPORT, PHARMAFLOW, FINANCE)
-- Local:  -v ADAPTER_HOST=localhost WUTILITY_ADAPTER=localhost:4001 HISPLUS_ADAPTER=localhost:4002 LEDGERDASH_ADAPTER=localhost:4006
--            REBIOMED_ADAPTER=localhost:4010 LESSONS_ADAPTER=localhost:4011 CLINICHUB_ADAPTER=localhost:4012
--            LABFLOW_ADAPTER=localhost:4013 CLINICREPORT_ADAPTER=localhost:4014 PHARMAFLOW_ADAPTER=localhost:4015
--            FINANCE_ADAPTER=localhost:4016
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
    (N'ledgerdash',     N'LedgerDashboard',       N'Career',   N'http://$(LEDGERDASH_ADAPTER)'),
    (N'english-engine', N'English Engine',        N'Career',   N'http://$(ADAPTER_HOST):4007'),
    (N'dbaops',         N'DbaOpsConsole',         N'Other',    N'http://$(ADAPTER_HOST):4008'),
    (N'mern',           N'mern-animation-project', N'Other',   N'http://$(ADAPTER_HOST):4009'),
    (N'rebiomed',       N'ReBiomed',              N'Other',    N'http://$(REBIOMED_ADAPTER)'),
    (N'english-lessons', N'English lessons',      N'Career',   N'http://$(LESSONS_ADAPTER)'),
    (N'clinichub',      N'ClinicHub',             N'ClinicHub platform', N'http://$(CLINICHUB_ADAPTER)'),
    (N'labflow',        N'LabFlow',               N'ClinicHub platform', N'http://$(LABFLOW_ADAPTER)'),
    (N'clinicreport',   N'ClinicReport',          N'ClinicHub platform', N'http://$(CLINICREPORT_ADAPTER)'),
    (N'pharmaflow',     N'PharmaFlow',            N'ClinicHub platform', N'http://$(PHARMAFLOW_ADAPTER)'),
    (N'finance',        N'FinancePowerApp',       N'ClinicHub platform', N'http://$(FINANCE_ADAPTER)'),
    (N'taxireceipt',    N'TaxiReceipt',           N'Other',    N'http://$(ADAPTER_HOST):4017')
) AS source ([Key], DisplayName, Category, AdapterBaseUrl)
ON target.[Key] = source.[Key]
WHEN NOT MATCHED THEN
    INSERT ([Key], DisplayName, Category, AdapterBaseUrl)
    VALUES (source.[Key], source.DisplayName, source.Category, source.AdapterBaseUrl);
GO
-- Users are NOT seeded here: their bcrypt hashes are generated from
-- ADMIN_PASSWORD / VIEWER_PASSWORD by `npm run seed:users` in core-api.
