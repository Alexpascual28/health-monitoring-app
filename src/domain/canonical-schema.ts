/**
 * Canonical Wearable Schema & Multi-Tenant Domain Model
 *
 * Non-negotiable positioning: Wellness & Safety Monitoring Service (not a medical/diagnostic device).
 * Band hardware emits Fall, SOS, Wear-State, and GPS events directly; backend translates, validates,
 * deduplicates, evaluates client-supplied configurable thresholds/geofences, and dispatches alerts.
 */

export type WearState = 'ON_WRIST' | 'OFF_WRIST' | 'CHARGING' | 'UNKNOWN';

export type BandDiscreteEventType =
  | 'VITALS_TELEMETRY'
  | 'FALL_DETECTED'
  | 'SOS_PRESSED'
  | 'WEAR_STATE_CHANGED'
  | 'GPS_FIX'
  | 'LOW_BATTERY';

export type AlertSeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

export type AlertState = 'OPEN' | 'ASSIGNED' | 'ACKNOWLEDGED' | 'ESCALATED' | 'CLOSED';

export type StaffRole =
  | 'SUPER_ADMIN'
  | 'CARE_CENTRE_ADMIN'
  | 'SHIFT_SUPERVISOR'
  | 'CAREGIVER'
  | 'ENROLMENT_OFFICER'
  | 'DEVICE_TECH'
  | 'AUDITOR'
  | 'FAMILY_MEMBER';

export type NotificationChannel = 'SMS_DLT' | 'VOICE_CALL' | 'PUSH_NOTIFICATION' | 'EMAIL';

export interface GeoPoint {
  lat: number;
  lng: number;
  accuracyM?: number;
}

/**
 * Canonical Telemetry & Event Packet produced by any IBandVendorAdapter
 */
