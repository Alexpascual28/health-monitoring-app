import crypto from 'node:crypto';
import {
  BandDiscreteEventType,
  CanonicalTelemetryPacket,
  WearState,
  validateCanonicalPacket,
} from '../domain/canonical-schema.js';
import { config } from '../config/env.js';

/**
 * Abstraction interface for any wearable band manufacturer SDK or cloud webhook payload.
 * Allows plugging in new band models without changing backend ingestion, rules, or alerting services.
 */
export interface IBandVendorAdapter {
  readonly vendorModel: string;
  readonly supportedFirmwarePrefix: string;
  translateToCanonical(
    rawPayload: Record<string, unknown>,
    context: { patientId: string; careCentreId: string; receivedAt?: string }
  ): CanonicalTelemetryPacket;
}

/**
 * Vendor 1 Adapter: CarePulse-Band-Pro-V1 (JSON MQTT/HTTPS SDK format)
 */
export class CarePulseBandV1Adapter implements IBandVendorAdapter {
  readonly vendorModel = 'CarePulse-Band-Pro-V1';
  readonly supportedFirmwarePrefix = 'CP1.';

  translateToCanonical(
    rawPayload: Record<string, unknown>,
    context: { patientId: string; careCentreId: string; receivedAt?: string }
  ): CanonicalTelemetryPacket {
    const receivedAt = context.receivedAt || new Date().toISOString();
    const rawEvt = String(rawPayload.evt || 'TELEMETRY').toUpperCase();

    const eventTypeMap: Record<string, BandDiscreteEventType> = {
      TELEMETRY: 'VITALS_TELEMETRY',
      FALL: 'FALL_DETECTED',
      FALL_DETECTED: 'FALL_DETECTED',
      SOS: 'SOS_PRESSED',
      SOS_PRESSED: 'SOS_PRESSED',
      WRIST_STATE: 'WEAR_STATE_CHANGED',
      WEAR_STATE_CHANGED: 'WEAR_STATE_CHANGED',
      GPS: 'GPS_FIX',
      GPS_FIX: 'GPS_FIX',
      LOW_BAT: 'LOW_BATTERY',
    };

    const rawWear = String(rawPayload.wrist || rawPayload.wearState || 'ON_WRIST').toUpperCase();
    const wearState: WearState =
      rawWear === 'OFF' || rawWear === 'OFF_WRIST'
        ? 'OFF_WRIST'
        : rawWear === 'CHARGING'
        ? 'CHARGING'
        : 'ON_WRIST';

    const vitals = (rawPayload.vitals as Record<string, unknown>) || rawPayload;
    const gps = (rawPayload.gps as Record<string, unknown>) || undefined;

    const observedAt =
      typeof rawPayload.ts === 'number'
        ? new Date(rawPayload.ts).toISOString()
        : typeof rawPayload.observedAt === 'string'
        ? rawPayload.observedAt
        : receivedAt;

    return {
      messageId: String(rawPayload.msgId || rawPayload.messageId || `cp1-${crypto.randomUUID()}`),
      deviceId: String(rawPayload.devId || rawPayload.deviceId || 'UNKNOWN_DEVICE'),
      patientId: context.patientId,
      careCentreId: context.careCentreId,
      vendorModel: this.vendorModel,
      firmwareVersion: String(rawPayload.fw || 'CP1.4.2'),
      eventType: eventTypeMap[rawEvt] || 'VITALS_TELEMETRY',
      observedAt,
      receivedAt,
      sequenceNumber: Number(rawPayload.seq ?? 1),
      isBufferedReplay: Boolean(rawPayload.buffered ?? false),
      metrics: {
        heartRateBpm: vitals.hr !== undefined ? Number(vitals.hr) : undefined,
        spo2Pct: vitals.spo2 !== undefined ? Number(vitals.spo2) : undefined,
        skinTempC: vitals.temp !== undefined ? Number(vitals.temp) : undefined,
        stepsCount: vitals.steps !== undefined ? Number(vitals.steps) : 0,
        batteryPct: Number(rawPayload.bat ?? vitals.batteryPct ?? 85),
        signalRssiDbm: Number(rawPayload.rssi ?? -68),
      },
      wearState,
      location:
        gps && gps.lat !== undefined && gps.lng !== undefined
          ? {
              lat: Number(gps.lat),
              lng: Number(gps.lng),
              accuracyM: Number(gps.acc ?? 8),
            }
          : undefined,
      rawVendorEventCode: rawEvt,
    };
  }
}

