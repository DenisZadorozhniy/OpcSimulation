import { createServer, Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test as base, expect } from '@playwright/test';
import { Device, DeviceApiClient } from '../../src/api/DeviceApiClient';

type LocalApi = {
  client: DeviceApiClient;
  baseUrl: string;
  methods: string[];
  rejectDelete: boolean;
};

const test = base.extend<{ localApi: LocalApi }>({
  localApi: async ({ request }, use) => {
    const devices = new Map<string, Device>();
    const methods: string[] = [];
    const server: Server = createServer((incoming, response) => {
      void (async () => {
        const method = incoming.method ?? '';
        methods.push(method);
        const id = incoming.url?.split('/')[2] ?? '';
        let body = '';
        for await (const chunk of incoming) body += String(chunk);
        response.setHeader('content-type', 'application/json');
        if (method === 'POST') {
          const payload = JSON.parse(body) as Omit<Device, 'id'>;
          const created: Device = { ...payload, id: randomUUID() };
          devices.set(created.id, created);
          response.end(JSON.stringify(created));
        } else if (method === 'DELETE' && localApi.rejectDelete) {
          response.statusCode = 503;
          response.end(JSON.stringify({ error: 'Temporary cleanup failure' }));
        } else if (!devices.has(id)) {
          response.statusCode = 404;
          response.end(JSON.stringify({ error: 'Not found' }));
        } else if (method === 'DELETE') {
          devices.delete(id);
          response.end(JSON.stringify({ deleted: id }));
        } else if (method === 'PATCH') {
          const payload = JSON.parse(body) as Pick<Device, 'data'>;
          const updated = { ...devices.get(id)!, data: payload.data };
          devices.set(id, updated);
          response.end(JSON.stringify(updated));
        } else {
          response.end(JSON.stringify(devices.get(id)));
        }
      })().catch((error) => {
        response.statusCode = 500;
        response.end(JSON.stringify({ error: String(error) }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Local API did not bind a port');
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const localApi: LocalApi = {
      client: new DeviceApiClient(request, baseUrl),
      baseUrl,
      methods,
      rejectDelete: false,
    };
    try {
      await use(localApi);
    } finally {
      localApi.rejectDelete = false;
      try {
        await localApi.client.cleanup();
      } finally {
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
      }
    }
  },
});

const hardware = {
  model: 'TX-100',
  sensor_type: 'temperature',
  firmware: 'v1.2.0',
  status: 'provisioned',
} as const;

test('should refuse invalid transitions before sending mutation requests', async ({ localApi }) => {
  await expect(localApi.client.decommissionDevice('1')).rejects.toThrow('was not provisioned');
  expect(localApi.methods).toEqual([]);
  const device = await localApi.client.parseDevice(await localApi.client.provisionDevice(hardware));
  await expect(localApi.client.decommissionDevice(device.id)).rejects.toThrow(
    'status: provisioned',
  );
  await expect(localApi.client.updateReading(device.id, 42)).rejects.toThrow('status: provisioned');
  expect(localApi.methods.filter((method) => method === 'DELETE' || method === 'PATCH')).toEqual(
    [],
  );
});

test('should preserve hardware specs and telemetry when PATCH replaces nested data', async ({
  localApi,
}) => {
  const device = await localApi.client.parseDevice(await localApi.client.provisionDevice(hardware));
  await localApi.client.updateFirmware(device.id, 'v1.3.1');
  await localApi.client.updateReading(device.id, 123);
  await localApi.client.updateFirmware(device.id, 'v1.3.2');
  const persisted = await localApi.client.parseDevice(await localApi.client.getDevice(device.id));
  expect(persisted.data).toEqual({
    ...hardware,
    firmware: 'v1.3.2',
    status: 'active',
    lastReading: 123,
  });
  expect((await localApi.client.decommissionDevice(device.id)).status()).toBe(200);
  expect((await localApi.client.getDevice(device.id)).status()).toBe(404);
});

test('should retain failed cleanup receipts and resume cleanup with another client', async ({
  localApi,
  request,
}) => {
  const device = await localApi.client.parseDevice(await localApi.client.provisionDevice(hardware));
  localApi.rejectDelete = true;
  await expect(localApi.client.cleanup()).rejects.toThrow('HTTP 503');
  const receipts = JSON.parse(readFileSync('tmp/device-receipts.json', 'utf8')) as unknown[];
  expect(receipts).toContainEqual({ id: device.id, baseUrl: localApi.baseUrl });
  localApi.rejectDelete = false;
  await new DeviceApiClient(request, localApi.baseUrl).cleanupRecordedDevices();
  expect((await localApi.client.getDevice(device.id)).status()).toBe(404);
  expect(JSON.parse(readFileSync('tmp/device-receipts.json', 'utf8'))).not.toContainEqual({
    id: device.id,
    baseUrl: localApi.baseUrl,
  });
});
