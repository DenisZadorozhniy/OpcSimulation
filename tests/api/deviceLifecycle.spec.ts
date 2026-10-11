import { expect, test } from '../fixtures';
import { Device, DeviceApiClient, DeviceData } from '../../src/api/DeviceApiClient';

test('should provision a new device', async ({ deviceApi }) => {
  const deviceApiClient = deviceApi;
  const deviceData: DeviceData = {
    model: 'TX-100',
    sensor_type: 'temperature',
    firmware: 'v1.2.0',
    status: 'provisioned',
  };

  const response = await deviceApiClient.provisionDevice(deviceData);

  expect(response.status()).toBe(200);

  const createdDevice = (await response.json()) as Device;

  console.log('Created device:', createdDevice);

  expect(createdDevice.id).toBeDefined();
  expect(createdDevice.name).toBe(deviceData.model);
  expect(createdDevice.data.model).toBe(deviceData.model);
  expect(createdDevice.data.sensor_type).toBe(deviceData.sensor_type);
  expect(createdDevice.data.firmware).toBe(deviceData.firmware);
  expect(createdDevice.data.status).toBe(deviceData.status);

  const getResponse = await deviceApiClient.getDevice(createdDevice.id);

  expect(getResponse.status()).toBe(200);

  const retrievedDevice = (await getResponse.json()) as Device;

  console.log('Retrieved device:', retrievedDevice);

  expect(retrievedDevice.id).toBe(createdDevice.id);
  expect(retrievedDevice.name).toBe(deviceData.model);
  expect(retrievedDevice.data.model).toBe(deviceData.model);
  expect(retrievedDevice.data.sensor_type).toBe(deviceData.sensor_type);
  expect(retrievedDevice.data.firmware).toBe(deviceData.firmware);
  expect(retrievedDevice.data.status).toBe('provisioned');

  await expect(deviceApiClient.decommissionDevice(createdDevice.id)).rejects.toThrow(
    'Cannot decommission device with status: provisioned',
  );
  await expect(deviceApiClient.updateReading(createdDevice.id, 42)).rejects.toThrow(
    'Cannot update telemetry with status: provisioned',
  );
  expect((await deviceApiClient.getDevice(createdDevice.id)).status()).toBe(200);

  const updateResponse = await deviceApiClient.updateFirmware(createdDevice.id, 'v1.3.1');

  expect(updateResponse.status()).toBe(200);

  const updatedDevice = (await updateResponse.json()) as Device;

  console.log('Updated device:', updatedDevice);

  expect(updatedDevice.data.firmware).toBe('v1.3.1');
  expect(updatedDevice.data.status).toBe('active');
  expect(updatedDevice.data.model).toBe(deviceData.model);
  expect(updatedDevice.data.sensor_type).toBe(deviceData.sensor_type);

  const getUpdatedResponse = await deviceApiClient.getDevice(createdDevice.id);

  expect(getUpdatedResponse.status()).toBe(200);

  const retrievedUpdatedDevice = (await getUpdatedResponse.json()) as Device;

  console.log('Retrieved updated device:', retrievedUpdatedDevice);

  expect(retrievedUpdatedDevice.data.firmware).toBe('v1.3.1');
  expect(retrievedUpdatedDevice.data.status).toBe('active');

  const deleteResponse = await deviceApiClient.decommissionDevice(createdDevice.id);

  expect(deleteResponse.status()).toBe(200);

  console.log('Device decommissioned:', createdDevice.id);

  const getDeletedResponse = await deviceApiClient.getDevice(createdDevice.id);

  expect(getDeletedResponse.status()).toBe(404);

  console.log('Deleted device returns 404 as expected');
  await expect(deviceApiClient.updateFirmware(createdDevice.id, 'v2.0.0')).rejects.toThrow(
    'was not provisioned',
  );
  await expect(deviceApiClient.decommissionDevice(createdDevice.id)).rejects.toThrow(
    'was not provisioned',
  );
});

test('should reject invalid provisioning and modifications to unowned devices', async ({
  request,
}) => {
  const client = new DeviceApiClient(request);
  await expect(
    client.provisionDevice({
      model: 'TX-100',
      sensor_type: 'temperature',
      firmware: 'v1.2.0',
      status: 'active',
    }),
  ).rejects.toThrow('must have status: provisioned');
  await expect(client.updateFirmware('1', 'v1.3.1')).rejects.toThrow('was not provisioned');
  await expect(client.decommissionDevice('1')).rejects.toThrow('was not provisioned');
  await expect(client.updateReading('1', 10)).rejects.toThrow('was not provisioned');
});
