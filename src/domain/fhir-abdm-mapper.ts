import {
  CanonicalTelemetryPacket,
  DPDPConsentRecord,
  PatientRecord,
  WearableDevice,
} from './canonical-schema.js';

/**
 * HL7 FHIR R4 & ABDM (Ayushman Bharat Digital Mission) Consent Artefact Mappers
 *
 * Non-negotiable requirement:
 * - FHIR R4-mappable data model (Patient, Device, Observation with LOINC codes)
 * - ABDM-compatible HIE-CM Consent Artefact structure (no ABDM certification required in Phase 1)
 */

export interface FhirR4ObservationBundle {
  resourceType: 'Bundle';
  type: 'collection';
  timestamp: string;
  entry: Array<{
    resource: Record<string, unknown>;
  }>;
}

export function mapPatientToFhirR4(patient: PatientRecord): Record<string, unknown> {
  return {
    resourceType: 'Patient',
    id: patient.id,
    meta: {
      profile: ['https://nrces.in/ndhm/fhir/r4/StructureDefinition/Patient'],
    },
    identifier: [
      {
        system: 'https://carepulse.uk/patient-id',
        value: patient.id,
      },
    ],
    active: true,
    name: [
      {
        use: 'official',
        text: patient.fullName,
      },
    ],
    gender: patient.gender.toLowerCase(),
    address: [
      {
        text: `${patient.roomOrFlat}, ${patient.homeAddress}`,
      },
    ],
    managingOrganization: {
      reference: `Organization/${patient.careCentreId}`,
    },
  };
}

export function mapDeviceToFhirR4(device: WearableDevice): Record<string, unknown> {
  return {
    resourceType: 'Device',
    id: device.deviceId,
    identifier: [
      {
        system: 'https://carepulse.uk/device-serial',
        value: device.serialNumber,
      },
    ],
    status: device.provisioningStatus === 'ACTIVE' ? 'active' : 'inactive',
    manufacturer: device.vendorModel.split('-')[0],
    modelNumber: device.vendorModel,
    version: [
      {
        value: device.firmwareVersion,
      },
    ],
    patient: {
      reference: `Patient/${device.patientId}`,
    },
  };
}

export function mapTelemetryToFhirR4Bundle(
  patient: PatientRecord,
  device: WearableDevice,
  packet: CanonicalTelemetryPacket
): FhirR4ObservationBundle {
  const entries: Array<{ resource: Record<string, unknown> }> = [
    { resource: mapPatientToFhirR4(patient) },
    { resource: mapDeviceToFhirR4(device) },
  ];

  if (packet.metrics.heartRateBpm !== undefined) {
    entries.push({
      resource: {
        resourceType: 'Observation',
        id: `${packet.messageId}-hr`,
        status: 'final',
        category: [
          {
            coding: [
              {
                system: 'http://terminology.hl7.org/CodeSystem/observation-category',
                code: 'vital-signs',
                display: 'Vital Signs',
              },
            ],
          },
        ],
        code: {
          coding: [
            {
              system: 'http://loinc.org',
              code: '8867-4',
              display: 'Heart rate',
            },
          ],
        },
        subject: { reference: `Patient/${patient.id}` },
        device: { reference: `Device/${device.deviceId}` },
        effectiveDateTime: packet.observedAt,
        issued: packet.receivedAt,
        valueQuantity: {
          value: packet.metrics.heartRateBpm,
          unit: '/min',
          system: 'http://unitsofmeasure.org',
          code: '/min',
        },
      },
    });
  }

  if (packet.metrics.spo2Pct !== undefined) {
    entries.push({
      resource: {
        resourceType: 'Observation',
        id: `${packet.messageId}-spo2`,
        status: 'final',
        category: [
          {
            coding: [
              {
                system: 'http://terminology.hl7.org/CodeSystem/observation-category',
                code: 'vital-signs',
                display: 'Vital Signs',
              },
            ],
          },
        ],
        code: {
          coding: [
            {
              system: 'http://loinc.org',
              code: '59408-5',
              display: 'Oxygen saturation in Arterial blood by Pulse oximetry',
            },
          ],
        },
        subject: { reference: `Patient/${patient.id}` },
        device: { reference: `Device/${device.deviceId}` },
        effectiveDateTime: packet.observedAt,
        issued: packet.receivedAt,
        valueQuantity: {
          value: packet.metrics.spo2Pct,
          unit: '%',
          system: 'http://unitsofmeasure.org',
          code: '%',
        },
      },
    });
  }

  if (packet.metrics.skinTempC !== undefined) {
    entries.push({
      resource: {
        resourceType: 'Observation',
        id: `${packet.messageId}-temp`,
        status: 'final',
        code: {
          coding: [
            {
              system: 'http://loinc.org',
              code: '8310-5',
              display: 'Body temperature',
            },
          ],
        },
        subject: { reference: `Patient/${patient.id}` },
        device: { reference: `Device/${device.deviceId}` },
        effectiveDateTime: packet.observedAt,
        issued: packet.receivedAt,
        valueQuantity: {
          value: packet.metrics.skinTempC,
          unit: 'Cel',
          system: 'http://unitsofmeasure.org',
          code: 'Cel',
        },
      },
    });
  }

  return {
    resourceType: 'Bundle',
    type: 'collection',
    timestamp: new Date().toISOString(),
    entry: entries,
  };
}

/**
 * Maps internal DPDP Act 2023 Consent Record to an ABDM HIE-CM compatible Consent Artefact
 */
export function mapConsentToAbdmArtefact(consent: DPDPConsentRecord): Record<string, unknown> {
  const expiryDate = new Date(
    Date.parse(consent.grantedAt) + consent.retentionDays * 24 * 60 * 60 * 1000
  ).toISOString();

  const hiTypes: string[] = ['WellnessRecord'];
  if (consent.permissions.shareVitalsWithFamilyApp) {
    hiTypes.push('VitalSignsObservation');
  }
  if (consent.permissions.shareGpsLocationWithFamilyApp) {
    hiTypes.push('SafetyGeofenceLocation');
  }

  return {
    schemaVersion: 'ABDM-HIE-CM-v1.0-DPDP2023',
    consentId: consent.abdmArtefactId,
    createdAt: consent.grantedAt,
    status: consent.status,
    consentDetail: {
      purpose: {
        text: consent.purpose,
        code: 'CAREMGT',
        refUri: 'http://terminology.hl7.org/ValueSet/v3-PurposeOfUse',
      },
      patient: {
        id: `${consent.patientId}@abdm`,
        name: consent.dataPrincipalName,
      },
      hip: {
        id: consent.careCentreId,
        name: 'Sunrise Senior Living Care Centre',
      },
      hiu: {
        id: 'family-mobile-viewer',
        name: 'Authorized Overseas Family App',
      },
      hiTypes,
      permission: {
        accessMode: 'VIEW',
        dateRange: {
          from: consent.grantedAt,
          to: consent.withdrawnAt || expiryDate,
        },
        dataEraseAt: expiryDate,
        frequency: {
          unit: 'HOUR',
          value: 1,
          repeats: 0,
        },
      },
    },
  };
}
