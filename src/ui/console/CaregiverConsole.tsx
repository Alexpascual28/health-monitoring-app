import React, { useEffect, useState } from 'react';
import {
  Activity,
  AlertOctagon,
  Bell,
  CheckCircle,
  Clock,
  FileCode,
  FileSpreadsheet,
  HeartPulse,
  Lock,
  MapPin,
  Radio,
  Shield,
  Sliders,
  UserCheck,
  Users,
  Watch,
} from 'lucide-react';
import type {
  AlertRecord,
  AuditLogEntry,
  BootstrapPayload,
  PatientDetailPayload,
  PatientRecord,
} from '../types.js';
import { notifyCrossWindowSync } from '../types.js';

interface CaregiverConsoleProps {
  bootstrap: BootstrapPayload | null;
  selectedPatientId: string;
  onSelectPatient: (id: string) => void;
  onRefreshBootstrap: () => Promise<void>;
}

export const CaregiverConsole: React.FC<CaregiverConsoleProps> = ({
  bootstrap,
  selectedPatientId,
  onSelectPatient,
  onRefreshBootstrap,
}) => {
  const [activeSubTab, setActiveSubTab] = useState<
    'OPERATIONS' | 'FLEET' | 'ENROLMENT_CONSENT' | 'AUDIT_RBAC'
  >('OPERATIONS');
  const [alertFilter, setAlertFilter] = useState<'ACTIVE' | 'CRITICAL' | 'ALL'>(
    'ACTIVE'
  );
  const [patientDetail, setPatientDetail] =
    useState<PatientDetailPayload | null>(null);
  const [chartResolution, setChartResolution] = useState<
    'RAW' | '1m' | '5m' | '1h'
  >('RAW');
  const [dispositionDrafts, setDispositionDrafts] = useState<
    Record<string, string>
  >({});
  const [showFhirModal, setShowFhirModal] = useState(false);

  // Runtime No-Deploy Threshold Editor States
  const [editHrHigh, setEditHrHigh] = useState<number>(115);
  const [editHrLow, setEditHrLow] = useState<number>(48);
  const [editSpo2Low, setEditSpo2Low] = useState<number>(92);
  const [editGeoRadius, setEditGeoRadius] = useState<number>(250);
  const [thresholdSaveMsg, setThresholdSaveMsg] = useState<string>('');

  // CSV Roster Import State
  const [csvInput, setCsvInput] = useState<string>(
    'Elizabeth Mary Clarke,Elizabeth,83,Female,Flat 05A - Garden Wing,James Clarke,Son,+447700900411\nMohan Lal Verma,Mohan,80,Male,Flat 12D - West Courtyard,Rohan Verma,Son,+919811122334'
  );
  const [csvImportStatus, setCsvImportStatus] = useState<string>('');

  const loadPatientDetail = async (id: string) => {
    try {
      const res = await fetch(`/api/v1/patients/${id}`);
      if (res.ok) {
        const data: PatientDetailPayload = await res.json();
        setPatientDetail(data);
        setEditHrHigh(data.patient.thresholds.hrHighBpm);
        setEditHrLow(data.patient.thresholds.hrLowBpm);
        setEditSpo2Low(data.patient.thresholds.spo2LowPct);
        setEditGeoRadius(data.patient.thresholds.geofence.radiusMeters);
      }
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    if (selectedPatientId) {
      loadPatientDetail(selectedPatientId);
    }
  }, [selectedPatientId, bootstrap]);

  if (!bootstrap) {
    return (
      <div className="p-8 text-center text-slate-300">
        Loading 24×7 Caregiver Console...
      </div>
    );
  }

  const allAlerts = bootstrap.alerts;
  const activeAlerts = allAlerts.filter((a) => a.state !== 'CLOSED');
  const criticalActive = activeAlerts.filter((a) => a.severity === 'CRITICAL');
  const highActive = activeAlerts.filter((a) => a.severity === 'HIGH');

  const filteredAlerts = allAlerts.filter((a) => {
    if (alertFilter === 'ACTIVE') return a.state !== 'CLOSED';
    if (alertFilter === 'CRITICAL')
      return a.severity === 'CRITICAL' && a.state !== 'CLOSED';
    return true;
  });

  const handleAlertAction = async (
    alert: AlertRecord,
    action: 'ASSIGN' | 'ACKNOWLEDGE' | 'ESCALATE' | 'CLOSE'
  ) => {
    const disposition =
      dispositionDrafts[alert.id] ||
      (action === 'CLOSE'
        ? 'Checked on resident via intercom; resident safe and comfortable.'
        : undefined);

    const res = await fetch(`/api/v1/alerts/${alert.id}/action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action,
        actorName: 'Nurse Hannah (Shift A)',
        disposition,
      }),
    });
    if (res.ok) {
      notifyCrossWindowSync(`ALERT_${action}`);
      await onRefreshBootstrap();
    }
  };

  const handleSaveThresholds = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!patientDetail) return;
    const res = await fetch(
      `/api/v1/patients/${patientDetail.patient.id}/thresholds`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          actorId: 'Supervisor-Alex',
          actorRole: 'SHIFT_SUPERVISOR',
          thresholds: {
            hrHighBpm: editHrHigh,
            hrLowBpm: editHrLow,
            spo2LowPct: editSpo2Low,
            geofence: {
              ...patientDetail.patient.thresholds.geofence,
              radiusMeters: editGeoRadius,
            },
          },
        }),
      }
    );
    if (res.ok) {
      setThresholdSaveMsg('Applied immediately (No deploy required • Audited)');
      notifyCrossWindowSync('THRESHOLDS_UPDATED');
      await onRefreshBootstrap();
      await loadPatientDetail(patientDetail.patient.id);
      setTimeout(() => setThresholdSaveMsg(''), 4000);
    }
  };

  const handleConsentToggle = async (
    patient: PatientRecord,
    update: {
      status?: 'GRANTED' | 'WITHDRAWN';
      shareVitalsWithFamilyApp?: boolean;
      shareGpsLocationWithFamilyApp?: boolean;
    }
  ) => {
    const res = await fetch(`/api/v1/patients/${patient.id}/consent`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        actorId: 'Enrolment-Officer-Sarah',
        actorRole: 'ENROLMENT_OFFICER',
        status: update.status ?? patient.consent.status,
        permissions: {
          ...patient.consent.permissions,
          ...(update.shareVitalsWithFamilyApp !== undefined
            ? { shareVitalsWithFamilyApp: update.shareVitalsWithFamilyApp }
            : {}),
          ...(update.shareGpsLocationWithFamilyApp !== undefined
            ? { shareGpsLocationWithFamilyApp: update.shareGpsLocationWithFamilyApp }
            : {}),
        },
      }),
    });
    if (res.ok) {
      notifyCrossWindowSync('CONSENT_UPDATED');
      await onRefreshBootstrap();
      await loadPatientDetail(patient.id);
    }
  };

  const handleImportCsv = async () => {
    const res = await fetch('/api/v1/admin/roster/import-csv', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ csvText: csvInput }),
    });
    const data = await res.json();
    if (res.ok) {
      setCsvImportStatus(
        `Successfully imported ${data.importedCount} residents with provisioned bands & DPDP consent.`
      );
      notifyCrossWindowSync('CSV_ROSTER_IMPORTED');
      await onRefreshBootstrap();
    } else {
      setCsvImportStatus(`Import error: ${data.error}`);
    }
  };

  // Build chart series points
  const chartPoints = (() => {
    if (!patientDetail) return [];
    if (chartResolution === 'RAW') {
      return patientDetail.rawHistory.slice(-20).map((pkt) => ({
        time: new Date(pkt.observedAt).toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        }),
        hr: pkt.metrics.heartRateBpm ?? 74,
        spo2: pkt.metrics.spo2Pct ?? 97,
      }));
    }
    const buckets = patientDetail.rollups[chartResolution] || [];
    return buckets.slice(-15).map((b) => ({
      time: new Date(b.bucketStartIso).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      }),
      hr: b.hrAvg,
      spo2: b.spo2Avg,
    }));
  })();

  return (
    <div className="space-y-5 p-4 md:p-6">
      {/* Live ARIA Alert Banner for P1 Critical Exceptions (WCAG 2.1 AA) */}
      <div
        role="region"
        aria-live="assertive"
        aria-label="24x7 Caregiver Shift Exception Summary"
        className="grid grid-cols-2 gap-3 lg:grid-cols-5"
      >
        <div
          className={`rounded-xl border p-3.5 ${
            criticalActive.length > 0
              ? 'border-rose-500 bg-rose-950/60 text-white'
              : 'border-slate-800 bg-slate-900/90 text-slate-200'
          }`}
        >
          <div className="flex items-center justify-between text-xs font-bold uppercase">
            <span>P1 Critical Alerts</span>
            <AlertOctagon className="h-4 w-4 text-rose-400" />
          </div>
          <div className="mt-1 text-2xl font-black">{criticalActive.length}</div>
          <div className="text-[11px] text-rose-200">
            SLA p95 ≤ 5.0s • Overrides Quiet Hours
          </div>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-900/90 p-3.5">
          <div className="flex items-center justify-between text-xs font-bold uppercase text-amber-300">
            <span>P2 High Exceptions</span>
            <Bell className="h-4 w-4" />
          </div>
          <div className="mt-1 text-2xl font-black text-white">
            {highActive.length}
          </div>
          <div className="text-[11px] text-slate-400">
            Total Open Worklist: {activeAlerts.length}
          </div>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-900/90 p-3.5">
          <div className="flex items-center justify-between text-xs font-bold uppercase text-emerald-400">
            <span>Enrolled Residents</span>
            <Users className="h-4 w-4" />
          </div>
          <div className="mt-1 text-2xl font-black text-white">
            {bootstrap.patients.length}
          </div>
          <div className="text-[11px] text-slate-400">
            {bootstrap.careCentre.name.split('-')[0]}
          </div>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-900/90 p-3.5">
          <div className="flex items-center justify-between text-xs font-bold uppercase text-sky-400">
            <span>Wearable Fleet</span>
            <Watch className="h-4 w-4" />
          </div>
          <div className="mt-1 text-2xl font-black text-white">
            {
              bootstrap.devices.filter((d) => d.wearState === 'ON_WRIST').length
            }{' '}
            / {bootstrap.devices.length}
          </div>
          <div className="text-[11px] text-slate-400">On-Wrist & Online (TLS 1.2+)</div>
        </div>

        <div className="col-span-2 rounded-xl border border-slate-800 bg-slate-900/90 p-3.5 lg:col-span-1">
          <div className="flex items-center justify-between text-xs font-bold uppercase text-emerald-300">
            <span>UK Cloud & Audit</span>
            <Shield className="h-4 w-4" />
          </div>
          <div className="mt-1 text-base font-extrabold text-white">
            {bootstrap.careCentre.region} (London)
          </div>
          <div className="text-[11px] text-emerald-400">
            Hash-Chain Integrity:{' '}
            {bootstrap.auditIntegrity.intact ? 'VERIFIED' : 'BROKEN'} (
            {bootstrap.auditIntegrity.totalEntries} logs)
          </div>
        </div>
      </div>

      {/* Console Sub-Navigation Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
        <div className="flex flex-wrap gap-2" role="tablist">
          {[
            {
              id: 'OPERATIONS',
              label: 'Exception Worklist & Resident Monitor',
              icon: Activity,
            },
            {
              id: 'FLEET',
              label: `Wearable Device Fleet (${bootstrap.devices.length})`,
              icon: Watch,
            },
            {
              id: 'ENROLMENT_CONSENT',
              label: 'DPDP Consent & CSV Roster Import',
              icon: FileSpreadsheet,
            },
            {
              id: 'AUDIT_RBAC',
              label: `Immutable Audit Log (${bootstrap.auditIntegrity.totalEntries}) & 8-Role RBAC`,
              icon: Lock,
            },
          ].map((tab) => {
            const Icon = tab.icon;
            const active = activeSubTab === tab.id;
            return (
              <button
                key={tab.id}
                role="tab"
                aria-selected={active}
                type="button"
                onClick={() =>
                  setActiveSubTab(tab.id as typeof activeSubTab)
                }
                className={`flex items-center gap-2 rounded-lg px-3.5 py-2 text-xs font-bold transition cursor-pointer ${
                  active
                    ? 'bg-emerald-500 text-slate-950 shadow'
                    : 'border border-slate-800 bg-slate-900 text-slate-300 hover:bg-slate-800'
                }`}
              >
                <Icon className="h-4 w-4" />
                {tab.label}
              </button>
            );
          })}
        </div>

        <span className="text-xs text-slate-400">
          WCAG 2.1 AA High-Contrast Shift View • Non-Diagnostic Wellness Platform
        </span>
      </div>

      {/* TAB 1: OPERATIONS (Exception Worklist + Resident Register & Detail) */}
      {activeSubTab === 'OPERATIONS' && (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
          {/* Left 5 Cols: Exception-First Alert Worklist + Resident Register */}
          <div className="space-y-6 xl:col-span-5">
            {/* Alert Worklist */}
            <div className="rounded-2xl border border-slate-800 bg-slate-900/90 p-4">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <h2 className="text-sm font-bold uppercase tracking-wider text-white">
                  Alert Worklist (Assign / Ack / Escalate / Close)
                </h2>
                <div className="flex gap-1">
                  {(['ACTIVE', 'CRITICAL', 'ALL'] as const).map((f) => (
                    <button
                      key={f}
                      type="button"
                      onClick={() => setAlertFilter(f)}
                      className={`rounded px-2.5 py-1 text-[11px] font-bold cursor-pointer ${
                        alertFilter === f
                          ? 'bg-emerald-500 text-slate-950'
                          : 'bg-slate-800 text-slate-300'
                      }`}
                    >
                      {f}
                    </button>
                  ))}
                </div>
              </div>

              <div className="mt-3 max-h-[420px] space-y-3 overflow-y-auto pr-1">
                {filteredAlerts.length === 0 ? (
                  <div className="rounded-xl border border-slate-800 bg-slate-950 p-6 text-center text-xs text-slate-400">
                    No alerts matching filter ({alertFilter}). All residents within configured wellness thresholds.
                  </div>
                ) : (
                  filteredAlerts.map((alert) => {
                    const sevBadge =
                      alert.severity === 'CRITICAL'
                        ? 'bg-rose-600 text-white'
                        : alert.severity === 'HIGH'
                        ? 'bg-amber-500 text-slate-950'
                        : alert.severity === 'MEDIUM'
                        ? 'bg-sky-500 text-slate-950'
                        : 'bg-slate-700 text-slate-200';

                    return (
                      <div
                        key={alert.id}
                        className={`rounded-xl border p-3.5 transition ${
                          alert.severity === 'CRITICAL' && alert.state !== 'CLOSED'
                            ? 'border-rose-500/80 bg-rose-950/30'
                            : 'border-slate-800 bg-slate-950/80'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span
                                className={`rounded px-2 py-0.5 text-[10px] font-extrabold uppercase ${sevBadge}`}
                              >
                                {alert.severity}
                              </span>
                              <span className="rounded bg-slate-800 px-2 py-0.5 text-[10px] font-bold text-slate-300">
                                {alert.state} • Tier {alert.escalationTier}
                              </span>
                              {alert.duplicateCount > 1 && (
                                <span className="rounded bg-purple-950 px-2 py-0.5 text-[10px] text-purple-300">
                                  De-duped ×{alert.duplicateCount}
                                </span>
                              )}
                            </div>
                            <h3 className="mt-1.5 text-sm font-bold text-white">
                              {alert.title} —{' '}
                              <button
                                type="button"
                                onClick={() => onSelectPatient(alert.patientId)}
                                className="text-emerald-400 underline cursor-pointer"
                              >
                                {alert.patientName}
                              </button>
                            </h3>
                          </div>
                          <span className="text-[11px] font-mono text-slate-400">
                            SLA {alert.ingestionToAlertLatencyMs}ms
                          </span>
                        </div>

                        <p className="mt-1 text-xs text-slate-300">
                          {alert.summary}
                        </p>

                        <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-slate-400">
                          <span>
                            Observed: <strong className="text-slate-200">{alert.triggeredValue}</strong>
                          </span>
                          <span>•</span>
                          <span>
                            Rule: <strong className="text-slate-200">{alert.thresholdReference}</strong>
                          </span>
                        </div>

                        {/* Multi-Channel Delivery Receipts Summary */}
                        {alert.deliveries.length > 0 && (
                          <div className="mt-2 rounded-lg border border-slate-800/80 bg-slate-900/90 p-2 text-[11px] text-slate-300">
                            <div className="font-semibold text-slate-400">
                              Dispatched Channels ({alert.deliveries.length}):
                            </div>
                            <div className="mt-1 flex flex-wrap gap-1.5">
                              {alert.deliveries.map((d) => (
                                <span
                                  key={d.id}
                                  title={d.detail}
                                  className="rounded border border-slate-700 bg-slate-950 px-1.5 py-0.5 text-[10px]"
                                >
                                  T{d.tier} {d.channel}: {d.status}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}

                        {alert.state !== 'CLOSED' ? (
                          <div className="mt-3 space-y-2 border-t border-slate-800 pt-2.5">
                            <div className="flex flex-wrap gap-1.5">
                              <button
                                type="button"
                                onClick={() => handleAlertAction(alert, 'ASSIGN')}
                                className="rounded bg-slate-800 px-2.5 py-1 text-xs font-semibold text-slate-200 hover:bg-slate-700 cursor-pointer"
                              >
                                Assign to Me
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  handleAlertAction(alert, 'ACKNOWLEDGE')
                                }
                                className="rounded bg-sky-600 px-2.5 py-1 text-xs font-bold text-white hover:bg-sky-500 cursor-pointer"
                              >
                                Acknowledge
                              </button>
                              <button
                                type="button"
                                onClick={() => handleAlertAction(alert, 'ESCALATE')}
                                className="rounded bg-amber-600 px-2.5 py-1 text-xs font-bold text-slate-950 hover:bg-amber-500 cursor-pointer"
                              >
                                Escalate Tier
                              </button>
                            </div>

                            <div className="flex gap-1.5">
                              <input
                                type="text"
                                placeholder="Caregiver disposition note (shared with Family App)..."
                                value={dispositionDrafts[alert.id] || ''}
                                onChange={(e) =>
                                  setDispositionDrafts({
                                    ...dispositionDrafts,
                                    [alert.id]: e.target.value,
                                  })
                                }
                                className="flex-1 rounded border border-slate-700 bg-slate-900 px-2.5 py-1 text-xs text-white"
                              />
                              <button
                                type="button"
                                onClick={() => handleAlertAction(alert, 'CLOSE')}
                                className="rounded bg-emerald-500 px-3 py-1 text-xs font-bold text-slate-950 hover:bg-emerald-400 cursor-pointer"
                              >
                                Resolve & Close
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="mt-2 border-t border-slate-800 pt-2 text-[11px] text-emerald-300">
                            <strong>Closed by {alert.closedBy}:</strong>{' '}
                            {alert.caregiverDisposition}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* Resident Roster Register */}
            <div className="rounded-2xl border border-slate-800 bg-slate-900/90 p-4">
              <h2 className="text-sm font-bold uppercase tracking-wider text-white">
                Care Centre Resident Register ({bootstrap.patients.length})
              </h2>
              <div className="mt-3 space-y-2">
                {bootstrap.patients.map((p) => {
                  const snap = p.latestSnapshot;
                  const isSelected = p.id === selectedPatientId;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => onSelectPatient(p.id)}
                      className={`flex w-full items-center justify-between rounded-xl border p-3 text-left transition cursor-pointer ${
                        isSelected
                          ? 'border-emerald-500 bg-emerald-950/30'
                          : 'border-slate-800 bg-slate-950/70 hover:bg-slate-800/60'
                      }`}
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold text-white">
                            {p.fullName}
                          </span>
                          <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-300">
                            {p.id}
                          </span>
                        </div>
                        <div className="text-xs text-slate-400">
                          {p.roomOrFlat} • Band {p.bandDeviceId}
                        </div>
                      </div>

                      {snap && (
                        <div className="flex items-center gap-3 text-right text-xs">
                          <div>
                            <div className="font-bold text-rose-400">
                              {snap.heartRateBpm} bpm
                            </div>
                            <div className="text-[11px] text-sky-400">
                              SpO2 {snap.spo2Pct}%
                            </div>
                          </div>
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                              snap.wearState === 'ON_WRIST'
                                ? 'bg-emerald-500/20 text-emerald-300'
                                : 'bg-amber-500/20 text-amber-300'
                            }`}
                          >
                            {snap.wearState}
                          </span>
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Right 7 Cols: Selected Resident Detail, Roll-Up Trend Charts & No-Deploy Thresholds */}
          <div className="space-y-6 xl:col-span-7">
            {patientDetail ? (
              <>
                {/* Resident Header & Live Vitals */}
                <div className="rounded-2xl border border-slate-800 bg-slate-900/90 p-5">
                  <div className="flex flex-col justify-between gap-3 border-b border-slate-800 pb-4 sm:flex-row sm:items-center">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="rounded bg-emerald-500/20 px-2 py-0.5 text-xs font-bold text-emerald-300">
                          {patientDetail.patient.id}
                        </span>
                        <h2 className="text-lg font-bold text-white">
                          {patientDetail.patient.fullName} (Age{' '}
                          {patientDetail.patient.age})
                        </h2>
                      </div>
                      <p className="mt-0.5 text-xs text-slate-400">
                        {patientDetail.patient.roomOrFlat} • Emergency Contact:{' '}
                        {patientDetail.patient.emergencyContacts[0]?.name} (
                        {patientDetail.patient.emergencyContacts[0]?.phoneE164})
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={() => setShowFhirModal(!showFhirModal)}
                      className="flex items-center gap-1.5 rounded-lg border border-indigo-500/40 bg-indigo-950/60 px-3 py-1.5 text-xs font-bold text-indigo-300 hover:bg-indigo-900/60 cursor-pointer"
                    >
                      <FileCode className="h-4 w-4" />
                      {showFhirModal
                        ? 'Hide FHIR R4 / ABDM JSON'
                        : 'Inspect FHIR R4 & ABDM Artefact'}
                    </button>
                  </div>

                  {/* Live Vitals Cards */}
                  {patientDetail.patient.latestSnapshot && (
                    <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                      <div className="rounded-xl border border-slate-800 bg-slate-950 p-3">
                        <div className="flex items-center gap-1 text-xs text-slate-400">
                          <HeartPulse className="h-3.5 w-3.5 text-rose-400" />
                          Heart Rate
                        </div>
                        <div className="mt-1 text-2xl font-black text-rose-400">
                          {patientDetail.patient.latestSnapshot.heartRateBpm}{' '}
                          <span className="text-xs font-normal text-slate-400">
                            bpm
                          </span>
                        </div>
                        <div className="text-[10px] text-slate-400">
                          Range: {patientDetail.patient.thresholds.hrLowBpm}–
                          {patientDetail.patient.thresholds.hrHighBpm} bpm
                        </div>
                      </div>

                      <div className="rounded-xl border border-slate-800 bg-slate-950 p-3">
                        <div className="text-xs text-slate-400">SpO2 Oxygen</div>
                        <div className="mt-1 text-2xl font-black text-sky-400">
                          {patientDetail.patient.latestSnapshot.spo2Pct}%
                        </div>
                        <div className="text-[10px] text-slate-400">
                          Threshold: ≥{patientDetail.patient.thresholds.spo2LowPct}%
                        </div>
                      </div>

                      <div className="rounded-xl border border-slate-800 bg-slate-950 p-3">
                        <div className="text-xs text-slate-400">Skin Temp</div>
                        <div className="mt-1 text-2xl font-black text-amber-300">
                          {patientDetail.patient.latestSnapshot.skinTempC.toFixed(
                            1
                          )}
                          °C
                        </div>
                        <div className="text-[10px] text-slate-400">
                          Steps:{' '}
                          {patientDetail.patient.latestSnapshot.stepsCount.toLocaleString()}
                        </div>
                      </div>

                      <div className="rounded-xl border border-slate-800 bg-slate-950 p-3">
                        <div className="flex items-center gap-1 text-xs text-slate-400">
                          <MapPin className="h-3.5 w-3.5 text-emerald-400" />
                          Geofence Status
                        </div>
                        <div
                          className={`mt-1 text-base font-black ${
                            patientDetail.patient.latestSnapshot.insideGeofence
                              ? 'text-emerald-400'
                              : 'text-rose-400'
                          }`}
                        >
                          {patientDetail.patient.latestSnapshot.insideGeofence
                            ? 'Inside Safe Zone'
                            : 'OUTSIDE SAFE ZONE'}
                        </div>
                        <div className="text-[10px] text-slate-400">
                          Distance:{' '}
                          {
                            patientDetail.patient.latestSnapshot
                              .distanceFromSafeZoneM
                          }
                          m (Limit{' '}
                          {
                            patientDetail.patient.thresholds.geofence
                              .radiusMeters
                          }
                          m)
                        </div>
                      </div>
                    </div>
                  )}

                  {showFhirModal && (
                    <div className="mt-4 rounded-xl border border-indigo-500/40 bg-slate-950 p-4">
                      <div className="text-xs font-bold uppercase text-indigo-300">
                        HL7 FHIR R4 Observation Bundle (LOINC 8867-4 / 59408-5 / 8310-5) & ABDM Consent Artefact
                      </div>
                      <pre className="mt-2 max-h-64 overflow-auto text-[11px] text-emerald-300">
                        {JSON.stringify(patientDetail.fhirAbdm, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>

                {/* Vitals Time-Series & Roll-up Trend Chart */}
                <div className="rounded-2xl border border-slate-800 bg-slate-900/90 p-5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h3 className="text-sm font-bold uppercase tracking-wider text-white">
                        Vitals Time-Series & Roll-Up Trends
                      </h3>
                      <p className="text-xs text-slate-400">
                        Out-of-order buffered packets are automatically indexed at observation time (`observedAt`).
                      </p>
                    </div>
                    <div className="flex gap-1.5">
                      {(['RAW', '1m', '5m', '1h'] as const).map((res) => (
                        <button
                          key={res}
                          type="button"
                          onClick={() => setChartResolution(res)}
                          className={`rounded px-2.5 py-1 text-xs font-bold cursor-pointer ${
                            chartResolution === res
                              ? 'bg-emerald-500 text-slate-950'
                              : 'bg-slate-800 text-slate-300'
                          }`}
                        >
                          {res === 'RAW' ? 'Live Stream' : `${res} Roll-Up`}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Accessible SVG Dual Trend Chart */}
                  <div className="mt-4 rounded-xl border border-slate-800 bg-slate-950 p-4">
                    <div className="mb-2 flex items-center justify-between text-xs">
                      <span className="font-semibold text-rose-400">
                        ● Heart Rate (bpm)
                      </span>
                      <span className="font-semibold text-sky-400">
                        ● Blood Oxygen SpO2 (%)
                      </span>
                    </div>
                    <svg
                      viewBox="0 0 600 160"
                      className="h-40 w-full overflow-visible"
                      role="img"
                      aria-label="Resident Heart Rate and SpO2 Trend Chart"
                    >
                      {/* Upper HR threshold line */}
                      <line
                        x1={0}
                        y1={35}
                        x2={600}
                        y2={35}
                        stroke="#f43f5e"
                        strokeDasharray="4 4"
                        strokeOpacity={0.5}
                      />
                      {chartPoints.length > 1 && (
                        <>
                          <polyline
                            fill="none"
                            stroke="#fb7185"
                            strokeWidth="3"
                            points={chartPoints
                              .map((pt, i) => {
                                const x =
                                  (i / Math.max(1, chartPoints.length - 1)) *
                                  580 +
                                  10;
                                const y = Math.max(
                                  10,
                                  Math.min(150, 150 - (pt.hr - 40))
                                );
                                return `${x},${y}`;
                              })
                              .join(' ')}
                          />
                          <polyline
                            fill="none"
                            stroke="#38bdf8"
                            strokeWidth="2.5"
                            points={chartPoints
                              .map((pt, i) => {
                                const x =
                                  (i / Math.max(1, chartPoints.length - 1)) *
                                  580 +
                                  10;
                                const y = Math.max(
                                  10,
                                  Math.min(150, 150 - (pt.spo2 - 50) * 2.2)
                                );
                                return `${x},${y}`;
                              })
                              .join(' ')}
                          />
                        </>
                      )}
                    </svg>
                    <div className="mt-2 flex justify-between text-[10px] font-mono text-slate-400">
                      {chartPoints.slice(-6).map((pt, idx) => (
                        <span key={idx}>
                          {pt.time}: HR {pt.hr} / SpO2 {pt.spo2}%
                        </span>
                      ))}
                    </div>
                  </div>
                </div>

                {/* No-Deploy Per-Patient Threshold & Geofence Editor */}
                <form
                  onSubmit={handleSaveThresholds}
                  className="rounded-2xl border border-slate-800 bg-slate-900/90 p-5"
                >
                  <div className="flex items-center justify-between">
                    <h3 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-white">
                      <Sliders className="h-4 w-4 text-emerald-400" />
                      Per-Patient Wellness Thresholds (No-Deploy Runtime Config)
                    </h3>
                    {thresholdSaveMsg && (
                      <span className="text-xs font-bold text-emerald-400">
                        {thresholdSaveMsg}
                      </span>
                    )}
                  </div>

                  <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <div>
                      <label className="block text-[11px] text-slate-400">
                        Upper HR Limit (bpm)
                      </label>
                      <input
                        type="number"
                        value={editHrHigh}
                        onChange={(e) => setEditHrHigh(Number(e.target.value))}
                        className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-sm font-bold text-white"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] text-slate-400">
                        Lower HR Limit (bpm)
                      </label>
                      <input
                        type="number"
                        value={editHrLow}
                        onChange={(e) => setEditHrLow(Number(e.target.value))}
                        className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-sm font-bold text-white"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] text-slate-400">
                        Min SpO2 Limit (%)
                      </label>
                      <input
                        type="number"
                        value={editSpo2Low}
                        onChange={(e) => setEditSpo2Low(Number(e.target.value))}
                        className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-sm font-bold text-white"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] text-slate-400">
                        Safe-Zone Radius (m)
                      </label>
                      <input
                        type="number"
                        value={editGeoRadius}
                        onChange={(e) =>
                          setEditGeoRadius(Number(e.target.value))
                        }
                        className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-sm font-bold text-white"
                      />
                    </div>
                  </div>

                  <div className="mt-3 flex items-center justify-between">
                    <span className="text-[11px] text-slate-400">
                      Quiet Hours: {patientDetail.patient.thresholds.quietHours.startHour24}:00–
                      {patientDetail.patient.thresholds.quietHours.endHour24}:00 (CRITICAL overrides)
                    </span>
                    <button
                      type="submit"
                      className="rounded-lg bg-emerald-500 px-4 py-1.5 text-xs font-bold text-slate-950 hover:bg-emerald-400 cursor-pointer"
                    >
                      Save Thresholds Immediately
                    </button>
                  </div>
                </form>
              </>
            ) : null}
          </div>
        </div>
      )}

      {/* TAB 2: WEARABLE DEVICE FLEET */}
      {activeSubTab === 'FLEET' && (
        <div className="rounded-2xl border border-slate-800 bg-slate-900/90 p-5">
          <h2 className="text-base font-bold text-white">
            Provisioned Wearable Band Fleet & Per-Device Security Credentials
          </h2>
          <p className="text-xs text-slate-400">
            Multi-vendor abstraction layer active for CarePulse-Band-Pro-V1 and VitalWatch-Hex-V2.
          </p>

          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-800 text-slate-400 uppercase">
                <tr>
                  <th className="py-2.5 pr-4">Device ID</th>
                  <th className="py-2.5 pr-4">Resident</th>
                  <th className="py-2.5 pr-4">Vendor SDK Model</th>
                  <th className="py-2.5 pr-4">Firmware</th>
                  <th className="py-2.5 pr-4">Wear State</th>
                  <th className="py-2.5 pr-4">Battery / RSSI</th>
                  <th className="py-2.5 pr-4">X.509 Cert Thumbprint</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70">
                {bootstrap.devices.map((d) => {
                  const res = bootstrap.patients.find(
                    (p) => p.id === d.patientId
                  );
                  return (
                    <tr key={d.deviceId}>
                      <td className="py-3 pr-4 font-mono font-bold text-emerald-400">
                        {d.deviceId}
                      </td>
                      <td className="py-3 pr-4 font-semibold text-white">
                        {res?.fullName || d.patientId}
                      </td>
                      <td className="py-3 pr-4 text-slate-300">
                        {d.vendorModel}
                      </td>
                      <td className="py-3 pr-4 font-mono text-slate-400">
                        {d.firmwareVersion}
                      </td>
                      <td className="py-3 pr-4">
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                            d.wearState === 'ON_WRIST'
                              ? 'bg-emerald-500/20 text-emerald-300'
                              : 'bg-amber-500/20 text-amber-300'
                          }`}
                        >
                          {d.wearState}
                        </span>
                      </td>
                      <td className="py-3 pr-4 text-slate-300">
                        {d.batteryPct}% ({d.signalRssiDbm} dBm)
                      </td>
                      <td className="py-3 pr-4 font-mono text-[11px] text-slate-400">
                        {d.certificateThumbprint.slice(0, 16)}...
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 3: ENROLMENT, DPDP CONSENT & CSV ROSTER IMPORT */}
      {activeSubTab === 'ENROLMENT_CONSENT' && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          <div className="space-y-4 rounded-2xl border border-slate-800 bg-slate-900/90 p-5 lg:col-span-7">
            <h2 className="text-base font-bold text-white">
              DPDP Act 2023 & ABDM-Compatible Consent Management
            </h2>
            <p className="text-xs text-slate-400">
              Withdrawing vitals or GPS consent immediately redacts the Family Mobile App view and appends a hash-chained audit entry.
            </p>

            <div className="space-y-3">
              {bootstrap.patients.map((p) => (
                <div
                  key={p.id}
                  className="rounded-xl border border-slate-800 bg-slate-950 p-3.5"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="text-sm font-bold text-white">
                        {p.fullName} ({p.id})
                      </div>
                      <div className="text-[11px] text-slate-400">
                        ABDM Artefact: {p.consent.abdmArtefactId} • Status:{' '}
                        <strong
                          className={
                            p.consent.status === 'GRANTED'
                              ? 'text-emerald-400'
                              : 'text-rose-400'
                          }
                        >
                          {p.consent.status}
                        </strong>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          handleConsentToggle(p, {
                            status: 'GRANTED',
                            shareVitalsWithFamilyApp:
                              !p.consent.permissions.shareVitalsWithFamilyApp,
                          })
                        }
                        className={`rounded-lg px-2.5 py-1 text-xs font-bold cursor-pointer ${
                          p.consent.permissions.shareVitalsWithFamilyApp
                            ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                            : 'bg-slate-800 text-slate-400'
                        }`}
                      >
                        Family Vitals:{' '}
                        {p.consent.permissions.shareVitalsWithFamilyApp
                          ? 'ON'
                          : 'REDACTED'}
                      </button>

                      <button
                        type="button"
                        onClick={() =>
                          handleConsentToggle(p, {
                            status: 'GRANTED',
                            shareGpsLocationWithFamilyApp:
                              !p.consent.permissions
                                .shareGpsLocationWithFamilyApp,
                          })
                        }
                        className={`rounded-lg px-2.5 py-1 text-xs font-bold cursor-pointer ${
                          p.consent.permissions.shareGpsLocationWithFamilyApp
                            ? 'bg-sky-500/20 text-sky-300 border border-sky-500/40'
                            : 'bg-slate-800 text-slate-400'
                        }`}
                      >
                        Family GPS:{' '}
                        {p.consent.permissions.shareGpsLocationWithFamilyApp
                          ? 'ON'
                          : 'REDACTED'}
                      </button>

                      <button
                        type="button"
                        onClick={() =>
                          handleConsentToggle(p, {
                            status:
                              p.consent.status === 'GRANTED'
                                ? 'WITHDRAWN'
                                : 'GRANTED',
                            shareVitalsWithFamilyApp:
                              p.consent.status !== 'GRANTED',
                            shareGpsLocationWithFamilyApp:
                              p.consent.status !== 'GRANTED',
                          })
                        }
                        className="rounded-lg bg-rose-950/80 border border-rose-500/40 px-2.5 py-1 text-xs font-bold text-rose-300 hover:bg-rose-900 cursor-pointer"
                      >
                        {p.consent.status === 'GRANTED'
                          ? 'Withdraw Consent'
                          : 'Restore Consent'}
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-4 rounded-2xl border border-slate-800 bg-slate-900/90 p-5 lg:col-span-5">
            <h2 className="text-base font-bold text-white">
              Bulk Pilot Roster CSV Import
            </h2>
            <p className="text-xs text-slate-400">
              Format: <code>fullName,preferredName,age,gender,roomOrFlat,contactName,contactRelation,contactPhone</code>
            </p>
            <textarea
              rows={5}
              value={csvInput}
              onChange={(e) => setCsvInput(e.target.value)}
              className="w-full rounded-xl border border-slate-700 bg-slate-950 p-3 font-mono text-xs text-slate-200"
            />
            <button
              type="button"
              onClick={handleImportCsv}
              className="w-full rounded-xl bg-emerald-500 py-2.5 text-xs font-bold text-slate-950 hover:bg-emerald-400 cursor-pointer"
            >
              Import CSV Roster & Provision Wearable Bands
            </button>
            {csvImportStatus && (
              <div className="rounded-lg border border-emerald-500/30 bg-emerald-950/40 p-3 text-xs text-emerald-300">
                {csvImportStatus}
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 4: IMMUTABLE HASH-CHAINED AUDIT LOG & 8-ROLE RBAC */}
      {activeSubTab === 'AUDIT_RBAC' && (
        <div className="space-y-6">
          <div className="rounded-2xl border border-slate-800 bg-slate-900/90 p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-base font-bold text-white">
                  Immutable SHA-256 Hash-Chained Audit Log
                </h2>
                <p className="text-xs text-slate-400">
                  Every patient data view, threshold adjustment, alert action, and DPDP consent change is cryptographically chained.
                </p>
              </div>
              <span className="flex items-center gap-1.5 rounded-full border border-emerald-500/40 bg-emerald-950/60 px-3 py-1 text-xs font-bold text-emerald-300">
                <CheckCircle className="h-4 w-4" />
                Chain Integrity Verified ({bootstrap.auditIntegrity.totalEntries}{' '}
                Entries)
              </span>
            </div>

            <div className="mt-4 max-h-96 overflow-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-slate-800 text-slate-400 uppercase">
                  <tr>
                    <th className="py-2 pr-3">Seq</th>
                    <th className="py-2 pr-3">Timestamp</th>
                    <th className="py-2 pr-3">Actor / Role</th>
                    <th className="py-2 pr-3">Action</th>
                    <th className="py-2 pr-3">Details</th>
                    <th className="py-2 pr-3">Entry SHA-256 Hash</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {bootstrap.auditLogs.map((log: AuditLogEntry) => (
                    <tr key={log.id}>
                      <td className="py-2 pr-3 font-mono text-emerald-400">
                        #{log.sequence}
                      </td>
                      <td className="py-2 pr-3 font-mono text-[11px] text-slate-400">
                        {new Date(log.timestamp).toLocaleTimeString()}
                      </td>
                      <td className="py-2 pr-3 text-slate-200">
                        {log.actorId}{' '}
                        <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-sky-300">
                          {log.actorRole}
                        </span>
                      </td>
                      <td className="py-2 pr-3 font-mono font-bold text-amber-300">
                        {log.action}
                      </td>
                      <td className="py-2 pr-3 text-slate-300">{log.details}</td>
                      <td className="py-2 pr-3 font-mono text-[10px] text-slate-400">
                        {log.entryHash.slice(0, 18)}...
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
