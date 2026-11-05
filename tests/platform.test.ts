import { describe, it, expect } from 'vitest';
import { validateCanonicalPacket } from '../src/domain/canonical-schema.js';
import { BandAdapterRegistry } from '../src/adapters/band-adapter.js';
import {
  mapConsentToAbdmArtefact,
  mapTelemetryToFhirR4Bundle,
} from '../src/domain/fhir-abdm-mapper.js';
import { WearableIngestionService } from '../src/ingestion/ingestion-service.js';
import {
  WellnessRulesEngine,
  calculateHaversineDistanceMeters,
} from '../src/engine/rules-engine.js';
import { AlertEscalationManager } from '../src/engine/alert-escalation.js';
import { SecurityConsentAuditService } from '../src/server/consent-audit-rbac.js';
import { PlatformCoordinator } from '../src/server/platform-store.js';
import { createPlatformServer } from '../src/server/api-server.js';
import { runFleetLoadSimulation } from '../src/simulator/sim-5000-cli.js';

describe('IoT Remote Health Monitoring Platform - Phase 1 MVP Suite', () => {
  it('validates canonical telemetry packets and rejects out-of-range physiological/GPS values', () => {
    const validPacket = {
      messageId: 'msg-100',
      deviceId: 'BAND-UK-1001',
      patientId: 'PAT-1001',
      careCentreId: 'cc-uk-sunrise-01',
      vendorModel: 'CarePulse-Band-Pro-V1',
      firmwareVersion: 'CP1.4.2',
      eventType: 'VITALS_TELEMETRY' as const,
      observedAt: new Date().toISOString(),
      receivedAt: new Date().toISOString(),
      sequenceNumber: 1,
      metrics: {
        heartRateBpm: 76,
        spo2Pct: 98,
        skinTempC: 36.6,
        batteryPct: 85,
      },
      wearState: 'ON_WRIST' as const,
      location: { lat: 51.5074, lng: -0.1278 },
    };
    expect(validateCanonicalPacket(validPacket).valid).toBe(true);

    const invalidPacket = {
      ...validPacket,
      messageId: '',
      metrics: {
        heartRateBpm: 390,
        spo2Pct: 40,
        skinTempC: 55,
        batteryPct: 120,
      },
      location: { lat: 120, lng: -220 },
    };
    const res = validateCanonicalPacket(invalidPacket);
    expect(res.valid).toBe(false);
    expect(res.errors.length).toBeGreaterThanOrEqual(5);
  });

  it('translates both CarePulse-Band-Pro-V1 (JSON) and VitalWatch-Hex-V2 (binary hex) vendor payloads seamlessly', () => {
    const registry = new BandAdapterRegistry();
    expect(registry.listSupportedVendors()).toContain('CarePulse-Band-Pro-V1');
    expect(registry.listSupportedVendors()).toContain('VitalWatch-Hex-V2');

    const cred1 = registry.provisionDevice({
      deviceId: 'DEV-V1',
      patientId: 'PAT-1',
      careCentreId: 'CC-1',
      vendorModel: 'CarePulse-Band-Pro-V1',
    });
    expect(registry.verifyDeviceAuth('DEV-V1', cred1.hmacToken).authenticated).toBe(true);
    expect(registry.verifyDeviceAuth('DEV-V1', 'WRONG_TOKEN').authenticated).toBe(false);
    expect(registry.verifyDeviceAuth('UNPROVISIONED').authenticated).toBe(false);

    const v1 = registry.translateAndValidate(
      'CarePulse-Band-Pro-V1',
      {
        msgId: 'v1-msg',
        devId: 'DEV-V1',
        evt: 'FALL_DETECTED',
        bat: 80,
        wrist: 'ON_WRIST',
        vitals: { hr: 118, spo2: 95, temp: 36.8, steps: 500 },
        gps: { lat: 51.5074, lng: -0.1278, acc: 5 },
      },
      { patientId: 'PAT-1', careCentreId: 'CC-1' }
    );
    expect(v1.valid).toBe(true);
    expect(v1.packet.eventType).toBe('FALL_DETECTED');
    expect(v1.packet.metrics.heartRateBpm).toBe(118);

    const v2 = registry.translateAndValidate(
      'VitalWatch-Hex-V2',
      {
        packetId: 'v2-pkt',
        imei: 'DEV-V2',
        hexFrame: '035061016e550109', // 03 = SOS_PRESSED, 0x50 = 80 bpm, 0x61 = 97%
        stepCounter: 1200,
        latitude: 51.5074,
        longitude: -0.1278,
      },
      { patientId: 'PAT-2', careCentreId: 'CC-1' }
    );
    expect(v2.valid).toBe(true);
    expect(v2.packet.eventType).toBe('SOS_PRESSED');
    expect(v2.packet.metrics.heartRateBpm).toBe(80);
    expect(v2.packet.metrics.spo2Pct).toBe(97);
  });

  it('handles MQTT & HTTPS ingestion, rate limiting, deduplication, out-of-order buffering, back-pressure replay, and 1m/5m/1h roll-ups', () => {
    const registry = new BandAdapterRegistry();
    const ingestion = new WearableIngestionService(registry, 3); // Rate limit of 3/min for test

    const cred = registry.provisionDevice({
      deviceId: 'BAND-ING-1',
      patientId: 'PAT-ING-1',
      careCentreId: 'CC-1',
      vendorModel: 'CarePulse-Band-Pro-V1',
    });

    const nowMs = Date.now();

    // 1. Live MQTT packet
    const out1 = ingestion.ingestMqttPublish(
      'carecentres/CC-1/devices/BAND-ING-1/telemetry',
      {
        msgId: 'm-1',
        devId: 'BAND-ING-1',
        observedAt: new Date(nowMs).toISOString(),
        bat: 90,
        vitals: { hr: 75, spo2: 98, temp: 36.5 },
      },
      cred.hmacToken
    );
    expect(out1.accepted).toBe(true);
    expect(out1.status).toBe('PROCESSED');

    // 2. Duplicate packet with same msgId -> DUPLICATE_IGNORED
    const outDup = ingestion.ingestMqttPublish(
      'carecentres/CC-1/devices/BAND-ING-1/telemetry',
      {
        msgId: 'm-1',
        devId: 'BAND-ING-1',
        observedAt: new Date(nowMs).toISOString(),
        bat: 90,
        vitals: { hr: 75, spo2: 98, temp: 36.5 },
      },
      cred.hmacToken
    );
    expect(outDup.status).toBe('DUPLICATE_IGNORED');

    // 3. Out-of-order buffered packet (observed 5 minutes earlier)
    const outOoo = ingestion.ingest({
      protocol: 'HTTPS',
      deviceId: 'BAND-ING-1',
      deviceTokenOrCert: cred.hmacToken,
      rawPayload: {
        msgId: 'm-0-delayed',
        devId: 'BAND-ING-1',
        observedAt: new Date(nowMs - 300_000).toISOString(),
        bat: 91,
        vitals: { hr: 68, spo2: 99, temp: 36.4 },
      },
    });
    expect(outOoo.status).toBe('PROCESSED_OUT_OF_ORDER');
    expect(outOoo.outOfOrder).toBe(true);

    // 4. Rate limit exceeded on 4th packet in same minute
    const outRateLimited = ingestion.ingest({
      protocol: 'HTTPS',
      deviceId: 'BAND-ING-1',
      deviceTokenOrCert: cred.hmacToken,
      rawPayload: {
        msgId: 'm-4',
        devId: 'BAND-ING-1',
        bat: 89,
        vitals: { hr: 77, spo2: 97, temp: 36.6 },
      },
    });
    expect(outRateLimited.accepted).toBe(false);
    expect(outRateLimited.status).toBe('REJECTED_RATE_LIMIT');

    // Verify 1m, 5m, 1h roll-ups were generated
    expect(ingestion.getPatientRollups('PAT-ING-1', '1m').length).toBeGreaterThanOrEqual(1);
    expect(ingestion.getPatientRollups('PAT-ING-1', '5m').length).toBeGreaterThanOrEqual(1);
    expect(ingestion.getPatientRollups('PAT-ING-1', '1h').length).toBeGreaterThanOrEqual(1);

    // 5. Back-pressure write-ahead queue & zero-silent-loss replay
    const cred2 = registry.provisionDevice({
      deviceId: 'BAND-ING-2',
      patientId: 'PAT-ING-1',
      careCentreId: 'CC-1',
      vendorModel: 'CarePulse-Band-Pro-V1',
    });
    ingestion.setSimulateBackpressure(true);
    const queued = ingestion.ingest({
      protocol: 'MQTT_TLS',
      deviceId: 'BAND-ING-2',
      deviceTokenOrCert: cred2.hmacToken,
      rawPayload: {
        msgId: 'm-bp-1',
        devId: 'BAND-ING-2',
        bat: 85,
        vitals: { hr: 80, spo2: 97, temp: 36.6 },
      },
    });
    expect(queued.status).toBe('QUEUED_BACKPRESSURE');
    const replayRes = ingestion.replayBackpressureBuffer();
    expect(replayRes.replayed).toBe(1);
    expect(replayRes.remaining).toBe(0);
  });

  it('evaluates SOS, Fall, Sustained Breaches, Composite Conditions, Geofence exits, and Quiet Hours / Escalation', () => {
    const coordinator = new PlatformCoordinator();
    const margaret = coordinator.getPatient('PAT-1001');

    // Distance calculation check
    const dist = calculateHaversineDistanceMeters(
      { lat: 51.5074, lng: -0.1278 },
      { lat: 51.5124, lng: -0.1278 }
    );
    expect(dist).toBeGreaterThan(500);

    // Trigger Fall + Geofence exit + Critical Battery + Low SpO2
    const simOut = coordinator.simulateWearableEvent({
      patientId: margaret.id,
      eventType: 'FALL_DETECTED',
      heartRateBpm: 135,
      spo2Pct: 87,
      skinTempC: 38.4,
      batteryPct: 8,
      lat: 51.513,
      lng: -0.1278,
    });
    expect(simOut.outcome.accepted).toBe(true);
    const margaretAlerts = simOut.activeAlerts.filter(
      (a) => a.patientId === margaret.id && a.state !== 'CLOSED'
    );
    expect(margaretAlerts.some((a) => a.ruleCode === 'RULE_FALL_DETECTED')).toBe(true);
    expect(margaretAlerts.some((a) => a.ruleCode === 'RULE_GEOFENCE_EXIT')).toBe(true);
    expect(margaretAlerts.some((a) => a.ruleCode === 'RULE_SPO2_LOW')).toBe(true);
    expect(margaretAlerts.some((a) => a.ruleCode === 'RULE_BATTERY_CRITICAL')).toBe(true);

    // Verify Alert Lifecycle: Assign -> Acknowledge -> Escalate -> Auto-Escalation -> Close with disposition
    const targetAlert = margaretAlerts[0];
    coordinator.alertManager.setSimulatePrimarySmsFailure(true);
    const assigned = coordinator.alertManager.assignAlert(targetAlert.id, 'Nurse-Hannah');
    expect(assigned.state).toBe('ASSIGNED');

    const escalated = coordinator.alertManager.escalateAlert(
      targetAlert.id,
      margaret,
      'Escalating to shift supervisor'
    );
    expect(escalated.escalationTier).toBe(2);
    expect(escalated.deliveries.some((d) => d.failoverUsed)).toBe(true);

    const acked = coordinator.alertManager.acknowledgeAlert(targetAlert.id, 'Supervisor-Alex');
    expect(acked.state).toBe('ACKNOWLEDGED');

    const closed = coordinator.alertManager.closeAlert(
      targetAlert.id,
      'Supervisor-Alex',
      'Resident assisted and confirmed comfortable.'
    );
    expect(closed.state).toBe('CLOSED');
  });

  it('enforces 8-role RBAC, Staff MFA, International OTP, AES-256-GCM key rotation, DPDP consent redaction, and SHA-256 audit chain verification', () => {
    const coordinator = new PlatformCoordinator();
    const sec = coordinator.securityService;

    // 1. RBAC checks
    expect(sec.hasPermission('SUPER_ADMIN', 'ROTATE_ENCRYPTION_KEYS')).toBe(true);
    expect(sec.hasPermission('CAREGIVER', 'ROTATE_ENCRYPTION_KEYS')).toBe(false);
    expect(sec.hasPermission('AUDITOR', 'VIEW_IMMUTABLE_AUDIT_LOG')).toBe(true);

    // 2. Staff MFA & International Family OTP
    expect(sec.verifyStaffMfa('staff-1', '123456')).toBe(true);
    expect(sec.verifyStaffMfa('staff-1', '000000')).toBe(false);

    const otpReq = sec.requestInternationalFamilyOtp('+919820155432', 'PAT-1002');
    expect(otpReq.countryCode).toContain('India');
    const otpVer = sec.verifyInternationalFamilyOtp('+919820155432', otpReq.devOtpPreview);
    expect(otpVer.verified).toBe(true);

    // 3. AES-256-GCM field encryption & key rotation
    const encryptedV2 = sec.encryptSensitiveField('NHS-994-221-8821');
    expect(sec.decryptSensitiveField(encryptedV2)).toBe('NHS-994-221-8821');

    const rot = sec.rotateEncryptionKey('key-v3-2026-12');
    expect(rot.activeKeyId).toBe('key-v3-2026-12');
    const reEncryptedV3 = sec.reEncryptWithCurrentKey(encryptedV2);
    expect(reEncryptedV3.keyId).toBe('key-v3-2026-12');
    expect(sec.decryptSensitiveField(reEncryptedV3)).toBe('NHS-994-221-8821');

    // 4. DPDP Act 2023 Consent Withdrawal immediately redacts Family Calm View
    const arthur = coordinator.getPatient('PAT-1002');
    const viewBefore = coordinator.getFamilyCalmView('PAT-1002');
    expect(viewBefore.vitalsShared).toBe(true);
    expect(viewBefore.vitals).toBeDefined();

    sec.updatePatientConsent(arthur, {
      status: 'WITHDRAWN',
      actorId: 'Enrolment-Officer-Sarah',
      actorRole: 'ENROLMENT_OFFICER',
    });

    const viewAfter = coordinator.getFamilyCalmView('PAT-1002');
    expect(viewAfter.vitalsShared).toBe(false);
    expect(viewAfter.vitals).toBeUndefined();
    expect(viewAfter.locationSummary).toBeUndefined();

    // 5. FHIR R4 & ABDM Consent Artefact mapping
    const fhirAbdm = coordinator.getFhirAndAbdmPreview('PAT-1001');
    expect((fhirAbdm.fhirBundle as { resourceType: string }).resourceType).toBe('Bundle');
    expect((fhirAbdm.abdmConsentArtefact as { schemaVersion: string }).schemaVersion).toContain(
      'ABDM'
    );

    // 6. CSV Roster Bulk Import & Immutable Hash-Chained Audit Log Integrity
    const imported = coordinator.importPilotRosterCsv(
      'Test Resident One,TestOne,81,Female,Flat 30A,Alice Contact,Daughter,+447700900333'
    );
    expect(imported.importedCount).toBe(1);

    const integrity = sec.verifyAuditChainIntegrity();
    expect(integrity.intact).toBe(true);
    expect(integrity.totalEntries).toBeGreaterThan(5);
  });

  it('verifies 5,000-band simulation SLA (p95 <= 5000ms, zero silent loss) and Express API server routes', async () => {
    const simResult = runFleetLoadSimulation(500);
    expect(simResult.slaP95Under5000MsMet).toBe(true);
    expect(simResult.zeroSilentLossVerified).toBe(true);

    const { httpServer } = createPlatformServer();
    await new Promise<void>((resolve) => httpServer.listen(0, () => resolve()));
    const address = httpServer.address();
    const port = typeof address === 'object' && address ? address.port : 0;

    try {
      const healthRes = await fetch(`http://localhost:${port}/api/v1/health`);
      expect(healthRes.status).toBe(200);
      const healthData = await healthRes.json();
      expect(healthData.region).toBe('eu-west-2');

      const bootRes = await fetch(`http://localhost:${port}/api/v1/bootstrap`);
      expect(bootRes.status).toBe(200);

      const patRes = await fetch(`http://localhost:${port}/api/v1/patients/PAT-1001`);
      expect(patRes.status).toBe(200);

      const famRes = await fetch(
        `http://localhost:${port}/api/v1/family/patients/PAT-1001/calm-view`
      );
      expect(famRes.status).toBe(200);
    } finally {
      httpServer.close();
    }
  });
});
