import crypto from 'node:crypto';
import {
  AlertRecord,
  CanonicalTelemetryPacket,
  PatientRecord,
  PatientThresholds,
  StaffRole,
  WearableDevice,
} from '../domain/canonical-schema.js';
import { BandAdapterRegistry } from '../adapters/band-adapter.js';
import { WearableIngestionService, IngestionOutcome } from '../ingestion/ingestion-service.js';
import { WellnessRulesEngine } from '../engine/rules-engine.js';
import { AlertEscalationManager } from '../engine/alert-escalation.js';
import { SecurityConsentAuditService } from './consent-audit-rbac.js';
import {
  mapConsentToAbdmArtefact,
  mapTelemetryToFhirR4Bundle,
} from '../domain/fhir-abdm-mapper.js';
import { config } from '../config/env.js';

export interface FamilyCalmViewPayload {
  patientId: string;
  patientName: string;
  preferredName: string;
  careCentreName: string;
  calmHeadline: string;
  calmSubtext: string;
  overallStatus: 'CALM_OK' | 'ATTENTION_BEING_HANDLED' | 'OFF_WRIST_NOTICE';
  wearState: string;
  batteryPct: number;
  lastCheckedIso: string;
  consentStatus: string;
  vitalsShared: boolean;
  vitals?: {
    heartRateBpm: number;
    spo2Pct: number;
    skinTempC: number;
    stepsCount: number;
  };
  gpsShared: boolean;
  locationSummary?: {
    insideGeofence: boolean;
    safeZoneLabel: string;
    distanceFromSafeZoneM: number;
  };
  contacts: {
    careCentreDeskPhone: string;
    residentDirectPhone: string;
    primaryFamilyContact: string;
  };
  recentAlertsWithDisposition: Array<{
    id: string;
    title: string;
    severity: string;
    state: string;
    createdAt: string;
    caregiverDisposition: string;
    handledBy: string;
  }>;
}

/**
 * Central Multi-Tenant Backend Store & Domain Coordinator
 * Orchestrates:
 * - Care Centre Pilot Roster (~100 capacity, seeded with rich realistic residents)
 * - Wearable Fleet Provisioning & Canonical Ingestion
 * - Per-patient Rules Engine & Geofencing
 * - P1-P4 Alerting, Escalation & Disposition
 * - DPDP Act 2023 Consent & Immutable Hash-Chained Audit Trail
 */
export class PlatformCoordinator {
  readonly adapterRegistry = new BandAdapterRegistry();
  readonly ingestionService = new WearableIngestionService(this.adapterRegistry);
  readonly rulesEngine = new WellnessRulesEngine();
  readonly alertManager = new AlertEscalationManager();
  readonly securityService = new SecurityConsentAuditService();

  private patients = new Map<string, PatientRecord>();
  private devices = new Map<string, WearableDevice>();
  private realtimeListeners: Array<(event: { type: string; data: unknown }) => void> = [];

  constructor() {
    this.ingestionService.onPacketProcessed((packet, outOfOrder) => {
      this.handleProcessedPacket(packet, outOfOrder);
    });
    this.seedInitialPilotData();
  }

  onRealtimeEvent(listener: (event: { type: string; data: unknown }) => void): void {
    this.realtimeListeners.push(listener);
  }

  private emitRealtime(type: string, data: unknown): void {
    for (const listener of this.realtimeListeners) {
      listener({ type, data });
    }
  }

  private createDefaultThresholds(
    centerLat = 51.5074,
    centerLng = -0.1278,
    safeZoneLabel = 'Sunrise London Residence Safe Zone'
  ): PatientThresholds {
    return {
      hrHighBpm: 115,
      hrLowBpm: 48,
      hrSustainedWindowSec: 0, // Immediate evaluation in interactive demo; configurable per patient
      spo2LowPct: 92,
      spo2SustainedWindowSec: 0,
      skinTempHighC: 37.8,
      skinTempLowC: 35.2,
      lowBatteryWarningPct: 20,
      criticalBatteryPct: 10,
      offWristAlertAfterSec: 300,
      geofence: {
        enabled: true,
        centerLat,
        centerLng,
        radiusMeters: 250,
        safeZoneLabel,
      },
      compositeInactivityHighHr: {
        enabled: true,
        hrThresholdBpm: 108,
        maxStepsInWindow: 5,
      },
      quietHours: {
        enabled: true,
        startHour24: 22,
        endHour24: 7,
        timezone: 'Europe/London',
      },
      updatedAt: new Date().toISOString(),
      updatedBy: 'Dr-Thresholds-Config',
    };
  }

