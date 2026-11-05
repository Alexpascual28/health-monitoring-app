import {
  AlertSeverity,
  CanonicalTelemetryPacket,
  GeoPoint,
  PatientRecord,
} from '../domain/canonical-schema.js';

export interface RuleEvaluationCandidate {
  ruleCode: string;
  severity: AlertSeverity;
  title: string;
  /** Strictly non-diagnostic wellness/safety wording */
  summary: string;
  triggeredValue: string;
  thresholdReference: string;
  observedAt: string;
}

/**
 * Haversine formula calculating distance in meters between two GPS coordinates
 */
export function calculateHaversineDistanceMeters(a: GeoPoint, b: GeoPoint): number {
  const R = 6371e3; // Earth radius in meters
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);
  const h =
    sinDLat * sinDLat +
    Math.cos(lat1) * Math.cos(lat2) * sinDLng * sinDLng;
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  return Math.round(R * c);
}

/**
 * Multi-Tenant Configurable Rules & Geofencing Engine
 * Evaluates:
 * 1. Immediate band-emitted safety events (Fall detected, SOS button pressed)
 * 2. Sustained-breach windows (e.g., Heart Rate or SpO2 exceeding patient threshold across observation window)
 * 3. Composite conditions (e.g., High Heart Rate + On-Wrist + Zero Step Activity)
 * 4. GPS Safe-Zone Geofencing
 * 5. Wear-state and device battery thresholds
 */
export class WellnessRulesEngine {
  /**
   * Tracks when a sustained breach first started for key `${patientId}:${ruleCode}`
   */
  private breachStartMsByPatientRule = new Map<string, number>();

