import { APIRequestContext, APIResponse } from '@playwright/test';
import { BaseApiClient } from './BaseApiClient';
import { settings } from '../config';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

interface DeviceReceipt {
  id: string;
  baseUrl: string;
}

export type DeviceStatus = 'provisioned' | 'active';

export interface DeviceData {
  model: string;
  sensor_type: string;
  firmware: string;
  status: DeviceStatus;
  lastReading?: number;
}

export interface Device {
  id: string;
  name: string;
  data: DeviceData;
}

export class DeviceApiClient extends BaseApiClient {
  private readonly ownedIds = new Set<string>();
  private readonly receiptPath = resolve('tmp/device-receipts.json');

  constructor(request: APIRequestContext, baseUrl = settings.apiBaseUrl) {
    super(request, baseUrl);
  }

  async provisionDevice(device: DeviceData): Promise<APIResponse> {
    if (device.status !== 'provisioned') {
      throw new Error('A new device must have status: provisioned');
    }
    const response = await this.post('/objects', {
      name: device.model,
      data: device,
    });
    if (response.ok()) {
      const created: unknown = await response.json();
      if (
        !created ||
        typeof created !== 'object' ||
        !('id' in created) ||
        typeof created.id !== 'string' ||
        !created.id
      ) {
        throw new Error('Provisioning response has no generated ID');
      }
      if (/^(?:[1-9]|1[0-3])$/.test(created.id)) {
        throw new Error('The API returned a protected demo object ID');
      }
      this.ownedIds.add(created.id);
      this.recordReceipt(created.id);
      await this.parseDevice(response);
    }
    return response;
  }

  async getDevice(id: string): Promise<APIResponse> {
    return this.get(`/objects/${encodeURIComponent(id)}`);
  }

  async updateFirmware(id: string, firmware: string): Promise<APIResponse> {
    const device = await this.getOwnedDevice(id);
    if (!firmware.trim()) throw new Error('Firmware must not be empty');
    return this.patch(`/objects/${encodeURIComponent(id)}`, {
      data: {
        ...device.data,
        firmware,
        status: 'active',
      },
    });
  }

  async decommissionDevice(id: string): Promise<APIResponse> {
    const device = await this.getOwnedDevice(id);

    if (device.data.status !== 'active') {
      throw new Error(`Cannot decommission device with status: ${device.data.status}`);
    }

    const response = await this.delete(`/objects/${encodeURIComponent(id)}`);
    if (response.ok()) {
      this.removeReceipt(id);
      this.ownedIds.delete(id);
    }
    return response;
  }

  async updateReading(id: string, lastReading: number): Promise<APIResponse> {
    if (!Number.isFinite(lastReading)) throw new Error('Reading must be finite');
    const device = await this.getOwnedDevice(id);
    if (device.data.status !== 'active') {
      throw new Error(`Cannot update telemetry with status: ${device.data.status}`);
    }
    return this.patch(`/objects/${encodeURIComponent(id)}`, {
      data: { ...device.data, lastReading },
    });
  }

  async cleanup(): Promise<void> {
    const failures: string[] = [];
    for (const id of this.ownedIds) {
      try {
        const response = await this.delete(`/objects/${encodeURIComponent(id)}`);
        if (!response.ok() && response.status() !== 404) {
          throw new Error(`HTTP ${response.status()}`);
        }
        this.removeReceipt(id);
        this.ownedIds.delete(id);
      } catch (error) {
        failures.push(`${id}: ${String(error)}`);
      }
    }
    if (failures.length) throw new Error(`Device cleanup failed: ${failures.join('; ')}`);
  }

  async cleanupRecordedDevices(): Promise<void> {
    for (const receipt of this.readReceipts()) {
      if (receipt.baseUrl === this.baseUrl) this.ownedIds.add(receipt.id);
    }
    await this.cleanup();
  }

  private readReceipts(): DeviceReceipt[] {
    if (!existsSync(this.receiptPath)) return [];
    const value: unknown = JSON.parse(readFileSync(this.receiptPath, 'utf8'));
    if (
      !Array.isArray(value) ||
      !value.every(
        (entry: unknown) =>
          !!entry &&
          typeof entry === 'object' &&
          'id' in entry &&
          typeof entry.id === 'string' &&
          !!entry.id &&
          !/^(?:[1-9]|1[0-3])$/.test(entry.id) &&
          'baseUrl' in entry &&
          typeof entry.baseUrl === 'string',
      )
    ) {
      throw new Error('Invalid device ownership receipts; cleanup refused');
    }
    return value as DeviceReceipt[];
  }

  private recordReceipt(id: string): void {
    const receipts = this.readReceipts();
    if (!receipts.some((receipt) => receipt.id === id && receipt.baseUrl === this.baseUrl)) {
      receipts.push({ id, baseUrl: this.baseUrl });
    }
    this.writeReceipts(receipts);
  }

  private removeReceipt(id: string): void {
    this.writeReceipts(
      this.readReceipts().filter(
        (receipt) => receipt.id !== id || receipt.baseUrl !== this.baseUrl,
      ),
    );
  }

  private writeReceipts(receipts: DeviceReceipt[]): void {
    mkdirSync(dirname(this.receiptPath), { recursive: true });
    writeFileSync(this.receiptPath, JSON.stringify(receipts, null, 2) + '\n', 'utf8');
  }

  async parseDevice(response: APIResponse): Promise<Device> {
    if (!response.ok()) {
      throw new Error(`Device API HTTP ${response.status()}: ${await response.text()}`);
    }
    const value: unknown = await response.json();
    if (
      !value ||
      typeof value !== 'object' ||
      !('id' in value) ||
      typeof value.id !== 'string' ||
      !value.id ||
      !('name' in value) ||
      typeof value.name !== 'string' ||
      !('data' in value) ||
      !value.data ||
      typeof value.data !== 'object'
    ) {
      throw new Error('Invalid device response');
    }
    const data = value.data;
    if (
      !('model' in data) ||
      typeof data.model !== 'string' ||
      !('sensor_type' in data) ||
      typeof data.sensor_type !== 'string' ||
      !('firmware' in data) ||
      typeof data.firmware !== 'string' ||
      !('status' in data) ||
      (data.status !== 'provisioned' && data.status !== 'active') ||
      ('lastReading' in data &&
        (typeof data.lastReading !== 'number' || !Number.isFinite(data.lastReading)))
    ) {
      throw new Error('Invalid device data');
    }
    return value as Device;
  }

  private async getOwnedDevice(id: string): Promise<Device> {
    if (!this.ownedIds.has(id)) {
      throw new Error(`Device ${id} was not provisioned by this client`);
    }
    return this.parseDevice(await this.getDevice(id));
  }
}