  private seedInitialPilotData(): void {
    const careCentreId = config.defaultCareCentreId;
    const now = Date.now();

    const pilotSeeds: Array<{
      id: string;
      fullName: string;
      preferredName: string;
      age: number;
      gender: 'Female' | 'Male';
      roomOrFlat: string;
      homeAddress: string;
      deviceId: string;
      vendorModel: 'CarePulse-Band-Pro-V1' | 'VitalWatch-Hex-V2';
      hr: number;
      spo2: number;
      temp: number;
      steps: number;
      battery: number;
      contactName: string;
      contactRelation: string;
      contactPhone: string;
      contactCountry: string;
      notes: string;
    }> = [
      {
        id: 'PAT-1001',
        fullName: 'Margaret Eleanor Whitaker',
        preferredName: 'Margaret',
        age: 82,
        gender: 'Female',
        roomOrFlat: 'Flat 14B - Ground Garden Wing',
        homeAddress: '24 Kensington Park Rd, London W11 3BU, UK',
        deviceId: 'BAND-UK-1001',
        vendorModel: 'CarePulse-Band-Pro-V1',
        hr: 74,
        spo2: 97,
        temp: 36.6,
        steps: 2140,
        battery: 88,
        contactName: 'David Whitaker (Son - Toronto)',
        contactRelation: 'Son',
        contactPhone: '+14165550192',
        contactCountry: 'Canada (+1)',
        notes: 'Lives independently in Flat 14B; enjoys morning garden walks. Prefers calm phone check-ins.',
      },
      {
        id: 'PAT-1002',
        fullName: 'Arthur Rajesh Patel',
        preferredName: 'Arthur',
        age: 79,
        gender: 'Male',
        roomOrFlat: 'Flat 08A - West Courtyard',
        homeAddress: '24 Kensington Park Rd, London W11 3BU, UK',
        deviceId: 'BAND-UK-1002',
        vendorModel: 'VitalWatch-Hex-V2',
        hr: 78,
        spo2: 96,
        temp: 36.7,
        steps: 1580,
        battery: 76,
        contactName: 'Priya Patel-Sharma (Daughter - Mumbai)',
        contactRelation: 'Daughter',
        contactPhone: '+919820155432',
        contactCountry: 'India (+91)',
        notes: 'Uses VitalWatch-Hex-V2 band. Daughter checks Family App daily from Mumbai.',
      },
      {
        id: 'PAT-1003',
        fullName: 'Evelyn Grace Campbell',
        preferredName: 'Evelyn',
        age: 86,
        gender: 'Female',
        roomOrFlat: 'Flat 22C - South Conservatory',
        homeAddress: '24 Kensington Park Rd, London W11 3BU, UK',
        deviceId: 'BAND-UK-1003',
        vendorModel: 'CarePulse-Band-Pro-V1',
        hr: 81,
        spo2: 95,
        temp: 36.5,
        steps: 890,
        battery: 92,
        contactName: 'Fiona Campbell (Daughter - Sydney)',
        contactRelation: 'Daughter',
        contactPhone: '+61412555890',
        contactCountry: 'Australia (+61)',
        notes: 'Higher fall-safety awareness; geofence set to 250m around South Conservatory.',
      },
      {
        id: 'PAT-1004',
        fullName: 'harold George Pemberton',
        preferredName: 'Harold',
        age: 84,
        gender: 'Male',
        roomOrFlat: 'Flat 03D - Oak Wing',
        homeAddress: '24 Kensington Park Rd, London W11 3BU, UK',
        deviceId: 'BAND-UK-1004',
        vendorModel: 'CarePulse-Band-Pro-V1',
        hr: 71,
        spo2: 98,
        temp: 36.4,
        steps: 3120,
        battery: 64,
        contactName: 'Claire Pemberton (Niece - Singapore)',
        contactRelation: 'Niece',
        contactPhone: '+6591234567',
        contactCountry: 'Singapore (+65)',
        notes: 'Active walker; occasional evening band charging between 20:00 and 21:00.',
      },
      {
        id: 'PAT-1005',
        fullName: 'Dorothy Maeve O-Connor',
        preferredName: 'Dorothy',
        age: 88,
        gender: 'Female',
        roomOrFlat: 'Flat 19A - Rose Terrace',
        homeAddress: '24 Kensington Park Rd, London W11 3BU, UK',
        deviceId: 'BAND-UK-1005',
        vendorModel: 'VitalWatch-Hex-V2',
        hr: 76,
        spo2: 96,
        temp: 36.6,
        steps: 1120,
        battery: 54,
        contactName: 'Liam O-Connor (Son - Dublin)',
        contactRelation: 'Son',
        contactPhone: '+353875550144',
        contactCountry: 'Ireland (+353)',
        notes: 'Evening check-in schedule at 19:30 UK time.',
      },
      {
        id: 'PAT-1006',
        fullName: 'Suresh Chandra Menon',
        preferredName: 'Suresh',
        age: 81,
        gender: 'Male',
        roomOrFlat: 'Flat 11B - Garden Wing',
        homeAddress: '24 Kensington Park Rd, London W11 3BU, UK',
        deviceId: 'BAND-UK-1006',
        vendorModel: 'CarePulse-Band-Pro-V1',
        hr: 73,
        spo2: 97,
        temp: 36.5,
        steps: 1940,
        battery: 81,
        contactName: 'Ananya Menon (Daughter - Bengaluru)',
        contactRelation: 'Daughter',
        contactPhone: '+919845011223',
        contactCountry: 'India (+91)',
        notes: 'Enrolled with full DPDP Act 2023 & ABDM-ready consent artefact.',
      },
    ];

    for (const seed of pilotSeeds) {
      const fullName =
        seed.fullName.charAt(0).toUpperCase() + seed.fullName.slice(1);
      const cred = this.adapterRegistry.provisionDevice({
        deviceId: seed.deviceId,
        patientId: seed.id,
        careCentreId,
        vendorModel: seed.vendorModel,
      });

      const device: WearableDevice = {
        deviceId: seed.deviceId,
        patientId: seed.id,
        careCentreId,
        vendorModel: seed.vendorModel,
        firmwareVersion:
          seed.vendorModel === 'CarePulse-Band-Pro-V1' ? 'CP1.4.2' : 'VW2.1.0',
        serialNumber: `SN-${seed.deviceId}-2026`,
        certificateThumbprint: cred.certificateThumbprint,
        hmacKeyId: `HMAC-${seed.deviceId}`,
        provisioningStatus: 'ACTIVE',
        onlineStatus: 'ONLINE',
        wearState: 'ON_WRIST',
        batteryPct: seed.battery,
        signalRssiDbm: -64,
        lastSeenAt: new Date(now).toISOString(),
        provisionedAt: new Date(now - 14 * 86400_000).toISOString(),
      };
      this.devices.set(device.deviceId, device);

      const patient: PatientRecord = {
        id: seed.id,
        careCentreId,
        fullName,
        preferredName: seed.preferredName,
        age: seed.age,
        gender: seed.gender,
        roomOrFlat: seed.roomOrFlat,
        homeAddress: seed.homeAddress,
        bandDeviceId: seed.deviceId,
        caregiverNotes: seed.notes,
        emergencyContacts: [
          {
            id: `EC-${seed.id}-1`,
            name: seed.contactName,
            relationship: seed.contactRelation,
            phoneE164: seed.contactPhone,
            email: `${seed.preferredName.toLowerCase()}.family@example.com`,
            countryCode: seed.contactCountry,
            isPrimaryFamilyAppUser: true,
          },
        ],
        thresholds: this.createDefaultThresholds(),
        consent: {
          consentId: `DPDP-CNS-${seed.id}`,
          patientId: seed.id,
          careCentreId,
          dataPrincipalName: fullName,
          status: 'GRANTED',
          purpose:
            '24x7 Wearable Safety & Wellness Monitoring and Overseas Family Reassurance View',
          permissions: {
            continuousWearableMonitoring: true,
            shareVitalsWithFamilyApp: true,
            shareGpsLocationWithFamilyApp: true,
            emergencySmsVoiceAlerts: true,
            abdmHealthRecordLinkage: true,
          },
          retentionDays: 365,
          grantedAt: new Date(now - 14 * 86400_000).toISOString(),
          lastUpdatedBy: 'Enrolment-Officer-Sarah',
          abdmArtefactId: `ABDM-ART-${seed.id}-2026`,
        },
        enrolledAt: new Date(now - 14 * 86400_000).toISOString(),
      };

      this.patients.set(patient.id, patient);

      // Seed 15 historical telemetry points across the last 30 minutes for trend charts
      for (let stepIdx = 14; stepIdx >= 0; stepIdx--) {
        const obsTime = new Date(now - stepIdx * 120_000).toISOString();
        const wave = Math.round(Math.sin(stepIdx + seed.age) * 3);
        this.ingestionService.ingest({
          protocol: 'MQTT_TLS',
          deviceId: seed.deviceId,
          deviceTokenOrCert: cred.hmacToken,
          vendorModel: 'CarePulse-Band-Pro-V1',
          receivedAt: obsTime,
          rawPayload: {
            msgId: `seed-${seed.deviceId}-${stepIdx}`,
            devId: seed.deviceId,
            evt: 'TELEMETRY',
            observedAt: obsTime,
            seq: 15 - stepIdx,
            bat: seed.battery,
            wrist: 'ON_WRIST',
            vitals: {
              hr: seed.hr + wave,
              spo2: Math.min(99, seed.spo2 + (stepIdx % 2)),
              temp: Number((seed.temp + (stepIdx % 3) * 0.05).toFixed(1)),
              steps: Math.max(100, seed.steps - stepIdx * 40),
            },
            gps: {
              lat: 51.5074 + (stepIdx % 3) * 0.0001,
              lng: -0.1278 + (stepIdx % 3) * 0.0001,
              acc: 5,
            },
          },
        });
      }
    }

    // Seed one historical resolved alert for Margaret (PAT-1001) so Family App shows disposition history immediately
    const margaret = this.patients.get('PAT-1001')!;
    const resolvedSeed = this.alertManager.raiseOrDeduplicateAlert(
      margaret,
      margaret.bandDeviceId,
      {
        ruleCode: 'RULE_BAND_OFF_WRIST',
        severity: 'MEDIUM',
        title: 'Wearable Band Removed During Morning Shower',
        summary: 'Margaret removed wearable band for 18 minutes; caregiver confirmed routine morning wash.',
        triggeredValue: 'OFF_WRIST (18m)',
        thresholdReference: 'Expected ON_WRIST',
        observedAt: new Date(now - 3 * 3600_000).toISOString(),
      }
    );
    this.alertManager.acknowledgeAlert(resolvedSeed.alert.id, 'Nurse Hannah (Shift A)');
    this.alertManager.closeAlert(
      resolvedSeed.alert.id,
      'Nurse Hannah (Shift A)',
      'Spoke with Margaret on intercom; band was charging during morning tea and is now securely back on her wrist. All vitals normal.'
    );

    // Seed one active HIGH alert on Evelyn (PAT-1003) so Caregiver Console shows an active exception on boot
    const evelyn = this.patients.get('PAT-1003')!;
    this.alertManager.raiseOrDeduplicateAlert(
      evelyn,
      evelyn.bandDeviceId,
      {
        ruleCode: 'RULE_HR_HIGH',
        severity: 'HIGH',
        title: 'Elevated Heart Rate Threshold Exceeded',
        summary: 'Wearable heart rate reading of 122 bpm exceeded configured upper wellness threshold (115 bpm).',
        triggeredValue: '122 bpm',
        thresholdReference: '<=115 bpm',
        observedAt: new Date(now - 90_000).toISOString(),
      }
    );

    this.securityService.appendAuditLog({
      actorId: 'SYSTEM_BOOTSTRAP',
      actorRole: 'SUPER_ADMIN',
      careCentreId,
      action: 'PILOT_ROSTER_INITIALIZED',
      resourceType: 'ROSTER',
      resourceId: careCentreId,
      details: `Initialized UK Care Centre (${config.defaultCareCentreName}) in region ${config.cloudRegion} with ${this.patients.size} enrolled residents and active hash-chained audit log.`,
    });
  }

