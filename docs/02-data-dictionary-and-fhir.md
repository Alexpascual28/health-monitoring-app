# 02. Data Dictionary, DPDP Act 2023 Compliance & FHIR R4 / ABDM Mapping

## 1. Multi-Tenant Data Model & Data Dictionary

All entities are scoped by `careCentreId` (Row-Level Security / tenant partition key) to support seamless expansion from 1 Care Centre in Phase 1 to N Care Centres in Phase 2.

### 1.1 `patients` (Enrolled Residents)
| Field | Type | Encryption | Description |
| :--- | :--- | :--- | :--- |
| `id` | `VARCHAR(32)` PK | Plain | Unique resident ID (e.g., `PAT-1001`) |
| `careCentreId` | `VARCHAR(64)` | Plain (Indexed) | Tenant identifier (e.g., `cc-uk-sunrise-01`) |
| `fullName` | `TEXT` | **AES-256-GCM** | Legal name of resident |
| `preferredName` | `TEXT` | **AES-256-GCM** | Preferred name used in calm family view |
| `age` | `INT` | Plain | Resident age in years |
| `gender` | `VARCHAR(16)` | Plain | `Female`, `Male`, `Other` |
| `roomOrFlat` | `TEXT` | **AES-256-GCM** | Flat/room identifier within care centre |
| `homeAddress` | `TEXT` | **AES-256-GCM** | Physical address for emergency dispatch |
| `bandDeviceId` | `VARCHAR(64)` | Plain | Bound wearable device ID (`BAND-UK-1001`) |
| `thresholds` | `JSONB` | Plain | Per-patient configurable wellness & geofence rules |
| `enrolledAt` | `TIMESTAMPTZ` | Plain | ISO-8601 enrolment timestamp |

### 1.2 `wearable_telemetry` (TimescaleDB Hypertable partitioned by `observedAt`)
| Field | Type | Description |
| :--- | :--- | :--- |
| `messageId` | `VARCHAR(64)` | Unique packet ID used for idempotent deduplication |
| `deviceId` | `VARCHAR(64)` | Originating wearable band ID |
| `patientId` | `VARCHAR(32)` | Resident ID |
| `careCentreId` | `VARCHAR(64)` | Care centre tenant ID |
| `eventType` | `VARCHAR(32)` | `VITALS_TELEMETRY`, `FALL_DETECTED`, `SOS_PRESSED`, `WEAR_STATE_CHANGED`, `GPS_FIX`, `LOW_BATTERY` |
| `observedAt` | `TIMESTAMPTZ` | Wearable band hardware RTC timestamp |
| `receivedAt` | `TIMESTAMPTZ` | Cloud ingestion gateway timestamp |
| `isBufferedReplay` | `BOOLEAN` | `true` if packet arrived out-of-order from offline flash buffer |
| `heartRateBpm` | `SMALLINT` | Heart rate in beats/min (`[20, 260]`) |
| `spo2Pct` | `SMALLINT` | Blood oxygen saturation percentage (`[50, 100]`) |
| `skinTempC` | `NUMERIC(4,1)` | Skin temperature in Celsius (`[25.0, 45.0]`) |
| `stepsCount` | `INT` | Cumulative daily step counter |
| `batteryPct` | `SMALLINT` | Band battery percentage (`[0, 100]`) |
| `wearState` | `VARCHAR(16)` | `ON_WRIST`, `OFF_WRIST`, `CHARGING` |
| `location` | `GEOGRAPHY(POINT)` | GPS latitude, longitude, and horizontal accuracy (m) |

### 1.3 `telemetry_rollups` (`1m`, `5m`, `1h` Continuous Aggregates)
| Field | Type | Description |
| :--- | :--- | :--- |
| `patientId` | `VARCHAR(32)` | Resident ID |
| `resolution` | `VARCHAR(4)` | `1m`, `5m`, or `1h` |
| `bucketStartIso` | `TIMESTAMPTZ` | Start of roll-up time window |
| `sampleCount` | `INT` | Number of valid samples aggregated |
| `hrMin / hrMax / hrAvg` | `NUMERIC(5,1)` | Heart rate min, max, and mean |
| `spo2Min / spo2Max / spo2Avg` | `NUMERIC(5,1)` | SpO2 min, max, and mean |
| `tempMin / tempMax / tempAvg` | `NUMERIC(4,2)` | Skin temperature min, max, and mean |