export interface CanonicalTelemetryPacket {
  messageId: string;
  deviceId: string;
  patientId: string;
  careCentreId: string;
  vendorModel: string;
  firmwareVersion: string;
  eventType: BandDiscreteEventType;
  /** ISO-8601 timestamp when the wearable band observed the reading/event */
  observedAt: string;
  /** ISO-8601 timestamp when the ingestion gateway received the packet */
  receivedAt: string;
  sequenceNumber: number;
  isBufferedReplay?: boolean;
  metrics: {
    heartRateBpm?: number;
    spo2Pct?: number;
    skinTempC?: number;
    stepsCount?: number;
    batteryPct: number;
    signalRssiDbm?: number;
  };
  wearState: WearState;
  location?: GeoPoint;
  rawVendorEventCode?: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validates canonical telemetry packet for bounds and required fields
 */
export function validateCanonicalPacket(packet: Partial<CanonicalTelemetryPacket>): ValidationResult {
  const errors: string[] = [];

  if (!packet.messageId || typeof packet.messageId !== 'string') {
    errors.push('Missing or invalid messageId');
  }
  if (!packet.deviceId || typeof packet.deviceId !== 'string') {
    errors.push('Missing or invalid deviceId');
  }
  if (!packet.patientId || typeof packet.patientId !== 'string') {
    errors.push('Missing or invalid patientId');
  }
  if (!packet.careCentreId || typeof packet.careCentreId !== 'string') {
    errors.push('Missing or invalid careCentreId');
  }
  if (!packet.observedAt || Number.isNaN(Date.parse(packet.observedAt))) {
    errors.push('Missing or invalid observedAt ISO timestamp');
  }
  if (!packet.metrics || typeof packet.metrics.batteryPct !== 'number') {
    errors.push('Missing metrics.batteryPct');
  } else {
    if (packet.metrics.batteryPct < 0 || packet.metrics.batteryPct > 100) {
      errors.push('batteryPct out of range [0, 100]');
    }
    if (
      packet.metrics.heartRateBpm !== undefined &&
      (packet.metrics.heartRateBpm < 20 || packet.metrics.heartRateBpm > 260)
    ) {
      errors.push('heartRateBpm out of physiological sensor range [20, 260]');
    }
    if (
      packet.metrics.spo2Pct !== undefined &&
      (packet.metrics.spo2Pct < 50 || packet.metrics.spo2Pct > 100)
    ) {
      errors.push('spo2Pct out of sensor range [50, 100]');
    }
    if (
      packet.metrics.skinTempC !== undefined &&
      (packet.metrics.skinTempC < 25 || packet.metrics.skinTempC > 45)
    ) {
      errors.push('skinTempC out of sensor range [25, 45]');
    }
  }

  if (packet.location) {
    if (packet.location.lat < -90 || packet.location.lat > 90) {
      errors.push('location.lat out of range [-90, 90]');
    }
    if (packet.location.lng < -180 || packet.location.lng > 180) {
      errors.push('location.lng out of range [-180, 180]');
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Time-series roll-up bucket (1m, 5m, 1h)
 */
export interface TimeSeriesRollupBucket {
  patientId: string;
  careCentreId: string;
  resolution: '1m' | '5m' | '1h';
  bucketStartIso: string;
  sampleCount: number;
  hrMin: number;
  hrMax: number;
  hrAvg: number;
  spo2Min: number;
  spo2Max: number;
  spo2Avg: number;
  tempMin: number;
  tempMax: number;
  tempAvg: number;
}

/**
 * Per-patient configurable thresholds (Client-supplied, no-deploy changes)
 */
export interface PatientThresholds {
  hrHighBpm: number;
  hrLowBpm: number;
  /** Sustained breach window in seconds before raising sustained HR alert */
  hrSustainedWindowSec: number;
  spo2LowPct: number;
  spo2SustainedWindowSec: number;
  skinTempHighC: number;
  skinTempLowC: number;
  lowBatteryWarningPct: number;
  criticalBatteryPct: number;
  offWristAlertAfterSec: number;
  geofence: {
    enabled: boolean;
    centerLat: number;
    centerLng: number;
    radiusMeters: number;
    safeZoneLabel: string;
  };
  compositeInactivityHighHr: {
    enabled: boolean;
    hrThresholdBpm: number;
    maxStepsInWindow: number;
  };
  quietHours: {
    enabled: boolean;
    startHour24: number; // e.g. 22 for 22:00
    endHour24: number;   // e.g. 7 for 07:00
    timezone: string;
  };
  updatedAt: string;
  updatedBy: string;
}

export interface EmergencyContact {
  id: string;
  name: string;
  relationship: string;
  phoneE164: string;
  email: string;
  countryCode: string;
  isPrimaryFamilyAppUser: boolean;
}

/**
 * DPDP Act 2023 & ABDM-compatible Granular Consent Record
 */
export interface DPDPConsentRecord {
  consentId: string;
  patientId: string;
  careCentreId: string;
  dataPrincipalName: string;
  status: 'GRANTED' | 'WITHDRAWN' | 'EXPIRED';
  purpose: string;
  permissions: {
    continuousWearableMonitoring: boolean;
    shareVitalsWithFamilyApp: boolean;
    shareGpsLocationWithFamilyApp: boolean;
    emergencySmsVoiceAlerts: boolean;
    abdmHealthRecordLinkage: boolean;
  };
  retentionDays: number;
  grantedAt: string;
  withdrawnAt?: string;
  lastUpdatedBy: string;
  abdmArtefactId: string;
}

export interface PatientRecord {
  id: string;
  careCentreId: string;
  fullName: string;
  preferredName: string;
  age: number;
  gender: 'Female' | 'Male' | 'Other';
  roomOrFlat: string;
  homeAddress: string;
  bandDeviceId: string;
  caregiverNotes: string;
  emergencyContacts: EmergencyContact[];
  thresholds: PatientThresholds;
  consent: DPDPConsentRecord;
  latestSnapshot?: {
    observedAt: string;
    receivedAt: string;
    heartRateBpm: number;
    spo2Pct: number;
    skinTempC: number;
    stepsCount: number;
    batteryPct: number;
    wearState: WearState;
    location: GeoPoint;
    insideGeofence: boolean;
    distanceFromSafeZoneM: number;
  };
  enrolledAt: string;
}

export interface WearableDevice {
  deviceId: string;
  patientId: string;
  careCentreId: string;
  vendorModel: 'CarePulse-Band-Pro-V1' | 'VitalWatch-Hex-V2';
  firmwareVersion: string;
  serialNumber: string;
  certificateThumbprint: string;
  hmacKeyId: string;
  provisioningStatus: 'ACTIVE' | 'SUSPENDED' | 'REVOKED';
  onlineStatus: 'ONLINE' | 'OFFLINE';
  wearState: WearState;
  batteryPct: number;
  signalRssiDbm: number;
  lastSeenAt: string;
  provisionedAt: string;
}

export interface AlertEscalationStep {
  tier: 1 | 2 | 3;
  targetRole: string;
  waitSecondsBeforeNextTier: number;
  channels: NotificationChannel[];
}

export interface NotificationDeliveryReceipt {
  id: string;
  alertId: string;
  tier: number;
  channel: NotificationChannel;
  provider: string;
  recipient: string;
  dltTemplateId?: string;
  status: 'DELIVERED' | 'RETRYING' | 'FAILED_OVER' | 'SUPPRESSED_QUIET_HOURS';
  attempts: number;
  failoverUsed: boolean;
  timestamp: string;
  detail: string;
}

export interface AlertRecord {
  id: string;
  patientId: string;
  patientName: string;
  careCentreId: string;
  deviceId: string;
  ruleCode: string;
  title: string;
  /** Wellness/safety description only (zero diagnostic language) */
  summary: string;
  severity: AlertSeverity;
  state: AlertState;
  triggeredValue: string;
  thresholdReference: string;
  observedAt: string;
  createdAt: string;
  updatedAt: string;
  ingestionToAlertLatencyMs: number;
  assignedTo?: string;
  acknowledgedBy?: string;
  acknowledgedAt?: string;
  escalationTier: 1 | 2 | 3;
  nextEscalationAt?: string;
  closedBy?: string;
  closedAt?: string;
  caregiverDisposition?: string;
  duplicateCount: number;
  deliveries: NotificationDeliveryReceipt[];
}

export interface AuditLogEntry {
  id: string;
  sequence: number;
  timestamp: string;
  actorId: string;
  actorRole: StaffRole;
  careCentreId: string;
  action: string;
  resourceType: 'PATIENT' | 'VITALS' | 'THRESHOLD' | 'ALERT' | 'CONSENT' | 'DEVICE' | 'AUTH' | 'ROSTER';
  resourceId: string;
  ipAddress: string;
  mfaVerified: boolean;
  details: string;
  previousHash: string;
  entryHash: string;
}