  private handleProcessedPacket(
    packet: CanonicalTelemetryPacket,
    outOfOrder: boolean
  ): void {
    const patient = this.patients.get(packet.patientId);
    if (!patient) return;

    const device = this.devices.get(packet.deviceId);
    if (device && !outOfOrder) {
      device.wearState = packet.wearState;
      device.batteryPct = packet.metrics.batteryPct;
      device.signalRssiDbm = packet.metrics.signalRssiDbm ?? device.signalRssiDbm;
      device.lastSeenAt = packet.receivedAt;
      device.onlineStatus = 'ONLINE';
    }

    const evaluation = this.rulesEngine.evaluatePacket(patient, packet);

    // Only update live patient snapshot if the packet is NOT an older out-of-order replay
    if (!outOfOrder) {
      const prev = patient.latestSnapshot;
      const loc = packet.location ||
        prev?.location || {
          lat: patient.thresholds.geofence.centerLat,
          lng: patient.thresholds.geofence.centerLng,
        };

      patient.latestSnapshot = {
        observedAt: packet.observedAt,
        receivedAt: packet.receivedAt,
        heartRateBpm: packet.metrics.heartRateBpm ?? prev?.heartRateBpm ?? 74,
        spo2Pct: packet.metrics.spo2Pct ?? prev?.spo2Pct ?? 97,
        skinTempC: packet.metrics.skinTempC ?? prev?.skinTempC ?? 36.6,
        stepsCount: packet.metrics.stepsCount ?? prev?.stepsCount ?? 1000,
        batteryPct: packet.metrics.batteryPct,
        wearState: packet.wearState,
        location: loc,
        insideGeofence: evaluation.insideGeofence,
        distanceFromSafeZoneM: evaluation.distanceFromSafeZoneM,
      };
    }

    const raisedAlerts: AlertRecord[] = [];
    for (const candidate of evaluation.candidates) {
      const { alert, isDuplicate } = this.alertManager.raiseOrDeduplicateAlert(
        patient,
        packet.deviceId,
        candidate
      );
      raisedAlerts.push(alert);
      if (!isDuplicate) {
        this.securityService.appendAuditLog({
          actorId: packet.deviceId,
          actorRole: 'CAREGIVER',
          careCentreId: patient.careCentreId,
          action: `ALERT_RAISED_${alert.severity}`,
          resourceType: 'ALERT',
          resourceId: alert.id,
          details: `${alert.title} (${alert.triggeredValue}) for ${patient.fullName}`,
        });
      }
    }

    this.emitRealtime('TELEMETRY_AND_ALERTS_UPDATED', {
      packet,
      outOfOrder,
      patientSnapshot: patient.latestSnapshot,
      raisedAlerts,
    });
  }

