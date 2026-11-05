# 03. Wearable Band Interface Control Document (ICD)

## 1. Purpose & Scope
This Interface Control Document (ICD) defines the contract between wearable band hardware/SDKs and the **CarePulse 24×7 Ingestion & Abstraction Layer**.

### Non-Negotiable Hardware vs. Backend Boundary
- **Band-Emitted Events**: Fall detection (`FALL_DETECTED`), SOS button press (`SOS_PRESSED`), wrist wear-state (`ON_WRIST` / `OFF_WRIST`), and GPS fixes (`GPS_FIX`) are computed and emitted directly by the wearable band hardware/firmware.
- **Backend Responsibilities**: The backend performs **zero on-device signal-processing algorithms** (such as raw accelerometer waveform fall classification). Instead, the backend authenticates the band, translates vendor frames into the canonical schema, deduplicates packets, handles out-of-order buffered timestamps, runs Haversine geofencing and sustained vitals threshold rules, and dispatches P1–P4 alerts.

---

## 2. Transport Protocols & Security Provisioning

| Parameter | Primary Transport (MQTT) | Secondary Transport (HTTPS) |
| :--- | :--- | :--- |
| **Protocol** | MQTT v3.1.1 / v5.0 over TLS 1.2+ | HTTPS (`POST /api/v1/ingest/telemetry`) over TLS 1.2+ |
| **Port** | `8883` (TLS) / `1883` (Local Dev Bridge) | `443` (Production) / `4000` (Local Dev) |
| **Topic / Path** | `carecentres/{careCentreId}/devices/{deviceId}/telemetry` | `/api/v1/ingest/telemetry` |
| **Per-Device Auth** | Mutual TLS (X.509 client certificate thumbprint) + HMAC-SHA256 token | `deviceToken` header/body HMAC-SHA256 or X.509 mTLS |
| **Rate Limit** | 120 packets / minute / device (token bucket) | 120 requests / minute / device |

---

## 3. Supported Vendor Payload Formats & Canonical Translation

### 3.1 Vendor Adapter 1: `CarePulse-Band-Pro-V1` (JSON SDK Format)
```json
{
  "msgId": "cp1-99281-a",
  "devId": "BAND-UK-1001",
  "fw": "CP1.4.2",
  "evt": "TELEMETRY",
  "ts": 1793886000000,
  "seq": 42,
  "buffered": false,
  "bat": 88,
  "rssi": -64,
  "wrist": "ON_WRIST",
  "vitals": {
    "hr": 74,
    "spo2": 97,
    "temp": 36.6,
    "steps": 2140
  },
  "gps": {
    "lat": 51.5074,
    "lng": -0.1278,
    "acc": 5
  }
}
```

### 3.2 Vendor Adapter 2: `VitalWatch-Hex-V2` (Compact 8-Byte Hex Frame Format)
Used by low-bandwidth cellular/NB-IoT bands. The 16-character hex string encodes:
- Byte 0 (`00..06`): Event Code (`01`=Telemetry, `02`=Fall, `03`=SOS, `04`=WearState, `05`=GPS, `06`=LowBat)
- Byte 1: Heart Rate (`uint8` bpm)
- Byte 2: SpO2 (`uint8` %)
- Bytes 3–4: Skin Temp × 10 (`uint16` big-endian, e.g. `016E` = `366` = `36.6°C`)
- Byte 5: Battery % (`uint8`)
- Byte 6: Wear Flag (`00`=`OFF_WRIST`, `01`=`ON_WRIST`, `02`=`CHARGING`)
- Byte 7: Sequence Number (`uint8`)

---

## 4. Offline Buffering, Out-of-Order Replay & De-Duplication Contract
1. **Offline Ring Buffer on Band**: When a band loses cellular/Wi-Fi connectivity, it must store telemetry and discrete events in local non-volatile flash with the band's Real-Time Clock timestamp (`ts` / `observedAt`).
2. **Reconnect Replay**: Upon reconnecting, the band transmits buffered packets with `"buffered": true` (or older `observedAt` timestamps).
3. **Server Out-of-Order Handling**: `WearableIngestionService` detects `observedAt < latestObservedAt`, slots the buffered packet into historical time-series and `1m`/`5m`/`1h` roll-up buckets at `observedAt`, and preserves the newer live patient snapshot.
4. **Idempotent De-duplication**: Retransmitted packets with the same `(deviceId, messageId)` are acknowledged (`202 Accepted` / MQTT `PUBACK`) and ignored as duplicates (`DUPLICATE_IGNORED`).

---

## 5. Tracked Hardware Dependencies (Client-Provided)
| Dependency ID | Description | Owner | Fallback in Repository |
| :--- | :--- | :--- | :--- |
| **HW-DEP-01** | Manufacturer Band SDK credentials & root CA certificate chain | Client / Band Maker | `BandAdapterRegistry` + local X.509/HMAC provisioning |
| **HW-DEP-02** | Physical pilot wearable bands (100 units) for Care Centre UAT | Client | Interactive Band Simulator UI (`/simulator`) + 5,000-band CLI |
| **HW-DEP-03** | On-device fall & wrist-detect firmware calibration specs | Band Maker | Simulated hardware event triggers in `BandSimulatorView` |
