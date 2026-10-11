import { hostname } from 'node:os';
import { resolve } from 'node:path';
import {
  AttributeIds,
  ClientSession,
  ClientSubscription,
  DataType,
  EndpointDescription,
  MessageSecurityMode,
  NodeId,
  OPCUAClient,
  OPCUACertificateManager,
  SecurityPolicy,
  StatusCode,
  StatusCodeCallback,
  TimestampsToReturn,
  Variant,
} from 'node-opcua';

class CheckedCertificateManager extends OPCUACertificateManager {
  lastStatus?: StatusCode;

  resetStatus(): void {
    this.lastStatus = undefined;
  }

  override checkCertificate(certificate: Buffer | Buffer[]): Promise<StatusCode>;
  override checkCertificate(certificate: Buffer | Buffer[], callback: StatusCodeCallback): void;
  override checkCertificate(
    certificate: Buffer | Buffer[],
    callback?: StatusCodeCallback,
  ): Promise<StatusCode> | void {
    const result = super.checkCertificate(certificate).then((status) => {
      this.lastStatus = status;
      return status;
    });
    if (callback) {
      void result.then(
        (status) => callback(null, status),
        (error: Error) => callback(error),
      );
    } else {
      return result;
    }
  }
}

export class OpcUaError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'OpcUaError';
  }
}

export interface OpcNodeReference {
  name: string;
  nodeId: string;
}

export interface OpcUaClientOptions {
  securityMode?: MessageSecurityMode;
  securityPolicy?: SecurityPolicy;
  pkiRoot?: string;
  serverCertificate?: Buffer;
}

export class OpcUaConnectionError extends OpcUaError {
  constructor(
    message: string,
    readonly statusCode: StatusCode | undefined,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'OpcUaConnectionError';
  }
}

export class OpcUaClient {
  private readonly client: OPCUAClient;
  private session?: ClientSession;
  private readonly subscriptions = new Set<ClientSubscription>();
  private readonly notificationErrors: Error[] = [];
  private readonly certificateManager: CheckedCertificateManager;

  constructor(
    private readonly endpointUrl: string,
    options: OpcUaClientOptions = {},
  ) {
    const securityMode = options.securityMode ?? MessageSecurityMode.None;
    const securityPolicy = options.securityPolicy ?? SecurityPolicy.None;
    if ((securityMode === MessageSecurityMode.None) !== (securityPolicy === SecurityPolicy.None)) {
      throw new OpcUaError('Security mode and policy must both be None or both be secured');
    }
    this.certificateManager = new CheckedCertificateManager({
      rootFolder: resolve(options.pkiRoot ?? 'tmp/opcua-pki'),
      automaticallyAcceptUnknownCertificate: false,
    });
    this.client = OPCUAClient.create({
      applicationName: 'HardwareAutomationTests',
      applicationUri: `urn:${hostname()}:HardwareAutomationTests`,
      clientCertificateManager: this.certificateManager,
      connectionStrategy: { initialDelay: 250, maxRetry: 0 },
      transportTimeout: 5_000,
      securityMode,
      securityPolicy,
      serverCertificate: options.serverCertificate,
      endpointMustExist: false,
      keepSessionAlive: false,
    });
  }

  get certificateFile(): string {
    return this.client.certificateFile;
  }

  get pkiRoot(): string {
    return this.certificateManager.rootDir;
  }

  get negotiatedSecurity(): { mode: MessageSecurityMode; policy: SecurityPolicy } {
    const endpoint = this.requireSession().endpoint;
    return { mode: endpoint.securityMode, policy: endpoint.securityPolicyUri as SecurityPolicy };
  }

  async checkServerCertificate(certificate: Buffer): Promise<StatusCode> {
    await this.certificateManager.initialize();
    return this.certificateManager.checkCertificate(certificate);
  }

  async trustServerCertificate(certificate: Buffer): Promise<void> {
    await this.certificateManager.initialize();
    await this.certificateManager.trustCertificate(certificate);
    const status = await this.certificateManager.checkCertificate(certificate);
    if (!status.isGood())
      throw new OpcUaConnectionError('Trusted certificate validation failed', status);
  }

  async discoverEndpoints(): Promise<EndpointDescription[]> {
    if (this.session) throw new OpcUaError('Discover endpoints before creating a session');
    try {
      await this.client.connect(this.endpointUrl);
      return await this.client.getEndpoints();
    } finally {
      await this.client.disconnect();
    }
  }

  isSessionActive(): boolean {
    return this.session !== undefined && !this.session.isReconnecting;
  }

  get activeSubscriptionCount(): number {
    return this.subscriptions.size;
  }
  get subscriptionErrors(): readonly Error[] {
    return this.notificationErrors;
  }

  async connect(): Promise<void> {
    if (this.session) throw new OpcUaError('OPC UA session already exists');
    this.certificateManager.resetStatus();
    try {
      if (this.client.serverCertificate && this.client.securityMode !== MessageSecurityMode.None) {
        await this.certificateManager.initialize();
        const status = await this.certificateManager.checkCertificate(
          this.client.serverCertificate,
        );
        if (!status.isGood()) {
          throw new OpcUaConnectionError('Server certificate validation failed', status);
        }
      }
      await this.client.connect(this.endpointUrl);
      this.session = await this.client.createSession();
    } catch (cause) {
      const verdict = this.certificateManager.lastStatus;
      const statusCode = verdict && !verdict.isGood() ? verdict : undefined;
      await this.client.disconnect().catch(() => undefined);
      throw new OpcUaConnectionError(`Cannot connect to ${this.endpointUrl}`, statusCode, {
        cause,
      });
    }
  }

