export const settings = {
  apiBaseUrl: process.env.API_BASE_URL ?? 'https://api.restful-api.dev',
  uiBaseUrl: process.env.UI_BASE_URL ?? 'https://aqicn.org',
  opcEndpoint: process.env.OPC_UA_ENDPOINT ?? 'opc.tcp://localhost:50000',
  opcSecurityEndpoint: process.env.OPC_UA_SECURITY_ENDPOINT ?? 'opc.tcp://localhost:50002',
  opcInvalidEndpoint: process.env.OPC_UA_INVALID_ENDPOINT ?? 'opc.tcp://localhost:59999',
  liveNode: process.env.OPC_UA_LIVE_NODE ?? 'ns=3;s=StepUp',
  writableNode: process.env.OPC_UA_WRITABLE_NODE ?? 'ns=3;s=FastNumberOfUpdates',
  secondWritableNode: process.env.OPC_UA_SECOND_WRITABLE_NODE ?? 'ns=3;s=SlowNumberOfUpdates',
  liveDataType: process.env.OPC_UA_LIVE_DATA_TYPE ?? 'ns=0;i=7',
  writableDataType: process.env.OPC_UA_WRITABLE_DATA_TYPE ?? 'ns=0;i=6',
};
