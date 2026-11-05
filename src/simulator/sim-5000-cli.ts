import { BandAdapterRegistry } from '../adapters/band-adapter.js';
import { WearableIngestionService } from '../ingestion/ingestion-service.js';

export interface FleetSimulationResult {
  simulatedBandCount: number;
  totalPacketsSent: number;
  mqttPackets: number;
  httpsPackets: number;
  processedLive: number;
  processedOutOfOrder: number;
  duplicatesDropped: number;
  criticalEventsTriggered: number;
  durationMs: number;
  throughputMsgsPerSec: number;
  latencyMs: {
    p50: number;
    p95: number;
    p99: number;
    max: number;
  };
  slaP95Under5000MsMet: boolean;
  zeroSilentLossVerified: boolean;
}

/**
 * Runs a 5,000-Band Fleet Load & Chaos Simulation (or custom band count)
 * Tests:
 * - Multi-vendor provisioning (CarePulse-Band-Pro-V1 & VitalWatch-Hex-V2)
 * - Dual protocol ingestion (MQTT TLS topics & HTTPS POST)
 * - Out-of-order buffered packet replay
 * - Duplicate packet rejection
 * - Critical Fall/SOS SLA latency (p95 <= 5,000 ms non-negotiable requirement)
 */
export function runFleetLoadSimulation(bandCount = 5000): FleetSimulationResult {
  const registry = new BandAdapterRegistry();
  const ingestion = new WearableIngestionService(registry, 500);
  const latencies: number[] = [];
  let criticalEventsTriggered = 0;

  const careCentreId = 'cc-uk-loadtest-01';
  const startWall = performance.now();

  // 1. Provision all 5,000 bands across two vendor models
  const provisioned: Array<{
    deviceId: string;
    patientId: string;
    vendorModel: 'CarePulse-Band-Pro-V1' | 'VitalWatch-Hex-V2';
    hmacToken: string;
  }> = [];

  for (let i = 1; i <= bandCount; i++) {
    const deviceId = `BAND-SIM-${String(i).padStart(4, '0')}`;
    const patientId = `PAT-SIM-${String(i).padStart(4, '0')}`;
    const vendorModel =
      i % 2 === 0 ? 'VitalWatch-Hex-V2' : 'CarePulse-Band-Pro-V1';
    const cred = registry.provisionDevice({
      deviceId,
      patientId,
      careCentreId,
      vendorModel,
    });
    provisioned.push({
      deviceId,
      patientId,
      vendorModel,
      hmacToken: cred.hmacToken,
    });
  }

  const nowMs = Date.now();

  // 2. Emit telemetry across all 5,000 bands + inject chaos (duplicates, out-of-order, critical SOS/Fall)
  for (let i = 0; i < provisioned.length; i++) {
    const dev = provisioned[i];
    const isCritical = i % 250 === 0; // 20 Critical Fall/SOS alerts across 5,000 bands
    if (isCritical) {
      criticalEventsTriggered += 1;
    }

    if (dev.vendorModel === 'CarePulse-Band-Pro-V1') {
      const outcome = ingestion.ingestMqttPublish(
        `carecentres/${careCentreId}/devices/${dev.deviceId}/telemetry`,
        {
          msgId: `msg-${dev.deviceId}-1`,
          devId: dev.deviceId,
          evt: isCritical ? 'FALL_DETECTED' : 'TELEMETRY',
          ts: nowMs,
          seq: 1,
          bat: 88,
          wrist: 'ON_WRIST',
          vitals: {
            hr: isCritical ? 138 : 72 + (i % 15),
            spo2: 97 - (i % 3),
            temp: 36.6,
            steps: 1200 + i,
          },
          gps: { lat: 51.5074, lng: -0.1278, acc: 6 },
        },
        dev.hmacToken
      );
      latencies.push(outcome.ingestionLatencyMs);
    } else {
      // VitalWatch-Hex-V2 over HTTPS
      const evtHex = isCritical ? '03' : '01'; // 03 = SOS_PRESSED, 01 = TELEMETRY
      const outcome = ingestion.ingest({
        protocol: 'HTTPS',
        deviceId: dev.deviceId,
        deviceTokenOrCert: dev.hmacToken,
        vendorModel: 'VitalWatch-Hex-V2',
        rawPayload: {
          packetId: `pkt-${dev.deviceId}-1`,
          imei: dev.deviceId,
          hexFrame: `${evtHex}4c61016e5a0101`,
          epochSec: Math.floor(nowMs / 1000),
          stepCounter: 950,
          latitude: 51.5074,
          longitude: -0.1278,
        },
      });
      latencies.push(outcome.ingestionLatencyMs);
    }

    // Inject duplicate packet every 500th band
    if (i % 500 === 0 && dev.vendorModel === 'CarePulse-Band-Pro-V1') {
      ingestion.ingestMqttPublish(
        `carecentres/${careCentreId}/devices/${dev.deviceId}/telemetry`,
        {
          msgId: `msg-${dev.deviceId}-1`, // Intentional duplicate messageId
          devId: dev.deviceId,
          evt: 'TELEMETRY',
          ts: nowMs,
          bat: 88,
          vitals: { hr: 75, spo2: 98, temp: 36.5 },
        },
        dev.hmacToken
      );
    }

    // Inject out-of-order delayed packet (observed 2 minutes earlier) every 200th band
    if (i % 200 === 0) {
      const outcome = ingestion.ingest({
        protocol: 'MQTT_TLS',
        deviceId: dev.deviceId,
        deviceTokenOrCert: dev.hmacToken,
        vendorModel: 'CarePulse-Band-Pro-V1',
        rawPayload: {
          msgId: `msg-${dev.deviceId}-buffered-0`,
          devId: dev.deviceId,
          evt: 'TELEMETRY',
          ts: nowMs - 120_000, // 2 minutes earlier than latestObservedAt
          buffered: true,
          bat: 89,
          vitals: { hr: 70, spo2: 98, temp: 36.5 },
        },
      });
      latencies.push(outcome.ingestionLatencyMs);
    }
  }

  const durationMs = Number((performance.now() - startWall).toFixed(2));
  latencies.sort((a, b) => a - b);

  const percentile = (p: number) => {
    if (latencies.length === 0) return 0;
    const idx = Math.min(
      latencies.length - 1,
      Math.floor((p / 100) * latencies.length)
    );
    return latencies[idx];
  };

  const metrics = ingestion.getMetrics();
  const p50 = percentile(50);
  const p95 = percentile(95);
  const p99 = percentile(99);
  const max = latencies[latencies.length - 1] || 0;

  return {
    simulatedBandCount: bandCount,
    totalPacketsSent: metrics.totalReceived,
    mqttPackets: metrics.mqttReceived,
    httpsPackets: metrics.httpsReceived,
    processedLive: metrics.processedLive,
    processedOutOfOrder: metrics.processedOutOfOrder,
    duplicatesDropped: metrics.duplicatesDropped,
    criticalEventsTriggered,
    durationMs,
    throughputMsgsPerSec: Number(
      ((metrics.totalReceived / Math.max(durationMs, 1)) * 1000).toFixed(0)
    ),
    latencyMs: { p50, p95, p99, max },
    slaP95Under5000MsMet: p95 <= 5000,
    zeroSilentLossVerified:
      metrics.processedLive +
        metrics.processedOutOfOrder +
        metrics.duplicatesDropped ===
      metrics.totalReceived,
  };
}