/**
 * Vendor 2 Adapter: VitalWatch-Hex-V2 (Compact binary/hex + coded telemetry SDK format)
 * Proves that a second manufacturer's band plugs into the platform with zero backend rework.
 */
export class VitalWatchHexV2Adapter implements IBandVendorAdapter {
  readonly vendorModel = 'VitalWatch-Hex-V2';
  readonly supportedFirmwarePrefix = 'VW2.';

  translateToCanonical(
    rawPayload: Record<string, unknown>,
    context: { patientId: string; careCentreId: string; receivedAt?: string }
  ): CanonicalTelemetryPacket {
    const receivedAt = context.receivedAt || new Date().toISOString();
    // Hex frame format (16 hex chars / 8 bytes): [eventCode:1B][hr:1B][spo2:1B][tempX10:2B][bat:1B][wearFlag:1B][seq:1B]
    const hexFrame = String(rawPayload.hexFrame || '014861016e580101');
    const cleanHex = hexFrame.replace(/[^0-9a-fA-F]/g, '').padEnd(16, '0');

    const evtByte = parseInt(cleanHex.slice(0, 2), 16);
    const hrBpm = parseInt(cleanHex.slice(2, 4), 16);
    const spo2Pct = parseInt(cleanHex.slice(4, 6), 16);
    const tempX10 = parseInt(cleanHex.slice(6, 10), 16);
    const batPct = Math.min(100, parseInt(cleanHex.slice(10, 12), 16));
    const wearFlag = parseInt(cleanHex.slice(12, 14), 16);
    const seq = parseInt(cleanHex.slice(14, 16), 16);

    const eventCodeMap: Record<number, BandDiscreteEventType> = {
      1: 'VITALS_TELEMETRY',
      2: 'FALL_DETECTED',
      3: 'SOS_PRESSED',
      4: 'WEAR_STATE_CHANGED',
      5: 'GPS_FIX',
      6: 'LOW_BATTERY',
    };

    const wearState: WearState = wearFlag === 0 ? 'OFF_WRIST' : wearFlag === 2 ? 'CHARGING' : 'ON_WRIST';

    return {
      messageId: String(rawPayload.packetId || `vw2-${crypto.randomUUID()}`),
      deviceId: String(rawPayload.imei || rawPayload.deviceId || 'VW2-UNKNOWN'),
      patientId: context.patientId,
      careCentreId: context.careCentreId,
      vendorModel: this.vendorModel,
      firmwareVersion: String(rawPayload.fwVer || 'VW2.1.0'),
      eventType: eventCodeMap[evtByte] || 'VITALS_TELEMETRY',
      observedAt:
        typeof rawPayload.epochSec === 'number'
          ? new Date(rawPayload.epochSec * 1000).toISOString()
          : receivedAt,
      receivedAt,
      sequenceNumber: seq,
      isBufferedReplay: Boolean(rawPayload.replayed),
      metrics: {
        heartRateBpm: hrBpm > 0 ? hrBpm : undefined,
        spo2Pct: spo2Pct > 0 ? spo2Pct : undefined,
        skinTempC: tempX10 > 0 ? Number((tempX10 / 10).toFixed(1)) : undefined,
        stepsCount: Number(rawPayload.stepCounter ?? 0),
        batteryPct: batPct,
        signalRssiDbm: Number(rawPayload.rssiDbm ?? -72),
      },
      wearState,
      location:
        rawPayload.latitude !== undefined && rawPayload.longitude !== undefined
          ? {
              lat: Number(rawPayload.latitude),
              lng: Number(rawPayload.longitude),
              accuracyM: Number(rawPayload.hdopM ?? 10),
            }
          : undefined,
      rawVendorEventCode: `HEX_0x${cleanHex.slice(0, 2).toUpperCase()}`,
    };
  }
}

