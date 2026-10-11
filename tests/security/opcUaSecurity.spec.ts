import { existsSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { expect, test, TestInfo } from '@playwright/test';
import { MessageSecurityMode, SecurityPolicy, StatusCodes } from 'node-opcua';
import { settings } from '../../src/config';
import { OpcUaClient, OpcUaConnectionError } from '../../src/opcua/OpcUaClient';

const secured = {
  securityMode: MessageSecurityMode.SignAndEncrypt,
  securityPolicy: SecurityPolicy.Basic256Sha256,
};

async function discoverCertificate(testInfo: TestInfo): Promise<Buffer> {
  expect(
    ['localhost', '127.0.0.1', '[::1]'].includes(new URL(settings.opcSecurityEndpoint).hostname),
    'Automatic test bootstrap trust is restricted to the local simulator',
  ).toBe(true);
  // Discovery obtains a public certificate; it does not establish trust.
  const discovery = new OpcUaClient(settings.opcSecurityEndpoint, {
    pkiRoot: testInfo.outputPath('discovery-pki'),
  });

  const endpoints = await discovery.discoverEndpoints();
  const endpoint = endpoints.find(
    (item) =>
      item.securityMode === secured.securityMode &&
      item.securityPolicyUri === secured.securityPolicy,
  );

  expect(endpoint, 'Simulator must advertise SignAndEncrypt / Basic256Sha256').toBeDefined();
  expect(endpoint!.serverCertificate?.length).toBeGreaterThan(0);
  const certificate = endpoint!.serverCertificate!;
  await testInfo.attach('server-certificate-sha256', {
    body: createHash('sha256').update(certificate).digest('hex'),
    contentType: 'text/plain',
  });
  return certificate;
}

test('should connect and disconnect with explicit None security', async ({}, testInfo) => {
  const client = new OpcUaClient(settings.opcEndpoint, {
    securityMode: MessageSecurityMode.None,
    securityPolicy: SecurityPolicy.None,
    pkiRoot: testInfo.outputPath('client-pki'),
  });

  try {
    await client.connect();
    expect(client.isSessionActive()).toBe(true);
    expect(client.negotiatedSecurity).toEqual({
      mode: MessageSecurityMode.None,
      policy: SecurityPolicy.None,
    });
  } finally {
    await client.disconnect();
  }

  expect(client.isSessionActive()).toBe(false);
  expect(client.activeSubscriptionCount).toBe(0);
});

test('should connect securely after explicitly trusting the server certificate', async ({}, testInfo) => {
  const certificate = await discoverCertificate(testInfo);
  const client = new OpcUaClient(settings.opcSecurityEndpoint, {
    ...secured,
    serverCertificate: certificate,
    pkiRoot: testInfo.outputPath('client-pki'),
  });

  try {
    expect((await client.checkServerCertificate(certificate)).value).toBe(
      StatusCodes.BadCertificateUntrusted.value,
    );
    expect(readdirSync(join(client.pkiRoot, 'rejected')).length).toBeGreaterThan(0);
    await client.trustServerCertificate(certificate);

    expect((await client.checkServerCertificate(certificate)).value).toBe(StatusCodes.Good.value);
    expect(readdirSync(join(client.pkiRoot, 'trusted/certs')).length).toBeGreaterThan(0);

    await client.connect();
    expect(client.isSessionActive()).toBe(true);
    expect(client.negotiatedSecurity).toEqual({
      mode: secured.securityMode,
      policy: secured.securityPolicy,
    });
    expect(existsSync(client.certificateFile)).toBe(true);
    expect(typeof (await client.readNode(settings.liveNode))).toBe('number');
    console.log('Client certificate:', client.certificateFile, 'PKI:', client.pkiRoot);
  } finally {
    await client.disconnect();
  }

  expect(client.isSessionActive()).toBe(false);
  await expect(client.readNode(settings.liveNode)).rejects.toThrow();
});

test('should reject an untrusted server certificate with a typed status code', async ({}, testInfo) => {
  testInfo.setTimeout(15_000);
  const certificate = await discoverCertificate(testInfo);
  const client = new OpcUaClient(settings.opcSecurityEndpoint, {
    ...secured,
    pkiRoot: testInfo.outputPath('isolated-untrusted-pki'),
  });
  try {
    const failure = await client.connect().then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(OpcUaConnectionError);
    expect((failure as OpcUaConnectionError).statusCode?.value).toBe(
      StatusCodes.BadCertificateUntrusted.value,
    );
    expect(client.isSessionActive()).toBe(false);
    expect((await client.checkServerCertificate(certificate)).value).toBe(
      StatusCodes.BadCertificateUntrusted.value,
    );
    expect(readdirSync(join(client.pkiRoot, 'rejected')).length).toBeGreaterThan(0);
    expect(readdirSync(join(client.pkiRoot, 'trusted/certs'))).toEqual([]);
  } finally {
    await client.disconnect();
  }
});

test('should preserve the legacy constructor and live reading behavior', async () => {
  const client = new OpcUaClient(settings.opcEndpoint);
  try {
    await client.connect();
    expect(client.isSessionActive()).toBe(true);
    const value = await client.readNode(settings.liveNode);
    expect(typeof value).toBe('number');
    expect(Number.isFinite(value)).toBe(true);
  } finally {
    await client.disconnect();
  }
  expect(client.isSessionActive()).toBe(false);
});

test('should validate trust even when a server certificate is supplied explicitly', async ({}, testInfo) => {
  const certificate = await discoverCertificate(testInfo);
  const client = new OpcUaClient(settings.opcSecurityEndpoint, {
    ...secured,
    serverCertificate: certificate,
    pkiRoot: testInfo.outputPath('explicit-untrusted-pki'),
  });
  try {
    const error = await client.connect().then(
      () => undefined,
      (failure: unknown) => failure,
    );
    expect(error).toBeInstanceOf(OpcUaConnectionError);
    expect((error as OpcUaConnectionError).statusCode?.value).toBe(
      StatusCodes.BadCertificateUntrusted.value,
    );
    expect(client.isSessionActive()).toBe(false);
  } finally {
    await client.disconnect();
  }
});
