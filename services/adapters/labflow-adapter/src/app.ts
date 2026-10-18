import express from 'express';

// Direct-DB-read pattern over LabFlow, the lab system, with the
// labflow_reader login (deploy/labflow/reader-login.sql). LabFlow holds
// health information, so that login is granted only the status and time
// columns these counts use: no patient, no test, no value. Counts are all
// that ever leave the database here.
export interface LabFlowStatus {
  appointmentsToday: number;
  openRequisitions: number;
  resultsToVerify: number;
  criticalNotCalled: number;
  electronicOrdersWaiting: number;
  messagesUnsent: number;
  messagesFailing: number;
}

export interface LabFlowQueries {
  status(): Promise<LabFlowStatus>;
}

export const SQL = {
  // "Today" in Toronto, where the lab is.
  status: `
    DECLARE @today date = CAST(SYSDATETIMEOFFSET() AT TIME ZONE 'Eastern Standard Time' AS date);
    SELECT
      (SELECT COUNT(Status) FROM sched.Appointment
        WHERE Status <> 'Cancelled'
          AND CAST(StartUtc AT TIME ZONE 'UTC' AT TIME ZONE 'Eastern Standard Time' AS date) = @today) AS appointmentsToday,
      (SELECT COUNT(Status) FROM lab.Requisition
        WHERE Status IN ('Received', 'InProgress', 'PartiallyResulted')) AS openRequisitions,
      (SELECT COUNT(Status) FROM lab.Result WHERE Status = 'Preliminary') AS resultsToVerify,
      (SELECT COUNT(Status) FROM lab.Result
        WHERE AbnormalFlag IN ('LL', 'HH') AND CriticalCalledAt IS NULL AND Status <> 'Cancelled') AS criticalNotCalled,
      (SELECT COUNT(Status) FROM lab.ElectronicOrder WHERE Status = 'Waiting') AS electronicOrdersWaiting,
      (SELECT COUNT(Attempts) FROM lab.OutboundMessage WHERE SentAt IS NULL) AS messagesUnsent,
      (SELECT COUNT(Attempts) FROM lab.OutboundMessage WHERE SentAt IS NULL AND Attempts > 0) AS messagesFailing`,
};

export function createApp(queries: LabFlowQueries) {
  const app = express();

  app.get('/status', async (_req, res) => {
    try {
      const s = await queries.status();
      const n = (v: number | null | undefined) => v ?? 0;
      const metrics = {
        appointmentsToday: n(s.appointmentsToday),
        openRequisitions: n(s.openRequisitions),
        resultsToVerify: n(s.resultsToVerify),
        criticalNotCalled: n(s.criticalNotCalled),
        electronicOrdersWaiting: n(s.electronicOrdersWaiting),
        messagesUnsent: n(s.messagesUnsent),
        messagesFailing: n(s.messagesFailing),
      };
      const parts = [
        `${metrics.appointmentsToday} appointment(s) today`,
        `${metrics.openRequisitions} open requisition(s)`,
        `${metrics.resultsToVerify} result(s) to verify`,
      ];
      // The one number a lab must act on now: a critical value not yet phoned.
      if (metrics.criticalNotCalled > 0) parts.unshift(`${metrics.criticalNotCalled} CRITICAL value(s) not yet phoned`);
      if (metrics.messagesFailing > 0) parts.push(`${metrics.messagesFailing} result message(s) to ClinicHub failing`);
      res.json({ healthy: true, summary: parts.join(', '), metrics });
    } catch {
      res.json({ healthy: false, error: 'LabFlow database unreachable.' });
    }
  });

  return app;
}
