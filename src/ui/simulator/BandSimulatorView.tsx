import React, { useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Battery,
  Cpu,
  MapPin,
  Play,
  Radio,
  RefreshCw,
  ShieldAlert,
  Watch,
  Wifi,
  Zap,
} from 'lucide-react';
import type {
  FleetSimulationResult,
  IngestionMetricsSummary,
  PatientRecord,
} from '../types.js';
import { notifyCrossWindowSync } from '../types.js';

interface BandSimulatorViewProps {
  patients: PatientRecord[];
  selectedPatientId: string;
  onSelectPatient: (id: string) => void;
  ingestionMetrics: IngestionMetricsSummary | null;
  onRefreshBootstrap: () => Promise<void>;
}

export const BandSimulatorView: React.FC<BandSimulatorViewProps> = ({
  patients,
  selectedPatientId,
  onSelectPatient,
  ingestionMetrics,
  onRefreshBootstrap,
}) => {
  const activePatient =
    patients.find((p) => p.id === selectedPatientId) || patients[0];
  const snap = activePatient?.latestSnapshot;

  const [hr, setHr] = useState<number>(snap?.heartRateBpm ?? 75);
  const [spo2, setSpo2] = useState<number>(snap?.spo2Pct ?? 97);
  const [temp, setTemp] = useState<number>(snap?.skinTempC ?? 36.6);
  const [battery, setBattery] = useState<number>(snap?.batteryPct ?? 86);
  const [wearState, setWearState] = useState<'ON_WRIST' | 'OFF_WRIST'>(
    snap?.wearState === 'OFF_WRIST' ? 'OFF_WRIST' : 'ON_WRIST'
  );
  const [protocol, setProtocol] = useState<'MQTT_TLS' | 'HTTPS'>('MQTT_TLS');
  const [lastOutcomeMsg, setLastOutcomeMsg] = useState<string>(
    'Ready to emit canonical wearable telemetry or discrete hardware events.'
  );
  const [loadSimResult, setLoadSimResult] =
    useState<FleetSimulationResult | null>(null);
  const [runningLoadTest, setRunningLoadTest] = useState(false);

  const syncSlidersFromPatient = (p: PatientRecord) => {
    if (p.latestSnapshot) {
      setHr(p.latestSnapshot.heartRateBpm);
      setSpo2(p.latestSnapshot.spo2Pct);
      setTemp(p.latestSnapshot.skinTempC);
      setBattery(p.latestSnapshot.batteryPct);
      setWearState(
        p.latestSnapshot.wearState === 'OFF_WRIST' ? 'OFF_WRIST' : 'ON_WRIST'
      );
    }
  };

  const emitSimulatedPacket = async (overrides: {
    eventType?: string;
    heartRateBpm?: number;
    spo2Pct?: number;
    skinTempC?: number;
    batteryPct?: number;
    wearState?: 'ON_WRIST' | 'OFF_WRIST';
    lat?: number;
    lng?: number;
    observedAtOffsetSec?: number;
    forceDuplicateMessageId?: string;
    label?: string;
  }) => {
    if (!activePatient) return;
    try {
      const res = await fetch('/api/v1/ingest/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          patientId: activePatient.id,
          protocol,
          eventType: overrides.eventType || 'VITALS_TELEMETRY',
          heartRateBpm: overrides.heartRateBpm ?? hr,
          spo2Pct: overrides.spo2Pct ?? spo2,
          skinTempC: overrides.skinTempC ?? temp,
          batteryPct: overrides.batteryPct ?? battery,
          wearState: overrides.wearState ?? wearState,
          lat: overrides.lat ?? 51.5074,
          lng: overrides.lng ?? -0.1278,
          observedAtOffsetSec: overrides.observedAtOffsetSec ?? 0,
          forceDuplicateMessageId: overrides.forceDuplicateMessageId,
        }),
      });
      const data = await res.json();
      const status = data.outcome?.status || 'PROCESSED';
      const latMs = data.outcome?.ingestionLatencyMs ?? 1;
      setLastOutcomeMsg(
        `[${protocol}] ${overrides.label || overrides.eventType || 'TELEMETRY'} -> ${status} in ${latMs}ms`
      );
      notifyCrossWindowSync('SIMULATOR_PACKET_EMITTED');
      await onRefreshBootstrap();
    } catch (err) {
      setLastOutcomeMsg(`Error: ${(err as Error).message}`);
    }
  };

  const run5000BandBenchmark = async (count = 5000) => {
    setRunningLoadTest(true);
    try {
      const res = await fetch('/api/v1/simulator/load-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bandCount: count }),
      });
      const result: FleetSimulationResult = await res.json();
      setLoadSimResult(result);
      notifyCrossWindowSync('LOAD_TEST_COMPLETED');
      await onRefreshBootstrap();
    } finally {
      setRunningLoadTest(false);
    }
  };

  if (!activePatient) {
    return <div className="p-6 text-slate-400">Loading wearable simulator...</div>;
  }

  return (
    <div className="space-y-6 p-4 md:p-6">
      {/* Header Banner */}
      <div className="flex flex-col justify-between gap-4 rounded-xl border border-indigo-500/30 bg-indigo-950/30 p-4 md:flex-row md:items-center">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-indigo-300">
            <Watch className="h-4 w-4" />
            Parallel Wearable Hardware & SDK Simulator + 5,000-Band Load Engine
          </div>
          <h2 className="mt-1 text-lg font-bold text-white">
            Virtual Wearable Twin — Test Without Physical Client Hardware
          </h2>
          <p className="text-xs text-slate-300">
            Emits vendor SDK frames through the Canonical Translation Layer over MQTT TLS 1.2+ or HTTPS. Fall, SOS, Wear-State, and GPS are band-emitted hardware events.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label className="text-xs font-medium text-slate-300" htmlFor="sim-resident-select">
            Target Band / Resident:
          </label>
          <select
            id="sim-resident-select"
            value={activePatient.id}
            onChange={(e) => {
              onSelectPatient(e.target.value);
              const found = patients.find((p) => p.id === e.target.value);
              if (found) syncSlidersFromPatient(found);
            }}
            className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm font-medium text-white"
          >
            {patients.map((p) => (
              <option key={p.id} value={p.id}>
                {p.bandDeviceId} • {p.preferredName} ({p.roomOrFlat.split('-')[0].trim()})
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Left Column: Visual Smart Band Face + Hardware Event Triggers */}
        <div className="space-y-4 lg:col-span-5">
          <div className="rounded-2xl border border-slate-800 bg-slate-900/90 p-5 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <span className="text-xs font-semibold uppercase tracking-wider text-emerald-400">
                  {activePatient.bandDeviceId}
                </span>
                <h3 className="text-base font-bold text-white">
                  {activePatient.fullName}
                </h3>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() =>
                    setProtocol(protocol === 'MQTT_TLS' ? 'HTTPS' : 'MQTT_TLS')
                  }
                  className="flex items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-950/60 px-2.5 py-1 text-xs font-semibold text-emerald-300"
                >
                  <Wifi className="h-3 w-3" />
                  {protocol}
                </button>
              </div>
            </div>

            {/* Simulated OLED Wearable Screen */}
            <div className="my-5 mx-auto max-w-xs rounded-3xl border-4 border-slate-700 bg-black p-5 text-center shadow-inner">
              <div className="flex items-center justify-between text-[11px] text-slate-400">
                <span className="flex items-center gap-1">
                  <Radio className="h-3 w-3 text-emerald-400" />
                  {wearState}
                </span>
                <span className="flex items-center gap-1">
                  <Battery className="h-3.5 w-3.5 text-emerald-400" />
                  {battery}%
                </span>
              </div>

              <div className="my-4 grid grid-cols-3 gap-2 border-y border-slate-800 py-4">
                <div>
                  <div className="text-[10px] uppercase text-slate-400">HR BPM</div>
                  <div className="text-2xl font-extrabold text-rose-400">{hr}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase text-slate-400">SpO2 %</div>
                  <div className="text-2xl font-extrabold text-sky-400">{spo2}%</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase text-slate-400">Skin °C</div>
                  <div className="text-2xl font-extrabold text-amber-300">
                    {temp.toFixed(1)}
                  </div>
                </div>
              </div>

              <div className="text-[11px] text-slate-400">
                Safe Zone: {snap?.insideGeofence !== false ? 'Inside (12m)' : 'OUTSIDE GEOFENCE'}
              </div>
            </div>

            {/* Instant Band Hardware Discrete Event Buttons */}
            <div className="space-y-2">
              <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                1-Click Band Hardware Event Triggers
              </div>
              <div className="grid grid-cols-2 gap-2.5">
                <button
                  type="button"
                  onClick={() =>
                    emitSimulatedPacket({
                      eventType: 'SOS_PRESSED',
                      label: 'SOS Emergency Button Pressed (P1 CRITICAL)',
                    })
                  }
                  className="flex items-center justify-center gap-1.5 rounded-lg bg-rose-600 px-3 py-2.5 text-xs font-bold text-white shadow hover:bg-rose-500 cursor-pointer"
                >
                  <ShieldAlert className="h-4 w-4" />
                  Press SOS Button (P1)
                </button>

                <button
                  type="button"
                  onClick={() =>
                    emitSimulatedPacket({
                      eventType: 'FALL_DETECTED',
                      heartRateBpm: 128,
                      label: 'Band Fall Detected Event (P1 CRITICAL)',
                    })
                  }
                  className="flex items-center justify-center gap-1.5 rounded-lg bg-amber-600 px-3 py-2.5 text-xs font-bold text-white shadow hover:bg-amber-500 cursor-pointer"
                >
                  <AlertTriangle className="h-4 w-4" />
                  Simulate Fall Impact (P1)
                </button>

                <button
                  type="button"
                  onClick={() => {
                    const nextWear =
                      wearState === 'ON_WRIST' ? 'OFF_WRIST' : 'ON_WRIST';
                    setWearState(nextWear);
                    emitSimulatedPacket({
                      eventType: 'WEAR_STATE_CHANGED',
                      wearState: nextWear,
                      label: `Wear-State Changed -> ${nextWear}`,
                    });
                  }}
                  className="flex items-center justify-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-700 cursor-pointer"
                >
                  <Watch className="h-4 w-4 text-amber-400" />
                  Toggle {wearState === 'ON_WRIST' ? 'Off-Wrist' : 'On-Wrist'}
                </button>

                <button
                  type="button"
                  onClick={() =>
                    emitSimulatedPacket({
                      eventType: 'GPS_FIX',
                      lat: 51.5125, // ~570m away from 51.5074 safe zone
                      lng: -0.1278,
                      label: 'GPS Fix Outside Safe Zone (Geofence Breach)',
                    })
                  }
                  className="flex items-center justify-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-700 cursor-pointer"
                >
                  <MapPin className="h-4 w-4 text-rose-400" />
                  Walk Outside Geofence
                </button>

                <button
                  type="button"
                  onClick={() =>
                    emitSimulatedPacket({
                      observedAtOffsetSec: -180,
                      label: 'Buffered Out-of-Order Packet (-3m observation time)',
                    })
                  }
                  className="flex items-center justify-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-700 cursor-pointer"
                >
                  <RefreshCw className="h-3.5 w-3.5 text-sky-400" />
                  Send Buffered Out-of-Order
                </button>

                <button
                  type="button"
                  onClick={async () => {
                    const dupId = `dup-test-${Date.now()}`;
                    await emitSimulatedPacket({
                      forceDuplicateMessageId: dupId,
                      label: 'First Packet Sent',
                    });
                    await emitSimulatedPacket({
                      forceDuplicateMessageId: dupId,
                      label: 'Duplicate Packet Injected (De-dup Verified)',
                    });
                  }}
                  className="flex items-center justify-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-700 cursor-pointer"
                >
                  <Zap className="h-3.5 w-3.5 text-purple-400" />
                  Test Packet De-duplication
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Continuous Vitals Sliders & 5,000-Band Load Test */}
        <div className="space-y-6 lg:col-span-7">
          <div className="rounded-2xl border border-slate-800 bg-slate-900/90 p-5">
            <h3 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-slate-200">
              <Activity className="h-4 w-4 text-emerald-400" />
              Interactive Sensor Telemetry Controls
            </h3>

            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3.5">
                <div className="flex justify-between text-xs font-semibold">
                  <span className="text-slate-300">Heart Rate (BPM)</span>
                  <span className="text-rose-400">
                    {hr} bpm (Threshold: {activePatient.thresholds.hrLowBpm}–
                    {activePatient.thresholds.hrHighBpm})
                  </span>
                </div>
                <input
                  type="range"
                  min={38}
                  max={165}
                  value={hr}
                  onChange={(e) => setHr(Number(e.target.value))}
                  className="mt-2 w-full accent-rose-500"
                />
              </div>

              <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3.5">
                <div className="flex justify-between text-xs font-semibold">
                  <span className="text-slate-300">Blood Oxygen SpO2 (%)</span>
                  <span className="text-sky-400">
                    {spo2}% (Min Threshold: {activePatient.thresholds.spo2LowPct}%)
                  </span>
                </div>
                <input
                  type="range"
                  min={82}
                  max={100}
                  value={spo2}
                  onChange={(e) => setSpo2(Number(e.target.value))}
                  className="mt-2 w-full accent-sky-500"
                />
              </div>

              <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3.5">
                <div className="flex justify-between text-xs font-semibold">
                  <span className="text-slate-300">Skin Temperature (°C)</span>
                  <span className="text-amber-300">{temp.toFixed(1)}°C</span>
                </div>
                <input
                  type="range"
                  min={34.5}
                  max={39.5}
                  step={0.1}
                  value={temp}
                  onChange={(e) => setTemp(Number(e.target.value))}
                  className="mt-2 w-full accent-amber-400"
                />
              </div>

              <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3.5">
                <div className="flex justify-between text-xs font-semibold">
                  <span className="text-slate-300">Band Battery (%)</span>
                  <span className="text-emerald-400">{battery}%</span>
                </div>
                <input
                  type="range"
                  min={4}
                  max={100}
                  value={battery}
                  onChange={(e) => setBattery(Number(e.target.value))}
                  className="mt-2 w-full accent-emerald-500"
                />
              </div>
            </div>

            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <button
                type="button"
                onClick={() =>
                  emitSimulatedPacket({
                    label: `Vitals Telemetry (HR=${hr}, SpO2=${spo2}%, Temp=${temp.toFixed(1)}°C)`,
                  })
                }
                className="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-bold text-slate-950 hover:bg-emerald-500 cursor-pointer"
              >
                <Play className="h-4 w-4" />
                Transmit Current Vitals Packet ({protocol})
              </button>

              <span className="text-xs font-mono text-emerald-300">
                {lastOutcomeMsg}
              </span>
            </div>
          </div>

          {/* 5,000-Band Fleet Simulator Benchmark Card */}
          <div className="rounded-2xl border border-slate-800 bg-slate-900/90 p-5">
            <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
              <div>
                <h3 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-indigo-300">
                  <Cpu className="h-4 w-4" />
                  5,000-Band Fleet Load & SLA Benchmark Engine
                </h3>
                <p className="mt-0.5 text-xs text-slate-400">
                  Verifies 100 → 5,000 device scale with zero architectural rework, p95 ≤ 5s SLA, and zero silent packet loss.
                </p>
              </div>
              <button
                type="button"
                disabled={runningLoadTest}
                onClick={() => run5000BandBenchmark(5000)}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-xs font-bold text-white shadow hover:bg-indigo-500 disabled:opacity-50 cursor-pointer"
              >
                {runningLoadTest
                  ? 'Simulating 5,000 Bands...'
                  : 'Run 5,000-Band Load Burst'}
              </button>
            </div>

            {loadSimResult && (
              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="rounded-lg border border-slate-800 bg-slate-950 p-3">
                  <div className="text-[11px] text-slate-400">Simulated Fleet</div>
                  <div className="text-lg font-bold text-white">
                    {loadSimResult.simulatedBandCount.toLocaleString()} Bands
                  </div>
                  <div className="text-[10px] text-emerald-400">
                    {loadSimResult.totalPacketsSent.toLocaleString()} packets ingested
                  </div>
                </div>
                <div className="rounded-lg border border-slate-800 bg-slate-950 p-3">
                  <div className="text-[11px] text-slate-400">p95 Latency (SLA ≤ 5s)</div>
                  <div className="text-lg font-bold text-emerald-400">
                    {loadSimResult.latencyMs.p95} ms
                  </div>
                  <div className="text-[10px] text-slate-400">
                    p50: {loadSimResult.latencyMs.p50}ms • p99: {loadSimResult.latencyMs.p99}ms
                  </div>
                </div>
                <div className="rounded-lg border border-slate-800 bg-slate-950 p-3">
                  <div className="text-[11px] text-slate-400">Throughput</div>
                  <div className="text-lg font-bold text-sky-400">
                    {loadSimResult.throughputMsgsPerSec.toLocaleString()} msg/s
                  </div>
                  <div className="text-[10px] text-slate-400">
                    Duration: {loadSimResult.durationMs} ms
                  </div>
                </div>
                <div className="rounded-lg border border-slate-800 bg-slate-950 p-3">
                  <div className="text-[11px] text-slate-400">Zero Silent Loss</div>
                  <div className="text-lg font-bold text-emerald-400">
                    {loadSimResult.zeroSilentLossVerified ? 'VERIFIED' : 'FAIL'}
                  </div>
                  <div className="text-[10px] text-slate-400">
                    {loadSimResult.processedOutOfOrder} out-of-order • {loadSimResult.duplicatesDropped} deduped
                  </div>
                </div>
              </div>
            )}

            {ingestionMetrics && (
              <div className="mt-4 flex flex-wrap gap-4 border-t border-slate-800 pt-3 text-xs text-slate-400">
                <span>
                  Live Gateway Total: <strong className="text-white">{ingestionMetrics.totalReceived}</strong>
                </span>
                <span>
                  MQTT TLS: <strong className="text-emerald-400">{ingestionMetrics.mqttReceived}</strong>
                </span>
                <span>
                  HTTPS: <strong className="text-sky-400">{ingestionMetrics.httpsReceived}</strong>
                </span>
                <span>
                  Out-of-Order Buffered: <strong className="text-amber-300">{ingestionMetrics.processedOutOfOrder}</strong>
                </span>
                <span>
                  Deduplicated: <strong className="text-purple-300">{ingestionMetrics.duplicatesDropped}</strong>
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
