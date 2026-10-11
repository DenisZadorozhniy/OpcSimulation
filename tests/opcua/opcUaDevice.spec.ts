import { expect, test } from '@playwright/test';
import { OpcUaClient } from '../../src/opcua/OpcUaClient';
import { settings } from '../../src/config';

test('should read changing live value from OPC UA simulator', async () => {
  const opcUaClient = new OpcUaClient(settings.opcEndpoint);

  try {
    await opcUaClient.connect();

    const references = await opcUaClient.browse();
    console.log('Discovered OPC UA objects:', references);
    expect(references.length).toBeGreaterThan(0);
    expect(await opcUaClient.getNodeDataType(settings.liveNode)).toBe(settings.liveDataType);

    const firstValue = await opcUaClient.readNode(settings.liveNode);

    console.log(`First StepUp value: ${firstValue}`);

    expect(typeof firstValue).toBe('number');
    expect(Number.isFinite(firstValue)).toBe(true);

    await expect
      .poll(
        async () => {
          const currentValue = await opcUaClient.readNode(settings.liveNode);

          expect(typeof currentValue).toBe('number');
          expect(Number.isFinite(currentValue)).toBe(true);

          return currentValue;
        },
        {
          timeout: 5_000,
          intervals: [1_000],
        },
      )
      .not.toBe(firstValue);
  } finally {
    await opcUaClient.disconnect();
  }
});

test('should receive OPC UA data change notification', async () => {
  const opcUaClient = new OpcUaClient(settings.opcEndpoint);

  try {
    await opcUaClient.connect();

    let receivedValue: unknown;
    const values = new Set<unknown>();

    const subscription = await opcUaClient.subscribeToNode(settings.liveNode, (value) => {
      receivedValue = value;
      values.add(value);
      console.log(`Received StepUp notification: ${value}`);
    });

    await expect
      .poll(() => receivedValue, {
        timeout: 5_000,
        intervals: [250],
      })
      .toBeDefined();
    expect(typeof receivedValue).toBe('number');
    await expect.poll(() => values.size, { timeout: 10_000 }).toBeGreaterThan(1);
    expect(opcUaClient.subscriptionErrors).toEqual([]);
    expect([...values].every((value) => typeof value === 'number' && Number.isFinite(value))).toBe(
      true,
    );

    await subscription.terminate();
    expect(opcUaClient.activeSubscriptionCount).toBe(0);
  } finally {
    await opcUaClient.disconnect();
  }
});

test('should check writable OPC UA nodes', async () => {
  const opcUaClient = new OpcUaClient(settings.opcEndpoint);

  try {
    await opcUaClient.connect();

    const fastAccess = await opcUaClient.getNodeAccessLevel(settings.writableNode);

    const slowAccess = await opcUaClient.getNodeAccessLevel(settings.secondWritableNode);
    expect(fastAccess & 2).toBe(2);
    expect(slowAccess & 2).toBe(2);
  } finally {
    await opcUaClient.disconnect();
  }
});

test('should get OPC UA node data type', async () => {
  const opcUaClient = new OpcUaClient(settings.opcEndpoint);

  try {
    await opcUaClient.connect();

    const dataType = await opcUaClient.getNodeDataType(settings.writableNode);
    expect(dataType).toBe(settings.writableDataType);
  } finally {
    await opcUaClient.disconnect();
  }
});

test('should write and read back OPC UA node value', async () => {
  const opcUaClient = new OpcUaClient(settings.opcEndpoint);

  const nodeId = settings.writableNode;
  let newValue = 10;
  let oldValue: unknown;

  try {
    await opcUaClient.connect();

    oldValue = await opcUaClient.readNode(nodeId);
    expect(typeof oldValue).toBe('number');
    if (oldValue === newValue) newValue++;
    console.log(`Old value: ${oldValue}`);

    await opcUaClient.writeNode(nodeId, newValue);

    const actualValue = await opcUaClient.readNode(nodeId);
    console.log(`Written value: ${newValue}`);
    console.log(`Read back value: ${actualValue}`);

    expect(actualValue).toBe(newValue);
  } finally {
    try {
      if (typeof oldValue === 'number') {
        await opcUaClient.writeNode(nodeId, oldValue);
        expect(await opcUaClient.readNode(nodeId)).toBe(oldValue);
      }
    } finally {
      await opcUaClient.disconnect();
    }
  }
});

test('should handle OPC UA connection failure', async () => {
  const opcUaClient = new OpcUaClient(settings.opcInvalidEndpoint);

  try {
    await expect(opcUaClient.connect()).rejects.toThrow('Cannot connect');
  } finally {
    await opcUaClient.disconnect();
  }
});

test('should disconnect cleanly from OPC UA simulator', async () => {
  const opcUaClient = new OpcUaClient(settings.opcEndpoint);

  try {
    await opcUaClient.connect();
    expect(opcUaClient.isSessionActive()).toBe(true);
    await opcUaClient.subscribeToNode(settings.liveNode, () => undefined);
    expect(opcUaClient.activeSubscriptionCount).toBe(1);
    await opcUaClient.disconnect();
    expect(opcUaClient.isSessionActive()).toBe(false);
    expect(opcUaClient.activeSubscriptionCount).toBe(0);
    await expect(opcUaClient.readNode(settings.liveNode)).rejects.toThrow('session is not created');
  } finally {
    await opcUaClient.disconnect();
  }
});

test('should reject reading an unknown OPC UA node', async () => {
  const client = new OpcUaClient(settings.opcEndpoint);
  try {
    await client.connect();
    await expect(client.readNode('ns=3;s=MissingAutomationNode')).rejects.toThrow(
      'BadNodeIdUnknown',
    );
  } finally {
    await client.disconnect();
  }
});