  /**
   * Simulates or ingests a wearable packet from UI Simulator, MQTT, or HTTPS
   */
  simulateWearableEvent(params: {
    patientId: string;
    protocol?: 'MQTT_TLS' | 'HTTPS';
    eventType?: CanonicalTelemetryPacket['eventType'];
    heartRateBpm?: number;
    spo2Pct?: number;
    skinTempC?: number;
    stepsCount?: number;
    batteryPct?: number;
    wearState?: CanonicalTelemetryPacket['wearState'];
    lat?: number;
    lng?: number;
    observedAtOffsetSec?: number;
    forceDuplicateMessageId?: string;
  }): { outcome: IngestionOutcome; activeAlerts: AlertRecord[] } {
    const patient = this.patients.get(params.patientId);
    if (!patient) {
      throw new Error(`Patient ${params.patientId} not found`);
    }

    const snap = patient.latestSnapshot;
    const observedMs =
      Date.now() + (params.observedAtOffsetSec ? params.observedAtOffsetSec * 1000 : 0);

    const rawPayload: Record<string, unknown> = {
      msgId:
        params.forceDuplicateMessageId ||
        `sim-${patient.bandDeviceId}-${crypto.randomUUID().slice(0, 8)}`,
      devId: patient.bandDeviceId,
      evt: params.eventType || 'VITALS_TELEMETRY',
      observedAt: new Date(observedMs).toISOString(),
      seq: Math.floor(Math.random() * 1000),
      bat: params.batteryPct ?? snap?.batteryPct ?? 85,
      wrist: params.wearState ?? snap?.wearState ?? 'ON_WRIST',
      vitals: {
        hr: params.heartRateBpm ?? snap?.heartRateBpm ?? 75,
        spo2: params.spo2Pct ?? snap?.spo2Pct ?? 97,
        temp: params.skinTempC ?? snap?.skinTempC ?? 36.6,
        steps: params.stepsCount ?? snap?.stepsCount ?? 1500,
      },
      gps: {
        lat: params.lat ?? snap?.location.lat ?? 51.5074,
        lng: params.lng ?? snap?.location.lng ?? -0.1278,
        acc: 5,
      },
    };

    const outcome = this.ingestionService.ingest({
      protocol: params.protocol || 'MQTT_TLS',
      deviceId: patient.bandDeviceId,
      deviceTokenOrCert: 'SIMULATOR_DEV_TOKEN',
      vendorModel: 'CarePulse-Band-Pro-V1',
      rawPayload,
    });

    return {
      outcome,
      activeAlerts: this.alertManager.listAlerts(patient.careCentreId),
    };
  }

