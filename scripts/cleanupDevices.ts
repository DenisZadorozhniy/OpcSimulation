import { request } from '@playwright/test';
import { DeviceApiClient } from '../src/api/DeviceApiClient';

async function cleanupDevices(): Promise<void> {
  const context = await request.newContext();
  try {
    await new DeviceApiClient(context).cleanupRecordedDevices();
    console.log('Recorded test devices cleaned up');
  } finally {
    await context.dispose();
  }
}

void cleanupDevices().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