### 1.4 `alerts` & `notification_deliveries`
| Field | Type | Description |
| :--- | :--- | :--- |
| `id` | `VARCHAR(32)` PK | Unique alert ID (e.g., `ALT-8F29A10C`) |
| `patientId` | `VARCHAR(32)` | Resident ID |
| `ruleCode` | `VARCHAR(64)` | Triggered rule code (`RULE_SOS_PRESSED`, `RULE_FALL_DETECTED`, `RULE_HR_HIGH`, etc.) |
| `severity` | `VARCHAR(16)` | `CRITICAL` (P1), `HIGH` (P2), `MEDIUM` (P3), `LOW` (P4) |
| `state` | `VARCHAR(16)` | `OPEN`, `ASSIGNED`, `ACKNOWLEDGED`, `ESCALATED`, `CLOSED` |
| `escalationTier` | `SMALLINT` | Current escalation tier (`1` Caregiver, `2` Supervisor, `3` Family/Emergency) |
| `caregiverDisposition` | `TEXT` | Mandatory resolution note recorded on close and shared with Family App |
| `duplicateCount` | `INT` | Count of coalesced duplicate triggers while alert remained open |

### 1.5 `dpdp_consents` & `immutable_audit_logs`
| Field | Type | Description |
| :--- | :--- | :--- |
| `consentId` | `VARCHAR(64)` PK | DPDP Act 2023 consent identifier |
| `status` | `VARCHAR(16)` | `GRANTED`, `WITHDRAWN`, `EXPIRED` |
| `permissions` | `JSONB` | Granular flags (`shareVitalsWithFamilyApp`, `shareGpsLocationWithFamilyApp`, etc.) |
| `abdmArtefactId` | `VARCHAR(64)` | ABDM HIE-CM compatible consent artefact reference |
| `entryHash` | `CHAR(64)` | SHA-256 hash chaining each audit entry to `previousHash` |

---

## 2. DPDP Act 2023 Compliance Matrix

| DPDP Act 2023 Requirement | Platform Implementation |
| :--- | :--- |
| **Notice & Granular Consent Capture** | Enrolment captures explicit purpose-bound consent with separate toggles for wearable monitoring, family vitals sharing, family GPS sharing, and emergency SMS/Voice alerts (`DPDPConsentRecord`). |
| **Instant Consent Withdrawal** | `PATCH /api/v1/patients/:id/consent` allows immediate withdrawal of all or specific permissions. Withdrawing family vitals/GPS sharing **immediately redacts** those fields from `/api/v1/family/patients/:id/calm-view`. |
| **Data Principal Rights (Access & Erasure)** | Residents can export their full telemetry/alert history in machine-readable JSON/FHIR R4 format and request erasure upon leaving the care centre. |
| **Data Retention & Minimisation** | Raw high-frequency telemetry is retained for 90 days; `1h` roll-ups and consent/audit logs are retained for 365 days (configurable via `retentionDays`). |
| **Audit of Every Access** | Every read/write to resident data appends an immutable SHA-256 hash-chained entry in `SecurityConsentAuditService`. |

---

## 3. HL7 FHIR R4 & ABDM Consent Artefact Mapping

Implemented in [`src/domain/fhir-abdm-mapper.ts`](file:///c:/Projects/Antigravity/health-monitoring-app/src/domain/fhir-abdm-mapper.ts):
- **`Patient` Resource**: Maps `PatientRecord` to NRCeS/UK Core compatible FHIR R4 `Patient`.
- **`Device` Resource**: Maps `WearableDevice` serial number, model, and firmware version to FHIR R4 `Device`.
- **`Observation` Resource (Vital Signs)**:
  - Heart Rate → LOINC `8867-4` (`Heart rate`, unit `/min`)
  - Blood Oxygen SpO2 → LOINC `59408-5` (`Oxygen saturation in Arterial blood by Pulse oximetry`, unit `%`)
  - Skin/Body Temperature → LOINC `8310-5` (`Body temperature`, unit `Cel`)
- **ABDM HIE-CM Consent Artefact**: Maps `DPDPConsentRecord` into the ABDM `consentDetail` schema (`purpose.code = CAREMGT`, `hiTypes`, `permission.dateRange`, `dataEraseAt`), ensuring zero rework when ABDM certification is pursued in Phase 2/3.