  /**
   * Updates per-patient thresholds at runtime with zero deployment required
   */
  updatePatientThresholds(
    patientId: string,
    partialThresholds: Partial<PatientThresholds>,
    actorId = 'Supervisor-Alex',
    actorRole: StaffRole = 'SHIFT_SUPERVISOR'
  ): PatientRecord {
    if (!this.securityService.hasPermission(actorRole, 'EDIT_PATIENT_THRESHOLDS')) {
      throw new Error(`Role ${actorRole} is not permitted to edit patient thresholds`);
    }
    const patient = this.patients.get(patientId);
    if (!patient) {
      throw new Error(`Patient ${patientId} not found`);
    }

    patient.thresholds = {
      ...patient.thresholds,
      ...partialThresholds,
      geofence: {
        ...patient.thresholds.geofence,
        ...(partialThresholds.geofence || {}),
      },
      quietHours: {
        ...patient.thresholds.quietHours,
        ...(partialThresholds.quietHours || {}),
      },
      updatedAt: new Date().toISOString(),
      updatedBy: actorId,
    };

    this.securityService.appendAuditLog({
      actorId,
      actorRole,
      careCentreId: patient.careCentreId,
      action: 'PATIENT_THRESHOLDS_UPDATED_NO_DEPLOY',
      resourceType: 'THRESHOLD',
      resourceId: patient.id,
      details: `Updated runtime thresholds for ${patient.fullName}: HR [${patient.thresholds.hrLowBpm}-${patient.thresholds.hrHighBpm} bpm], SpO2 >= ${patient.thresholds.spo2LowPct}%, Geofence ${patient.thresholds.geofence.radiusMeters}m`,
    });

    this.emitRealtime('PATIENT_UPDATED', patient);
    return patient;
  }