  evaluatePacket(
    patient: PatientRecord,
    packet: CanonicalTelemetryPacket
  ): {
    candidates: RuleEvaluationCandidate[];
    insideGeofence: boolean;
    distanceFromSafeZoneM: number;
  } {
    const candidates: RuleEvaluationCandidate[] = [];
    const t = patient.thresholds;
    const observedMs = Date.parse(packet.observedAt);

    // 1. Immediate Band-Emitted Hardware Events (No on-device algorithm on backend; consume band event directly)
    if (packet.eventType === 'SOS_PRESSED') {
      candidates.push({
        ruleCode: 'RULE_SOS_PRESSED',
        severity: 'CRITICAL',
        title: 'SOS Emergency Button Activated',
        summary: `${patient.preferredName} pressed the wearable SOS assistance button. Immediate caregiver welfare check required.`,
        triggeredValue: 'SOS_BUTTON_EVENT',
        thresholdReference: 'Band Hardware SOS Trigger',
        observedAt: packet.observedAt,
      });
    }

    if (packet.eventType === 'FALL_DETECTED') {
      candidates.push({
        ruleCode: 'RULE_FALL_DETECTED',
        severity: 'CRITICAL',
        title: 'Band Fall Impact Event Reported',
        summary: `Wearable band reported a fall impact event for ${patient.preferredName}. Please contact resident immediately to verify safety.`,
        triggeredValue: 'FALL_IMPACT_EVENT',
        thresholdReference: 'Band Hardware Fall Sensor',
        observedAt: packet.observedAt,
      });
    }

    // 2. Geofence Evaluation
    let insideGeofence = true;
    let distanceFromSafeZoneM = 0;
    const loc = packet.location || patient.latestSnapshot?.location;
    if (loc && t.geofence.enabled) {
      distanceFromSafeZoneM = calculateHaversineDistanceMeters(loc, {
        lat: t.geofence.centerLat,
        lng: t.geofence.centerLng,
      });
      insideGeofence = distanceFromSafeZoneM <= t.geofence.radiusMeters;
      if (!insideGeofence) {
        candidates.push({
          ruleCode: 'RULE_GEOFENCE_EXIT',
          severity: 'HIGH',
          title: 'Safe-Zone Boundary Exceeded',
          summary: `${patient.preferredName}'s wearable GPS reported ${distanceFromSafeZoneM}m from ${t.geofence.safeZoneLabel} (configured boundary: ${t.geofence.radiusMeters}m).`,
          triggeredValue: `${distanceFromSafeZoneM}m from safe zone`,
          thresholdReference: `<=${t.geofence.radiusMeters}m (${t.geofence.safeZoneLabel})`,
          observedAt: packet.observedAt,
        });
      }
    }

    // 3. Sustained-Breach Window: Heart Rate High / Low
    const hr = packet.metrics.heartRateBpm;
    if (hr !== undefined && packet.wearState === 'ON_WRIST') {
      const hrHighKey = `${patient.id}:RULE_HR_HIGH`;
      if (hr > t.hrHighBpm) {
        const firstSeen = this.breachStartMsByPatientRule.get(hrHighKey) ?? observedMs;
        this.breachStartMsByPatientRule.set(hrHighKey, firstSeen);
        const sustainedSec = Math.max(0, Math.round((observedMs - firstSeen) / 1000));

        if (sustainedSec >= t.hrSustainedWindowSec || hr >= t.hrHighBpm + 20) {
          candidates.push({
            ruleCode: 'RULE_HR_HIGH',
            severity: hr >= t.hrHighBpm + 25 ? 'CRITICAL' : 'HIGH',
            title: 'Elevated Heart Rate Threshold Exceeded',
            summary: `Wearable heart rate reading of ${hr} bpm exceeded configured upper wellness threshold (${t.hrHighBpm} bpm)${
              sustainedSec > 0 ? ` for ${sustainedSec}s` : ''
            }.`,
            triggeredValue: `${hr} bpm`,
            thresholdReference: `<=${t.hrHighBpm} bpm (window ${t.hrSustainedWindowSec}s)`,
            observedAt: packet.observedAt,
          });
        }
      } else {
        this.breachStartMsByPatientRule.delete(hrHighKey);
      }

      const hrLowKey = `${patient.id}:RULE_HR_LOW`;
      if (hr < t.hrLowBpm) {
        const firstSeen = this.breachStartMsByPatientRule.get(hrLowKey) ?? observedMs;
        this.breachStartMsByPatientRule.set(hrLowKey, firstSeen);
        const sustainedSec = Math.max(0, Math.round((observedMs - firstSeen) / 1000));
        if (sustainedSec >= t.hrSustainedWindowSec || hr <= t.hrLowBpm - 10) {
          candidates.push({
            ruleCode: 'RULE_HR_LOW',
            severity: 'HIGH',
            title: 'Low Heart Rate Threshold Breach',
            summary: `Wearable heart rate reading of ${hr} bpm is below configured lower wellness threshold (${t.hrLowBpm} bpm).`,
            triggeredValue: `${hr} bpm`,
            thresholdReference: `>=${t.hrLowBpm} bpm`,
            observedAt: packet.observedAt,
          });
        }
      } else {
        this.breachStartMsByPatientRule.delete(hrLowKey);
      }
    }

    // 4. Sustained-Breach Window: SpO2 Low
    const spo2 = packet.metrics.spo2Pct;
    if (spo2 !== undefined && packet.wearState === 'ON_WRIST') {
      const spo2Key = `${patient.id}:RULE_SPO2_LOW`;
      if (spo2 < t.spo2LowPct) {
        const firstSeen = this.breachStartMsByPatientRule.get(spo2Key) ?? observedMs;
        this.breachStartMsByPatientRule.set(spo2Key, firstSeen);
        const sustainedSec = Math.max(0, Math.round((observedMs - firstSeen) / 1000));
        if (sustainedSec >= t.spo2SustainedWindowSec || spo2 <= 88) {
          candidates.push({
            ruleCode: 'RULE_SPO2_LOW',
            severity: spo2 <= 88 ? 'CRITICAL' : 'HIGH',
            title: 'Blood Oxygen (SpO2) Below Configured Threshold',
            summary: `Wearable SpO2 sensor reported ${spo2}% for ${patient.preferredName}, below the configured ${t.spo2LowPct}% wellness threshold.`,
            triggeredValue: `${spo2}%`,
            thresholdReference: `>=${t.spo2LowPct}% (window ${t.spo2SustainedWindowSec}s)`,
            observedAt: packet.observedAt,
          });
        }
      } else {
        this.breachStartMsByPatientRule.delete(spo2Key);
      }
    }

    // 5. Skin Temperature Threshold
    const temp = packet.metrics.skinTempC;
    if (temp !== undefined && packet.wearState === 'ON_WRIST') {
      if (temp > t.skinTempHighC || temp < t.skinTempLowC) {
        candidates.push({
          ruleCode: 'RULE_SKIN_TEMP_BREACH',
          severity: 'MEDIUM',
          title: 'Skin Temperature Outside Wellness Range',
          summary: `Wearable skin temperature sensor reported ${temp.toFixed(1)}°C (configured range ${t.skinTempLowC}°C–${t.skinTempHighC}°C).`,
          triggeredValue: `${temp.toFixed(1)}°C`,
          thresholdReference: `${t.skinTempLowC}°C - ${t.skinTempHighC}°C`,
          observedAt: packet.observedAt,
        });
      }
    }

    // 6. Composite Rule: Elevated HR while stationary on-wrist
    if (
      t.compositeInactivityHighHr.enabled &&
      hr !== undefined &&
      hr >= t.compositeInactivityHighHr.hrThresholdBpm &&
      packet.wearState === 'ON_WRIST' &&
      (packet.metrics.stepsCount ?? 0) <= t.compositeInactivityHighHr.maxStepsInWindow
    ) {
      candidates.push({
        ruleCode: 'RULE_COMPOSITE_HR_STATIONARY',
        severity: 'HIGH',
        title: 'Composite Alert: Elevated Heart Rate at Rest',
        summary: `Composite condition met for ${patient.preferredName}: HR ${hr} bpm while stationary (${packet.metrics.stepsCount ?? 0} steps) and band on-wrist.`,
        triggeredValue: `HR ${hr} bpm + ${packet.metrics.stepsCount ?? 0} steps`,
        thresholdReference: `HR >= ${t.compositeInactivityHighHr.hrThresholdBpm} bpm at rest`,
        observedAt: packet.observedAt,
      });
    }

    // 7. Wear-State Off-Wrist Alert
    if (packet.wearState === 'OFF_WRIST') {
      candidates.push({
        ruleCode: 'RULE_BAND_OFF_WRIST',
        severity: 'MEDIUM',
        title: 'Wearable Band Removed (Off-Wrist)',
        summary: `${patient.preferredName}'s wearable band reported OFF_WRIST state. Vitals monitoring is paused until band is worn again.`,
        triggeredValue: 'OFF_WRIST',
        thresholdReference: 'Expected ON_WRIST',
        observedAt: packet.observedAt,
      });
    }

    // 8. Battery Level Thresholds
    const bat = packet.metrics.batteryPct;
    if (bat <= t.criticalBatteryPct) {
      candidates.push({
        ruleCode: 'RULE_BATTERY_CRITICAL',
        severity: 'HIGH',
        title: 'Wearable Battery Critically Low',
        summary: `Band ${packet.deviceId} for ${patient.preferredName} is at ${bat}% battery. Immediate charging prompt required to prevent telemetry loss.`,
        triggeredValue: `${bat}%`,
        thresholdReference: `>${t.criticalBatteryPct}%`,
        observedAt: packet.observedAt,
      });
    } else if (bat <= t.lowBatteryWarningPct) {
      candidates.push({
        ruleCode: 'RULE_BATTERY_LOW',
        severity: 'LOW',
        title: 'Wearable Battery Low Reminder',
        summary: `Band ${packet.deviceId} for ${patient.preferredName} is at ${bat}% battery.`,
        triggeredValue: `${bat}%`,
        thresholdReference: `>${t.lowBatteryWarningPct}%`,
        observedAt: packet.observedAt,
      });
    }

    return {
      candidates,
      insideGeofence,
      distanceFromSafeZoneM,
    };
  }
}
