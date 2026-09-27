-- ControlPanelDb schema. Idempotent: creates missing tables and applies
-- column migrations to an existing database.
USE ControlPanelDb;
GO

IF OBJECT_ID(N'dbo.Users', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.Users (
        Id            INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Users PRIMARY KEY,
        Username      NVARCHAR(50)  NOT NULL CONSTRAINT UQ_Users_Username UNIQUE,
        PasswordHash  NVARCHAR(200) NOT NULL,
        Role          NVARCHAR(20)  NOT NULL CONSTRAINT CK_Users_Role CHECK (Role IN (N'Admin', N'Viewer')),
        TokenVersion  INT           NOT NULL CONSTRAINT DF_Users_TokenVersion DEFAULT (0),
        CreatedAt     DATETIME2     NOT NULL CONSTRAINT DF_Users_CreatedAt DEFAULT (SYSUTCDATETIME())
    );
END
GO

-- Migration (2026-09-26): TokenVersion backs refresh-token revocation.
-- Bumping it on logout invalidates every refresh token issued before.
IF COL_LENGTH(N'dbo.Users', N'TokenVersion') IS NULL
    ALTER TABLE dbo.Users ADD TokenVersion INT NOT NULL CONSTRAINT DF_Users_TokenVersion DEFAULT (0);
GO

IF OBJECT_ID(N'dbo.Projects', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.Projects (
        Id              INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Projects PRIMARY KEY,
        [Key]           NVARCHAR(50)  NOT NULL CONSTRAINT UQ_Projects_Key UNIQUE,
        DisplayName     NVARCHAR(100) NOT NULL,
        Category        NVARCHAR(50)  NOT NULL,
        AdapterBaseUrl  NVARCHAR(200) NOT NULL,
        IsActive        BIT           NOT NULL CONSTRAINT DF_Projects_IsActive DEFAULT (1)
    );
END
GO

-- Migration (2026-09-27): every start/stop/restart/logs request made
-- through /services, successful or not. Insert-only from core-api.
IF OBJECT_ID(N'dbo.AuditLog', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.AuditLog (
        Id        BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_AuditLog PRIMARY KEY,
        At        DATETIME2     NOT NULL CONSTRAINT DF_AuditLog_At DEFAULT (SYSUTCDATETIME()),
        UserId    INT           NOT NULL,
        Username  NVARCHAR(50)  NOT NULL,
        Action    NVARCHAR(20)  NOT NULL,
        Target    NVARCHAR(100) NOT NULL,
        Outcome   NVARCHAR(10)  NOT NULL CONSTRAINT CK_AuditLog_Outcome CHECK (Outcome IN (N'ok', N'failed')),
        Detail    NVARCHAR(400) NULL
    );
END
GO

-- db_datawriter could otherwise rewrite history; the service login may only add rows.
IF USER_ID(N'controlpanel_svc') IS NOT NULL
    DENY UPDATE, DELETE ON dbo.AuditLog TO controlpanel_svc;
GO