  /**
   * Bulk imports pilot residents from CSV text
   * Expected columns: fullName,preferredName,age,gender,roomOrFlat,contactName,contactRelation,contactPhone
   */
  importPilotRosterCsv(
    csvText: string,
    actorId = 'Enrolment-Officer-Sarah',
    actorRole: StaffRole = 'ENROLMENT_OFFICER'
  ): { importedCount: number; patients: PatientRecord[] } {
    if (!this.securityService.hasPermission(actorRole, 'ENROL_PATIENT_AND_CSV_IMPORT')) {
      throw new Error(`Role ${actorRole} is not authorized to import patient rosters`);
    }

    const lines = csvText
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.toLowerCase().startsWith('fullname,'));

    const created: PatientRecord[] = [];
    for (const line of lines) {
      const cols = line.split(',').map((c) => c.trim());
      if (cols.length < 5) continue;

      const [
        fullName,
        preferredName,
        ageStr,
        genderStr,
        roomOrFlat,
        contactName = 'Family Member',
        contactRelation = 'Relative',
        contactPhone = '+447700900555',
      ] = cols;

      const idx = this.patients.size + 1001;
      const id = `PAT-${idx}`;
      const deviceId = `BAND-UK-${idx}`;
      const careCentreId = config.defaultCareCentreId;

      const cred = this.adapterRegistry.provisionDevice({
        deviceId,
        patientId: id,
        careCentreId,
        vendorModel: 'CarePulse-Band-Pro-V1',
      });

      const device: WearableDevice = {
        deviceId,
        patientId: id,
        careCentreId,
        vendorModel: 'CarePulse-Band-Pro-V1',
        firmwareVersion: 'CP1.4.2',
        serialNumber: `SN-${deviceId}-2026`,
        certificateThumbprint: cred.certificateThumbprint,
        hmacKeyId: `HMAC-${deviceId}`,
        provisioningStatus: 'ACTIVE',
        onlineStatus: 'ONLINE',
        wearState: 'ON_WRIST',
        batteryPct: 95,
        signalRssiDbm: -62,
        lastSeenAt: new Date().toISOString(),
        provisionedAt: new Date().toISOString(),
      };
      this.devices.set(deviceId, device);

      const patient: PatientRecord = {
        id,
        careCentreId,
        fullName,
        preferredName: preferredName || fullName.split(' ')[0],
        age: Number(ageStr) || 80,
        gender:
          genderStr === 'Male' || genderStr === 'Female' ? genderStr : 'Other',
        roomOrFlat,
        homeAddress: '24 Kensington Park Rd, London W11 3BU, UK',
        bandDeviceId: deviceId,
        caregiverNotes: 'Enrolled via CSV Roster Bulk Import.',
        emergencyContacts: [
          {
            id: `EC-${id}-1`,
            name: contactName,
            relationship: contactRelation,
            phoneE164: contactPhone,
            email: `${(preferredName || 'family').toLowerCase()}@example.com`,
            countryCode: contactPhone.startsWith('+91') ? 'India (+91)' : 'UK (+44)',
            isPrimaryFamilyAppUser: true,
          },
        ],
        thresholds: this.createDefaultThresholds(),
        consent: {
          consentId: `DPDP-CNS-${id}`,
          patientId: id,
          careCentreId,
          dataPrincipalName: fullName,
          status: 'GRANTED',
          purpose: '24x7 Wearable Safety & Wellness Monitoring',
          permissions: {
            continuousWearableMonitoring: true,
            shareVitalsWithFamilyApp: true,
            shareGpsLocationWithFamilyApp: true,
            emergencySmsVoiceAlerts: true,
            abdmHealthRecordLinkage: true,
          },
          retentionDays: 365,
          grantedAt: new Date().toISOString(),
          lastUpdatedBy: actorId,
          abdmArtefactId: `ABDM-ART-${id}-2026`,
        },
        latestSnapshot: {
          observedAt: new Date().toISOString(),
          receivedAt: new Date().toISOString(),
          heartRateBpm: 74,
          spo2Pct: 97,
          skinTempC: 36.6,
          stepsCount: 450,
          batteryPct: 95,
          wearState: 'ON_WRIST',
          location: { lat: 51.5074, lng: -0.1278, accuracyM: 5 },
          insideGeofence: true,
          distanceFromSafeZoneM: 8,
        },
        enrolledAt: new Date().toISOString(),
      };

      this.patients.set(id, patient);
      created.push(patient);
    }

