-- HisPlusDemo: the one table hisplus-adapter reads, with a few made-up
-- rows (fictional patient codes and names, no real hospital data).
USE HisPlusDemo;
GO

IF OBJECT_ID(N'dbo.ORReports', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.ORReports (
        Id           INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_ORReports PRIMARY KEY,
        PatientCode  NVARCHAR(30)  NOT NULL,
        SurgeonName  NVARCHAR(100) NOT NULL,
        CreatedAt    DATETIME2     NOT NULL CONSTRAINT DF_ORReports_CreatedAt DEFAULT (SYSUTCDATETIME()),
        IsFinalized  BIT           NOT NULL CONSTRAINT DF_ORReports_IsFinalized DEFAULT (0)
    );
END
GO

IF NOT EXISTS (SELECT 1 FROM dbo.ORReports)
BEGIN
    INSERT INTO dbo.ORReports (PatientCode, SurgeonName, CreatedAt, IsFinalized) VALUES
        (N'P-DEMO-01', N'Demo Surgeon A', DATEADD(HOUR, -1,  SYSUTCDATETIME()), 1),
        (N'P-DEMO-02', N'Demo Surgeon B', DATEADD(HOUR, -4,  SYSUTCDATETIME()), 1),
        (N'P-DEMO-03', N'Demo Surgeon A', DATEADD(HOUR, -20, SYSUTCDATETIME()), 1),
        (N'P-DEMO-04', N'Demo Surgeon C', DATEADD(HOUR, -2,  SYSUTCDATETIME()), 0);
END
GO
