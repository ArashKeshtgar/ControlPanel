-- Creates the two databases Control Panel uses. Safe to re-run.
IF DB_ID(N'ControlPanelDb') IS NULL CREATE DATABASE ControlPanelDb;
GO
-- HisPlusDemo is a stand-in for the real HIS+ database, holding demo rows
-- only. hisplus-adapter must never be pointed at real hospital data.
IF DB_ID(N'HisPlusDemo') IS NULL CREATE DATABASE HisPlusDemo;
GO