    this.securityService.appendAuditLog({
      actorId,
      actorRole,
      careCentreId: config.defaultCareCentreId,
      action: 'CSV_ROSTER_BULK_IMPORT',
      resourceType: 'ROSTER',
      resourceId: config.defaultCareCentreId,
      details: `Imported ${created.length} residents via CSV roster import.`,
    });

    this.emitRealtime('ROSTER_IMPORTED', { importedCount: created.length });
    return { importedCount: created.length, patients: created };
  }

  /**
   * Builds the Consent-Limited, Calm Overseas Family Mobile App View
   * Non-negotiable requirement:
   * - "Is my parent OK?" calm reassurance home screen
   * - Consent-limited vitals (automatically hides vitals or GPS if DPDP consent is withdrawn)
   * - Alert history with caregiver disposition
   * - One-tap call links
   */
  getFamilyCalmView(
    patientId: string,
    actorId = 'Family-Member-App'
  ): FamilyCalmViewPayload {
    const patient = this.patients.get(patientId);
    if (!patient) {
      throw new Error(`Patient ${patientId} not found`);
    }

    this.securityService.appendAuditLog({
      actorId,
      actorRole: 'FAMILY_MEMBER',
      careCentreId: patient.careCentreId,
      action: 'FAMILY_APP_VIEW_ACCESSED',
      resourceType: 'PATIENT',
      resourceId: patient.id,
      details: `Family mobile view accessed for ${patient.fullName} (consent=${patient.consent.status})`,
    });

    const allPatientAlerts = this.alertManager
      .listAlerts(patient.careCentreId)
      .filter((a) => a.patientId === patient.id);
    const activeAlerts = allPatientAlerts.filter((a) => a.state !== 'CLOSED');
    const snap = patient.latestSnapshot;

    let overallStatus: FamilyCalmViewPayload['overallStatus'] = 'CALM_OK';
    let calmHeadline = `${patient.preferredName} is safe and comfortable`;
    let calmSubtext = `Band is on wrist at ${config.defaultCareCentreName}. Caregivers are monitoring 24×7.`;

    if (activeAlerts.length > 0) {
      overallStatus = 'ATTENTION_BEING_HANDLED';
      calmHeadline = `Caregiver team is checking in on ${patient.preferredName}`;
      calmSubtext = `An alert (${activeAlerts[0].title}) is actively being attended to by the 24×7 care desk.`;
    } else if (snap?.wearState === 'OFF_WRIST') {
      overallStatus = 'OFF_WRIST_NOTICE';
      calmHeadline = `${patient.preferredName}'s band is currently off-wrist`;
      calmSubtext = `Band is resting or charging in ${patient.roomOrFlat}.`;
    }

    const vitalsShared =
      patient.consent.status === 'GRANTED' &&
      patient.consent.permissions.shareVitalsWithFamilyApp;

    const gpsShared =
      patient.consent.status === 'GRANTED' &&
      patient.consent.permissions.shareGpsLocationWithFamilyApp;

    return {
      patientId: patient.id,
      patientName: patient.fullName,
      preferredName: patient.preferredName,
      careCentreName: config.defaultCareCentreName,
      calmHeadline,
      calmSubtext,
      overallStatus,
      wearState: snap?.wearState || 'ON_WRIST',
      batteryPct: snap?.batteryPct ?? 85,
      lastCheckedIso: snap?.receivedAt || new Date().toISOString(),
      consentStatus: patient.consent.status,
      vitalsShared,
      vitals:
        vitalsShared && snap
          ? {
              heartRateBpm: snap.heartRateBpm,
              spo2Pct: snap.spo2Pct,
              skinTempC: snap.skinTempC,
              stepsCount: snap.stepsCount,
            }
          : undefined,
      gpsShared,
      locationSummary:
        gpsShared && snap
          ? {
              insideGeofence: snap.insideGeofence,
              safeZoneLabel: patient.thresholds.geofence.safeZoneLabel,
              distanceFromSafeZoneM: snap.distanceFromSafeZoneM,
            }
          : undefined,
      contacts: {
        careCentreDeskPhone: '+442079460199',
        residentDirectPhone: '+442079460888',
        primaryFamilyContact:
          patient.emergencyContacts[0]?.phoneE164 || '+447700900123',
      },
      recentAlertsWithDisposition: allPatientAlerts.slice(0, 10).map((a) => ({
        id: a.id,
        title: a.title,
        severity: a.severity,
        state: a.state,
        createdAt: a.createdAt,
        caregiverDisposition:
          a.caregiverDisposition ||
          (a.state === 'ACKNOWLEDGED'
            ? `Acknowledged by ${a.acknowledgedBy}; caregiver welfare check in progress.`
            : '24×7 Caregiver desk notified and responding.'),
        handledBy: a.closedBy || a.acknowledgedBy || a.assignedTo || '24×7 Care Desk',
      })),
    };
  }

  getFhirAndAbdmPreview(patientId: string): {
    fhirBundle: unknown;
    abdmConsentArtefact: unknown;
  } {
    const patient = this.patients.get(patientId);
    if (!patient) {
      throw new Error(`Patient ${patientId} not found`);
    }
    const device = this.devices.get(patient.bandDeviceId)!;
    const history = this.ingestionService.getPatientRawHistory(patientId, 1);
    const latestPacket: CanonicalTelemetryPacket = history[0] || {
      messageId: `msg-${patientId}`,
      deviceId: device.deviceId,
      patientId: patient.id,
      careCentreId: patient.careCentreId,
      vendorModel: device.vendorModel,
      firmwareVersion: device.firmwareVersion,
      eventType: 'VITALS_TELEMETRY',
      observedAt: new Date().toISOString(),
      receivedAt: new Date().toISOString(),
      sequenceNumber: 1,
      metrics: {
        heartRateBpm: patient.latestSnapshot?.heartRateBpm ?? 74,
        spo2Pct: patient.latestSnapshot?.spo2Pct ?? 97,
        skinTempC: patient.latestSnapshot?.skinTempC ?? 36.6,
        batteryPct: patient.latestSnapshot?.batteryPct ?? 88,
      },
      wearState: patient.latestSnapshot?.wearState ?? 'ON_WRIST',
    };

    return {
      fhirBundle: mapTelemetryToFhirR4Bundle(patient, device, latestPacket),
      abdmConsentArtefact: mapConsentToAbdmArtefact(patient.consent),
    };
  }

  listPatients(): PatientRecord[] {
    return Array.from(this.patients.values());
  }

  getPatient(patientId: string, actorId = 'Console-Caregiver', actorRole: StaffRole = 'CAREGIVER'): PatientRecord {
    const p = this.patients.get(patientId);
    if (!p) {
      throw new Error(`Patient ${patientId} not found`);
    }
    this.securityService.appendAuditLog({
      actorId,
      actorRole,
      careCentreId: p.careCentreId,
      action: 'PATIENT_DETAIL_ACCESSED',
      resourceType: 'PATIENT',
      resourceId: p.id,
      details: `Accessed resident profile & vitals for ${p.fullName}`,
    });
    return p;
  }

  listDevices(): WearableDevice[] {
    return Array.from(this.devices.values());
  }
}