// Run directly when invoked via `npm run sim:5000`
const isMainModule =
  process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('sim-5000-cli.ts');

if (isMainModule) {
  console.log('====================================================================');
  console.log(' CarePulse 24x7 - 5,000 Wearable Band Load & SLA Simulator (Phase 1)');
  console.log('====================================================================');
  const result = runFleetLoadSimulation(5000);
  console.table({
    'Simulated Wearable Bands': result.simulatedBandCount,
    'Total Telemetry Packets': result.totalPacketsSent,
    'MQTT TLS Packets': result.mqttPackets,
    'HTTPS POST Packets': result.httpsPackets,
    'Live In-Order Processed': result.processedLive,
    'Out-Of-Order Buffered Processed': result.processedOutOfOrder,
    'Duplicates Deduplicated': result.duplicatesDropped,
    'Critical Fall/SOS Alerts': result.criticalEventsTriggered,
    'Total Duration (ms)': result.durationMs,
    'Throughput (msgs/sec)': result.throughputMsgsPerSec,
    'p50 Latency (ms)': result.latencyMs.p50,
    'p95 Latency (ms) [SLA <= 5000ms]': result.latencyMs.p95,
    'p99 Latency (ms)': result.latencyMs.p99,
    'SLA Met (p95 <= 5s)': result.slaP95Under5000MsMet ? 'PASS' : 'FAIL',
    'Zero Silent Loss': result.zeroSilentLossVerified ? 'VERIFIED' : 'FAIL',
  });
}
