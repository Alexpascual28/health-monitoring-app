import express from 'express';
import cors from 'cors';
import http from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { PlatformCoordinator } from './platform-store.js';
import { StaffRole } from '../domain/canonical-schema.js';
import { ROLE_PERMISSION_MATRIX } from './consent-audit-rbac.js';
import { runFleetLoadSimulation } from '../simulator/sim-5000-cli.js';
import { config } from '../config/env.js';

export function createPlatformServer(coordinator = new PlatformCoordinator()): {
  app: express.Express;
  httpServer: http.Server;
  coordinator: PlatformCoordinator;
} {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '2mb' }));

  const httpServer = http.createServer(app);
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  const broadcastWs = (payload: unknown) => {
    const json = JSON.stringify(payload);
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(json);
      }
    }
  };

  coordinator.onRealtimeEvent((evt) => {
    broadcastWs(evt);
  });

  // 1. Health & UK Cloud Region / Compliance Status
  app.get('/api/v1/health', (_req, res) => {
    const auditStatus = coordinator.securityService.verifyAuditChainIntegrity();
    res.json({
      status: 'UP',
      region: config.cloudRegion,
      careCentreId: config.defaultCareCentreId,
      careCentreName: config.defaultCareCentreName,
      tlsMinVersion: config.tlsMinVersion,
      encryptionAtRest: `AES-256-GCM (${config.encryptionKeyCurrentId})`,
      auditChainIntegrity: auditStatus,
      ingestionMetrics: coordinator.ingestionService.getMetrics(),
      supportedVendors: coordinator.adapterRegistry.listSupportedVendors(),
    });
  });

  // 2. Dashboard Bootstrap Snapshot (Patients, Alerts, Fleet, Audit, Metrics)
  app.get('/api/v1/bootstrap', (_req, res) => {
    const patients = coordinator.listPatients();
    const alerts = coordinator.alertManager.listAlerts();
    const devices = coordinator.listDevices();
    const auditLogs = coordinator.securityService.listAuditLogs(50);
    const auditIntegrity = coordinator.securityService.verifyAuditChainIntegrity();

    res.json({
      careCentre: {
        id: config.defaultCareCentreId,
        name: config.defaultCareCentreName,
        region: config.cloudRegion,
      },
      patients,
      alerts,
      devices,
      auditLogs,
      auditIntegrity,
      ingestionMetrics: coordinator.ingestionService.getMetrics(),
      rbacMatrix: ROLE_PERMISSION_MATRIX,
    });
  });

  // 3. Patient Detail + Time-Series History & Roll-Ups (1m, 5m, 1h)
  app.get('/api/v1/patients/:patientId', (req, res) => {
    try {
      const actorId = String(req.query.actorId || 'Nurse-Hannah');
      const actorRole = (req.query.actorRole as StaffRole) || 'CAREGIVER';
      const patient = coordinator.getPatient(req.params.patientId, actorId, actorRole);
      const rawHistory = coordinator.ingestionService.getPatientRawHistory(patient.id, 40);
      const rollups1m = coordinator.ingestionService.getPatientRollups(patient.id, '1m');
      const rollups5m = coordinator.ingestionService.getPatientRollups(patient.id, '5m');
      const rollups1h = coordinator.ingestionService.getPatientRollups(patient.id, '1h');
      const fhirAbdm = coordinator.getFhirAndAbdmPreview(patient.id);

      res.json({
        patient,
        rawHistory,
        rollups: {
          '1m': rollups1m,
          '5m': rollups5m,
          '1h': rollups1h,
        },
        fhirAbdm,
      });
    } catch (err) {
      res.status(404).json({ error: (err as Error).message });
    }
  });

  // 4. Runtime Threshold Update (No-Deploy Config Change)
  app.patch('/api/v1/patients/:patientId/thresholds', (req, res) => {
    try {
      const { thresholds, actorId = 'Supervisor-Alex', actorRole = 'SHIFT_SUPERVISOR' } = req.body;
      const updated = coordinator.updatePatientThresholds(
        req.params.patientId,
        thresholds,
        actorId,
        actorRole
      );
      res.json({ patient: updated });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  // 5. DPDP Act 2023 Consent Update / Withdrawal
  app.patch('/api/v1/patients/:patientId/consent', (req, res) => {
    try {
      const patient = coordinator.listPatients().find((p) => p.id === req.params.patientId);
      if (!patient) {
        res.status(404).json({ error: 'Patient not found' });
        return;
      }
      const {
        status,
        permissions,
        actorId = 'Enrolment-Officer-Sarah',
        actorRole = 'ENROLMENT_OFFICER',
      } = req.body;
      const consent = coordinator.securityService.updatePatientConsent(patient, {
        status,
        permissions,
        actorId,
        actorRole,
      });
      broadcastWs({ type: 'CONSENT_UPDATED', data: { patientId: patient.id, consent } });
      res.json({ consent, patient });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  // 6. Alert Worklist Actions (Assign, Acknowledge, Escalate, Close with Disposition)
  app.post('/api/v1/alerts/:alertId/action', (req, res) => {
    try {
      const { action, actorName = 'Nurse Hannah (Shift A)', disposition } = req.body;
      const alertId = req.params.alertId;
      let updated;

      if (action === 'ASSIGN') {
        updated = coordinator.alertManager.assignAlert(alertId, actorName);
      } else if (action === 'ACKNOWLEDGE') {
        updated = coordinator.alertManager.acknowledgeAlert(alertId, actorName);
      } else if (action === 'ESCALATE') {
        const existing = coordinator.alertManager.listAlerts().find((a) => a.id === alertId);
        if (!existing) throw new Error('Alert not found');
        const patient = coordinator.listPatients().find((p) => p.id === existing.patientId)!;
        updated = coordinator.alertManager.escalateAlert(alertId, patient, disposition);
      } else if (action === 'CLOSE') {
        updated = coordinator.alertManager.closeAlert(alertId, actorName, disposition);
      } else {
        throw new Error(`Unsupported alert action: ${action}`);
      }

      coordinator.securityService.appendAuditLog({
        actorId: actorName,
        actorRole: 'CAREGIVER',
        careCentreId: updated.careCentreId,
        action: `ALERT_${action}`,
        resourceType: 'ALERT',
        resourceId: updated.id,
        details: `Alert ${updated.id} (${updated.title}) ${action} by ${actorName}${
          disposition ? ` — Disposition: ${disposition}` : ''
        }`,
      });

      broadcastWs({ type: 'ALERT_UPDATED', data: updated });
      res.json({ alert: updated });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  // 7. Wearable Telemetry & Event Ingestion Endpoint (HTTPS + Simulator Trigger)
  app.post('/api/v1/ingest/simulate', (req, res) => {
    try {
      const result = coordinator.simulateWearableEvent(req.body);
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.post('/api/v1/ingest/telemetry', (req, res) => {
    const { deviceId, deviceToken, vendorModel, payload } = req.body;
    const outcome = coordinator.ingestionService.ingest({
      protocol: 'HTTPS',
      deviceId: String(deviceId || ''),
      deviceTokenOrCert: deviceToken,
      vendorModel,
      rawPayload: payload || {},
    });
    res.status(outcome.accepted ? 202 : 400).json(outcome);
  });

  // 8. 5,000-Band Load Simulator Trigger Endpoint
  app.post('/api/v1/simulator/load-test', (req, res) => {
    const bandCount = Math.min(5000, Math.max(10, Number(req.body?.bandCount || 5000)));
    const result = runFleetLoadSimulation(bandCount);
    coordinator.securityService.appendAuditLog({
      actorId: 'Load-Test-Operator',
      actorRole: 'DEVICE_TECH',
      careCentreId: config.defaultCareCentreId,
      action: 'FLEET_SIMULATION_EXECUTED',
      resourceType: 'DEVICE',
      resourceId: `SIM-${bandCount}-BANDS`,
      details: `Executed ${bandCount}-band load simulation: p95=${result.latencyMs.p95}ms, SLA Met=${result.slaP95Under5000MsMet}, ZeroSilentLoss=${result.zeroSilentLossVerified}`,
    });
    res.json(result);
  });

  // 9. Family Mobile App Endpoints (International OTP + Calm Consent-Limited View)
  app.post('/api/v1/family/otp/request', (req, res) => {
    try {
      const { phoneE164, patientId = 'PAT-1001' } = req.body;
      const otp = coordinator.securityService.requestInternationalFamilyOtp(phoneE164, patientId);
      res.json(otp);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.post('/api/v1/family/otp/verify', (req, res) => {
    const { phoneE164, otpCode } = req.body;
    const result = coordinator.securityService.verifyInternationalFamilyOtp(phoneE164, otpCode);
    if (!result.verified) {
      res.status(401).json({ verified: false, error: 'Invalid or expired OTP code' });
      return;
    }
    res.json(result);
  });

  app.get('/api/v1/family/patients/:patientId/calm-view', (req, res) => {
    try {
      const view = coordinator.getFamilyCalmView(
        req.params.patientId,
        String(req.query.familyUser || 'Family-Mobile-Viewer')
      );
      res.json(view);
    } catch (err) {
      res.status(404).json({ error: (err as Error).message });
    }
  });

  // 10. CSV Roster Import Endpoint
  app.post('/api/v1/admin/roster/import-csv', (req, res) => {
    try {
      const { csvText, actorId = 'Enrolment-Officer-Sarah', actorRole = 'ENROLMENT_OFFICER' } = req.body;
      const result = coordinator.importPilotRosterCsv(csvText, actorId, actorRole);
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  return { app, httpServer, coordinator };
}
