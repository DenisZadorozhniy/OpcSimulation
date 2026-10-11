import { expect } from '@playwright/test';
import { settings } from '../src/config';
import { OpcUaClient } from '../src/opcua/OpcUaClient';

async function waitForOpcUa(): Promise<void> {
  let lastError: unknown;
  try {
    await expect
      .poll(
        async () => {
          const client = new OpcUaClient(settings.opcEndpoint);
          let ready = false;
          try {
            await client.connect();
            const value = await client.readNode(settings.liveNode);
            ready = typeof value === 'number' && Number.isFinite(value);
          } catch (error) {
            lastError = error;
          } finally {
            await client.disconnect().catch((error) => {
              lastError = error;
              ready = false;
            });
          }
          return ready;
        },
        {
          timeout: 90_000,
          intervals: [1_000],
          message: 'OPC UA simulator must accept sessions and expose a live numeric node',
        },
      )
      .toBe(true);
  } catch (cause) {
    throw new Error(`OPC UA readiness failed: ${String(lastError)}`, { cause });
  }
  console.log(`OPC UA simulator ready: ${settings.opcEndpoint}`);
}

void waitForOpcUa().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
