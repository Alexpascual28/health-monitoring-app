# 05. Infrastructure & Third-Party Cost Model (60 Patients vs. 5,000 Patients)

## 1. Sizing Assumptions
- **Cloud Region**: AWS UK (`eu-west-2` London), Multi-AZ High Availability (99.9% SLA, RPO ≤ 15 min, RTO ≤ 4 h).
- **Telemetry Frequency**: 1 packet every 60 seconds per wearable band (~43,200 packets/patient/month) + discrete event packets (Fall, SOS, Wear-State, GPS).
- **Alert & OTP Volume**:
  - ~15 SMS (DLT) messages + ~3 automated Voice TTS calls per patient per month (including family OTP sign-ins and Tier 1–3 escalations).
  - Push notifications (FCM) and WebSocket console updates are free of per-message carrier charges.

---

## 2. Monthly Cost Breakdown: 60 Patients (Phase 1 Initial Pilot)

| Category | Service / Sizing (`eu-west-2` London) | Monthly Cost (GBP £) | Monthly Cost (USD \$) |
| :--- | :--- | ---: | ---: |
| **Compute (App & Ingestion)** | 2× AWS ECS Fargate Tasks (0.5 vCPU, 1 GB RAM, Multi-AZ) + ALB | £58.00 | \$74.00 |
| **Database & Time-Series** | Multi-AZ RDS PostgreSQL 16 / TimescaleDB (`db.t4g.medium`, 50 GB GP3 + Backups) | £96.00 | \$122.00 |
| **MQTT TLS Broker** | AWS IoT Core (~2.6M messages/mo for 60 bands) | £3.20 | \$4.10 |
| **Security & KMS** | AWS KMS CMK (with rotation) + Secrets Manager + CloudWatch Audit Logs | £14.50 | \$18.50 |
| **SMS (DLT) & Voice TTS** | ~900 SMS DLT + ~180 Voice minutes (Twilio UK/India + SNS failover) | £24.00 | \$30.50 |
| **Maps & Geofencing** | Server-side Haversine geofencing (free) + ~2,000 map tile loads | £4.30 | \$5.50 |
| **Total Monthly (60 Patients)** | **All-in Production Run Cost** | **£200.00 / mo** | **\$254.60 / mo** |
| **Unit Cost per Patient (60)** | **Per Active Monitored Resident** | **£3.33 / patient / mo** | **\$4.24 / patient / mo** |

---

## 3. Monthly Cost Breakdown: 5,000 Patients (Phase 2/3 Multi-Centre Scale)

Because the platform uses stateless horizontal scaling, continuous time-series roll-ups, and server-side Haversine geofencing, unit cost per patient drops by **>68%** at 5,000-band scale:

| Category | Service / Sizing (`eu-west-2` London) | Monthly Cost (GBP £) | Monthly Cost (USD \$) |
| :--- | :--- | ---: | ---: |
| **Compute (Auto-Scaling)** | 4–6× AWS ECS Fargate Tasks (2 vCPU, 4 GB RAM, Multi-AZ) + ALB | £340.00 | \$432.00 |
| **Database & Time-Series** | Multi-AZ RDS PostgreSQL 16 / TimescaleDB (`db.r6g.large`, 500 GB GP3 + Read Replica) | £620.00 | \$788.00 |
| **MQTT TLS Cluster** | AWS IoT Core / EMQX (~216M messages/mo for 5,000 bands) | £195.00 | \$248.00 |
| **Security, KMS & WAF** | AWS WAF + KMS CMK + Secrets Manager + S3 Immutable Audit Archive | £85.00 | \$108.00 |
| **SMS (DLT) & Voice TTS** | ~75,000 SMS DLT + ~10,000 Voice minutes (committed volume tier) | £1,320.00 | \$1,676.00 |
| **Maps & Geofencing** | Server-side Haversine calculation + ~50,000 console map renders | £65.00 | \$82.50 |
| **Total Monthly (5,000 Patients)** | **All-in Production Run Cost** | **£2,625.00 / mo** | **\$3,334.50 / mo** |
| **Unit Cost per Patient (5,000)** | **Per Active Monitored Resident** | **£0.53 / patient / mo** | **\$0.67 / patient / mo** |

---

## 4. Non-Production Environments Cost (`dev`, `qa`, `uat`)
- `dev` and `qa` run on scheduled single-AZ burstable instances (`db.t4g.micro` / Fargate Spot) during working hours: **~£65/month total**.
- `uat` mirrors `prod` topology during load testing and VAPT windows: **~£110/month**.
