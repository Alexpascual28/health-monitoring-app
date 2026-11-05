# 04. Threat Model (STRIDE) & Security / Compliance Controls

## 1. Security Architecture Overview
- **UK Cloud Residency**: All infrastructure provisioned in AWS `eu-west-2` (London).
- **Encryption in Transit**: TLS 1.2+ mandatory across MQTT (`8883`), HTTPS (`443`), and WebSocket (`wss://`) connections.
- **Encryption at Rest & Key Rotation**: AES-256-GCM encryption for resident PII/PHI and database volumes via AWS KMS with automated 90-day key rotation and application-level key-ring re-encryption (`SecurityConsentAuditService.rotateEncryptionKey()`).
- **Immutable Audit Trail**: Cryptographic SHA-256 hash-chained audit log recording every read, write, threshold edit, alert action, and consent change.

---

## 2. STRIDE Threat Model

| Component | Threat Category | Threat Scenario | Mitigation Implemented |
| :--- | :--- | :--- | :--- |
| **Wearable Ingestion** | **S**poofing | Attacker spoofs a resident's band to inject fake SOS or vitals | Per-device X.509 certificate thumbprint + HMAC-SHA256 verification (`verifyDeviceAuth`). Unprovisioned or mismatched tokens rejected (`REJECTED_AUTH`). |
| **Telemetry Stream** | **T**ampering | Man-in-the-middle modifies vitals payload in transit | Enforced TLS 1.2+ on MQTT & HTTPS; strict physiological & schema validation (`validateCanonicalPacket`). |
| **Patient Data & Actions** | **R**epudiation | Caregiver or admin denies modifying thresholds or viewing resident record | SHA-256 hash-chained immutable audit log (`appendAuditLog` + `verifyAuditChainIntegrity`). |
| **Family Mobile App** | **I**nformation Disclosure | Unauthorized party views vitals, or family views vitals after resident withdraws consent | International E.164 OTP authentication + immediate server-side redaction when DPDP consent is withdrawn (`getFamilyCalmView`). |
| **MQTT / HTTPS Gateway** | **D**enial of Service | Faulty or compromised band floods broker with 10,000 msgs/min | Per-device sliding-window rate limiter (`120 msgs/min`) + write-ahead back-pressure buffer (`WearableIngestionService`). |
| **Admin / Threshold API** | **E**levation of Privilege | Caregiver attempts to rotate encryption keys or import rosters | Strict 8-role RBAC permission matrix (`ROLE_PERMISSION_MATRIX`) + Staff MFA verification (`verifyStaffMfa`). |

---

## 3. OWASP Web Top 10, API Top 10 & MASVS L1 Controls

### 3.1 OWASP Web & API Security Top 10
- **API1:2023 Broken Object Level Authorization (BOLA)**: Every query scopes access by `careCentreId` and checks `ROLE_PERMISSION_MATRIX` before returning or mutating resident resources.
- **API2:2023 Broken Authentication**: Staff endpoints require MFA-verified session context; Family App requires E.164 OTP verification; Wearable ingestion requires per-device X.509/HMAC credentials.
- **API3:2023 Broken Object Property Level Authorization**: Family App endpoint (`/api/v1/family/patients/:id/calm-view`) uses a dedicated DTO (`FamilyCalmViewPayload`) that strips internal notes and dynamically redacts `vitals` and `locationSummary` based on `DPDPConsentRecord`.
- **API4:2023 Unrestricted Resource Consumption**: Express JSON body size capped at `2mb`; per-device rate limiting enforced on ingestion.
- **API8:2023 Security Misconfiguration**: Zero hardcoded production secrets; all secrets loaded via `.env` / AWS Secrets Manager (`infra/terraform/main.tf`).

### 3.2 OWASP MASVS Level 1 (Family Mobile App - Android Target)
- **MASVS-STORAGE**: Zero sensitive vitals or PII persisted in unencrypted local storage on Android devices; session tokens held in memory/secure storage.
- **MASVS-CRYPTO**: Uses standard NIST/FIPS algorithms (`AES-256-GCM`, `HMAC-SHA256`, `SHA-256`).
- **MASVS-NETWORK**: Enforces HTTPS/TLS 1.2+ with no cleartext traffic permitted in production manifest.
- **MASVS-AUTH**: Short-lived 5-minute OTP codes for international mobile sign-in.

---

## 4. VAPT Clearance SLA
Prior to Phase 1 Go-Live (Milestone 5), the platform undergoes client-commissioned Vulnerability Assessment and Penetration Testing (VAPT). All **Critical** and **High** findings are remediated and re-verified with zero open Critical/High issues before production cutover.