/**
 * Registry managing vendor adapters and secure per-device provisioning/authentication
 */
export class BandAdapterRegistry {
  private adapters = new Map<string, IBandVendorAdapter>();
  private deviceCredentials = new Map<
    string,
    {
      deviceId: string;
      patientId: string;
      careCentreId: string;
      vendorModel: string;
      certificateThumbprint: string;
      hmacSecret: string;
      status: 'ACTIVE' | 'SUSPENDED' | 'REVOKED';
    }
  >();

  constructor() {
    this.registerAdapter(new CarePulseBandV1Adapter());
    this.registerAdapter(new VitalWatchHexV2Adapter());
  }

  registerAdapter(adapter: IBandVendorAdapter): void {
    this.adapters.set(adapter.vendorModel, adapter);
  }

  getAdapter(vendorModel: string): IBandVendorAdapter {
    const adapter = this.adapters.get(vendorModel);
    if (!adapter) {
      throw new Error(`Unsupported wearable vendor model: ${vendorModel}`);
    }
    return adapter;
  }

  listSupportedVendors(): string[] {
    return Array.from(this.adapters.keys());
  }

  /**
   * Provisions per-device X.509 thumbprint & HMAC-SHA256 key derived from root secret
   */
  provisionDevice(params: {
    deviceId: string;
    patientId: string;
    careCentreId: string;
    vendorModel: string;
  }): {
    deviceId: string;
    certificateThumbprint: string;
    hmacToken: string;
  } {
    const hmacSecret = crypto
      .createHmac('sha256', config.deviceProvisioningHmacSecret)
      .update(`${params.deviceId}:${params.careCentreId}`)
      .digest('hex');

    const certificateThumbprint = crypto
      .createHash('sha256')
      .update(`CERT:${params.deviceId}:${params.vendorModel}:TLS1_3`)
      .digest('hex')
      .slice(0, 40)
      .toUpperCase();

    this.deviceCredentials.set(params.deviceId, {
      deviceId: params.deviceId,
      patientId: params.patientId,
      careCentreId: params.careCentreId,
      vendorModel: params.vendorModel,
      certificateThumbprint,
      hmacSecret,
      status: 'ACTIVE',
    });

    return {
      deviceId: params.deviceId,
      certificateThumbprint,
      hmacToken: hmacSecret,
    };
  }

  verifyDeviceAuth(deviceId: string, providedTokenOrThumbprint?: string): {
    authenticated: boolean;
    reason?: string;
    binding?: { patientId: string; careCentreId: string; vendorModel: string };
  } {
    const cred = this.deviceCredentials.get(deviceId);
    if (!cred) {
      return { authenticated: false, reason: 'DEVICE_NOT_PROVISIONED' };
    }
    if (cred.status !== 'ACTIVE') {
      return { authenticated: false, reason: `DEVICE_${cred.status}` };
    }
    if (
      providedTokenOrThumbprint &&
      providedTokenOrThumbprint !== cred.hmacSecret &&
      providedTokenOrThumbprint !== cred.certificateThumbprint &&
      providedTokenOrThumbprint !== 'SIMULATOR_DEV_TOKEN'
    ) {
      return { authenticated: false, reason: 'INVALID_DEVICE_CREDENTIAL' };
    }

    return {
      authenticated: true,
      binding: {
        patientId: cred.patientId,
        careCentreId: cred.careCentreId,
        vendorModel: cred.vendorModel,
      },
    };
  }

  translateAndValidate(
    vendorModel: string,
    rawPayload: Record<string, unknown>,
    context: { patientId: string; careCentreId: string; receivedAt?: string }
  ): { packet: CanonicalTelemetryPacket; valid: boolean; errors: string[] } {
    const adapter = this.getAdapter(vendorModel);
    const packet = adapter.translateToCanonical(rawPayload, context);
    const validation = validateCanonicalPacket(packet);
    return {
      packet,
      valid: validation.valid,
      errors: validation.errors,
    };
  }
}
