import { createPlatformServer } from './api-server.js';
import { config } from '../config/env.js';

const { httpServer } = createPlatformServer();

httpServer.listen(config.port, () => {
  console.log(
    `[CarePulse 24x7 Backend] Running in UK region (${config.cloudRegion}) on http://localhost:${config.port}`
  );
  console.log(
    `[CarePulse 24x7 WebSocket Hub] Streaming real-time telemetry & alerts on ws://localhost:${config.port}/ws`
  );
});
