import { expect } from '@playwright/test';
import { MessageSecurityMode, SecurityPolicy } from 'node-opcua';
import { settings } from '../src/config';
import { OpcUaClient } from '../src/opcua/OpcUaClient';

async function waitForSecurityEndpoint(): Promise<void> {
  await expect
    .poll(
      async () => {
        const discovery = new OpcUaClient(settings.opcSecurityEndpoint, {
          pkiRoot: 'tmp/security-readiness-pki',
        });
        try {
          const endpoints = await discovery.discoverEndpoints();
          return endpoints.some(
            (endpoint) =>
              endpoint.securityMode === MessageSecurityMode.SignAndEncrypt &&
              endpoint.securityPolicyUri === SecurityPolicy.Basic256Sha256 &&
              !!endpoint.serverCertificate?.length,
          );
        } catch {
          return false;
        }
      },
      {
        timeout: 90_000,
        intervals: [1_000],
        message: 'Simulator must expose a secured endpoint with a server certificate',
      },
    )
    .toBe(true);
  console.log(`Secured OPC UA endpoint ready: ${settings.opcSecurityEndpoint}`);
}

void waitForSecurityEndpoint().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
