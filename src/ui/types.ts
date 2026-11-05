import type {
  AlertRecord,
  AuditLogEntry,
  CanonicalTelemetryPacket,
  PatientRecord,
  PatientThresholds,
  StaffRole,
  TimeSeriesRollupBucket,
  WearableDevice,
} from '../domain/canonical-schema.js';
import type { IngestionMetricsSummary } from '../ingestion/ingestion-service.js';
import type { FleetSimulationResult } from '../simulator/sim-5000-cli.js';
import type { FamilyCalmViewPayload } from '../server/platform-store.js';

export type {
  AlertRecord,
  AuditLogEntry,
  CanonicalTelemetryPacket,
  PatientRecord,
  PatientThresholds,
  StaffRole,
  TimeSeriesRollupBucket,
  WearableDevice,
  IngestionMetricsSummary,
  FleetSimulationResult,
  FamilyCalmViewPayload,
};

export interface BootstrapPayload {
  careCentre: {
    id: string;
    name: string;
    region: string;
  };
  patients: PatientRecord[];
  alerts: AlertRecord[];
  devices: WearableDevice[];
  auditLogs: AuditLogEntry[];
  auditIntegrity: {
    intact: boolean;
    totalEntries: number;
    brokenAtSequence?: number;
  };
  ingestionMetrics: IngestionMetricsSummary;
  rbacMatrix: Record<StaffRole, string[]>;
}

export interface PatientDetailPayload {
  patient: PatientRecord;
  rawHistory: CanonicalTelemetryPacket[];
  rollups: {
    '1m': TimeSeriesRollupBucket[];
    '5m': TimeSeriesRollupBucket[];
    '1h': TimeSeriesRollupBucket[];
  };
  fhirAbdm: {
    fhirBundle: Record<string, unknown>;
    abdmConsentArtefact: Record<string, unknown>;
  };
}

/**
 * Cross-Window / Cross-Tab BroadcastChannel so Standalone Windows (/console, /family, /simulator)
 * and the Unified Workspace Switcher stay 100% synchronized in real time.
 */
const syncChannel =
  typeof window !== 'undefined' && 'BroadcastChannel' in window
    ? new BroadcastChannel('carepulse_24x7_realtime_sync')
    : null;

export function notifyCrossWindowSync(reason: string): void {
  syncChannel?.postMessage({ type: 'SYNC_REQUIRED', reason, ts: Date.now() });
}

export function subscribeCrossWindowSync(callback: () => void): () => void {
  if (!syncChannel) return () => {};
  const handler = () => callback();
  syncChannel.addEventListener('message', handler);
  return () => syncChannel.removeEventListener('message', handler);
}
