import dotenv from 'dotenv';

dotenv.config();

export interface PlatformConfig {
  nodeEnv: string;
  cloudRegion: string;
  port: number;
  mqttPort: number;
  mqttTlsEnabled: boolean;
  tlsMinVersion: string;
  defaultCareCentreId: string;
  defaultCareCentreName: string;
  jwtSecret: string;
  encryptionKeyCurrentId: string;
  encryptionKeys: Record<string, string>;
  deviceProvisioningHmacSecret: string;
  deviceRateLimitPerMin: number;
  outOfOrderBufferWindowMs: number;
  smsProviderPrimary: string;
  smsProviderFailover: string;
  smsDltEntityId: string;
  smsDltCriticalTemplateId: string;
}

export const config: PlatformConfig = {
  nodeEnv: process.env.NODE_ENV || 'development',
  cloudRegion: process.env.CLOUD_REGION || 'eu-west-2',
  port: Number(process.env.PORT || 4000),
  mqttPort: Number(process.env.MQTT_PORT || 1883),
  mqttTlsEnabled: process.env.MQTT_TLS_ENABLED !== 'false',
  tlsMinVersion: process.env.TLS_MIN_VERSION || 'TLSv1.2',
  defaultCareCentreId: process.env.DEFAULT_CARE_CENTRE_ID || 'cc-uk-sunrise-01',
  defaultCareCentreName: process.env.DEFAULT_CARE_CENTRE_NAME || 'Sunrise Senior Living - London Care Centre',
  jwtSecret: process.env.JWT_SECRET || 'dev-vaulted-jwt-secret-key-health-monitoring-platform-2026-uk',
  encryptionKeyCurrentId: process.env.ENCRYPTION_KEY_CURRENT_ID || 'key-v2-2026-11',
  encryptionKeys: {
    'key-v2-2026-11': process.env.ENCRYPTION_KEY_V2_AES256 || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    'key-v1-2026-10': process.env.ENCRYPTION_KEY_V1_AES256 || 'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210',
  },
  deviceProvisioningHmacSecret: process.env.DEVICE_PROVISIONING_HMAC_SECRET || 'band-provisioning-root-secret-dev-only',
  deviceRateLimitPerMin: Number(process.env.DEVICE_RATE_LIMIT_PER_MIN || 120),
  outOfOrderBufferWindowMs: Number(process.env.OUT_OF_ORDER_BUFFER_WINDOW_MS || 300000),
  smsProviderPrimary: process.env.SMS_PROVIDER_PRIMARY || 'twilio-uk-in-dlt',
  smsProviderFailover: process.env.SMS_PROVIDER_FAILOVER || 'aws-sns-dlt',
  smsDltEntityId: process.env.SMS_DLT_ENTITY_ID || '1101582910000049281',
  smsDltCriticalTemplateId: process.env.SMS_DLT_CRITICAL_TEMPLATE_ID || '1107169820000010001',
};