  async disconnect(): Promise<void> {
    const failures: unknown[] = [];
    for (const subscription of [...this.subscriptions]) {
      try {
        await subscription.terminate();
      } catch (error) {
        failures.push(error);
      }
    }
    const session = this.session;
    this.session = undefined;
    try {
      if (session) await session.close(true);
    } catch (error) {
      failures.push(error);
    } finally {
      try {
        await this.client.disconnect();
      } catch (error) {
        failures.push(error);
      }
    }
    this.subscriptions.clear();
    if (failures.length)
      throw new OpcUaError('OPC UA cleanup failed', { cause: new AggregateError(failures) });
  }

  async browse(nodeId = 'ObjectsFolder'): Promise<OpcNodeReference[]> {
    const result = await this.requireSession().browse(nodeId);
    if (!result.statusCode.isGood())
      throw new OpcUaError(`Cannot browse ${nodeId}: ${result.statusCode.toString()}`);
    const references = [...(result.references ?? [])];
    let continuationPoint = result.continuationPoint;
    while (continuationPoint?.length) {
      const next = await this.requireSession().browseNext(continuationPoint, false);
      if (!next.statusCode.isGood())
        throw new OpcUaError(`Browse continuation failed for ${nodeId}`);
      references.push(...(next.references ?? []));
      continuationPoint = next.continuationPoint;
    }
    return references.map((reference) => ({
      name: reference.browseName.toString(),
      nodeId: reference.nodeId.toString(),
    }));
  }

  async readNode(nodeId: string): Promise<unknown> {
    return this.readAttribute(nodeId, AttributeIds.Value);
  }

  async subscribeToNode(
    nodeId: string,
    onValueChanged: (value: unknown) => void,
  ): Promise<ClientSubscription> {
    const subscription = await this.requireSession().createSubscription2({
      requestedPublishingInterval: 250,
      requestedLifetimeCount: 100,
      requestedMaxKeepAliveCount: 10,
      maxNotificationsPerPublish: 10,
      publishingEnabled: true,
      priority: 10,
    });
    this.subscriptions.add(subscription);
    subscription.on('terminated', () => this.subscriptions.delete(subscription));
    subscription.on('error', (error) =>
      this.notificationErrors.push(new OpcUaError(String(error))),
    );
    try {
      const monitoredItem = await subscription.monitor(
        { nodeId, attributeId: AttributeIds.Value },
        { samplingInterval: 100, discardOldest: true, queueSize: 10 },
        TimestampsToReturn.Both,
      );
      monitoredItem.on('err', (error) =>
        this.notificationErrors.push(new OpcUaError(String(error))),
      );
      monitoredItem.on('changed', (dataValue) => {
        if (!dataValue.statusCode.isGood()) {
          this.notificationErrors.push(
            new OpcUaError(`Bad notification: ${dataValue.statusCode.toString()}`),
          );
          return;
        }
        try {
          onValueChanged(dataValue.value.value as unknown);
        } catch (cause) {
          this.notificationErrors.push(new OpcUaError('Notification callback failed', { cause }));
        }
      });
      return subscription;
    } catch (cause) {
      await subscription.terminate();
      throw new OpcUaError(`Cannot monitor ${nodeId}`, { cause });
    }
  }

  async getNodeAccessLevel(nodeId: string): Promise<number> {
    const value = await this.readAttribute(nodeId, AttributeIds.UserAccessLevel);
    if (typeof value !== 'number') throw new OpcUaError(`Invalid access level for ${nodeId}`);
    return value;
  }

  async getNodeDataType(nodeId: string): Promise<string> {
    const value = await this.readAttribute(nodeId, AttributeIds.DataType);
    if (!(value instanceof NodeId)) throw new OpcUaError(`Invalid data type for ${nodeId}`);
    return value.toString();
  }

  async writeNode(
    nodeId: string,
    value: number,
    dataType: DataType = DataType.Int32,
  ): Promise<void> {
    if (!Number.isFinite(value)) throw new OpcUaError('Written value must be finite');
    const statusCode = await this.requireSession().write({
      nodeId,
      attributeId: AttributeIds.Value,
      value: { value: new Variant({ dataType, value }) },
    });
    if (!statusCode.isGood())
      throw new OpcUaError(`Failed to write ${nodeId}: ${statusCode.toString()}`);
  }

  private requireSession(): ClientSession {
    if (!this.session) throw new OpcUaError('OPC UA session is not created');
    return this.session;
  }

  private async readAttribute(nodeId: string, attributeId: AttributeIds): Promise<unknown> {
    const result = await this.requireSession().read({ nodeId, attributeId });
    if (!result.statusCode.isGood())
      throw new OpcUaError(
        `Cannot read ${nodeId} attribute ${attributeId}: ${result.statusCode.toString()}`,
      );
    return result.value.value as unknown;
  }
}
