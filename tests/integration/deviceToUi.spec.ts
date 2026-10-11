import { settings } from '../../src/config';
import { OpcUaClient } from '../../src/opcua/OpcUaClient';
import { expect, test } from '../fixtures';

test('should propagate one live reading through OPC UA, API and AQI UI', async ({
  deviceApi,
  london,
}) => {
  const opc = new OpcUaClient(settings.opcEndpoint);
  try {
    await opc.connect();
    const reading = await opc.readNode(settings.liveNode);
    expect(typeof reading).toBe('number');
    expect(Number.isFinite(reading)).toBe(true);
    if (typeof reading !== 'number') throw new Error('Simulator reading is not numeric');

    const provisionResponse = await deviceApi.provisionDevice({
      model: 'TX-100',
      sensor_type: 'temperature',
      firmware: 'v1.2.0',
      status: 'provisioned',
    });
    expect(provisionResponse.status()).toBe(200);
    const provisioned = await deviceApi.parseDevice(provisionResponse);
    await expect(deviceApi.updateReading(provisioned.id, reading)).rejects.toThrow(
      'status: provisioned',
    );

    const activeResponse = await deviceApi.updateFirmware(provisioned.id, 'v1.3.1');
    expect(activeResponse.status()).toBe(200);
    const updateResponse = await deviceApi.updateReading(provisioned.id, reading);
    expect(updateResponse.status()).toBe(200);
    const updated = await deviceApi.parseDevice(updateResponse);
    expect(updated.data.lastReading).toBe(reading);
    const persistedResponse = await deviceApi.getDevice(provisioned.id);
    expect(persistedResponse.status()).toBe(200);
    const persisted = await deviceApi.parseDevice(persistedResponse);
    expect(persisted.data.lastReading).toBe(reading);
    expect(persisted.data.model).toBe(provisioned.data.model);
    expect(persisted.data.sensor_type).toBe(provisioned.data.sensor_type);

    const before = london.mock.requestCount;
    london.mock.setScenario('value', persisted.data.lastReading);
    await london.airQuality.refreshAqi();
    await expect.poll(() => london.mock.requestCount).toBeGreaterThan(before);
    london.mock.assertHealthy();
    expect(london.mock.lastDeliveredValue).toBe(persisted.data.lastReading);
    await london.airQuality.expectAqi(reading);
    expect(await london.airQuality.readAqi()).toBe(reading);
    expect(london.pageErrors).toEqual([]);

    const deleteResponse = await deviceApi.decommissionDevice(provisioned.id);
    expect(deleteResponse.status()).toBe(200);
    expect((await deviceApi.getDevice(provisioned.id)).status()).toBe(404);
  } finally {
    await opc.disconnect();
  }
});
