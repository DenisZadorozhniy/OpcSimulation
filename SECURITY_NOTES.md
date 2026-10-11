# OPC UA Security & Certificates

Модуль реализован в существующем `OpcUaClient` по дополнительному PDF.
Использована установленная `node-opcua 2.186.12`; зависимости не обновлялись.

## Стенды и запуск

Исходный `opcplc` на `opc.tcp://localhost:50000` оставлен без изменений.
Он используется для None/None и регрессии TC3. Для security создан отдельный
`opcplc-security` с отдельными портами и собственным сертификатом:

```sh
docker run -d --name opcplc-security -p 50002:50002 -p 8082:8080 mcr.microsoft.com/iotedge/opc-plc:latest --pn=50002 --autoaccept --sn=5 --sr=10 --fn=5 --fr=1
npm run build
node out-tsc/scripts/waitForOpcUaSecurity.js
npm run test:security
npx playwright test --project=security --project=opcua
```

Перед запуском проверьте `docker ps -a`: повторная команда с тем же именем контейнера
не нужна. В этой сессии контейнер оставлен работающим для последующих запусков.
Нет `--unsecuretransport`; `--autoaccept` относится только к серверному доверию клиентам.
Endpoint SignAndEncrypt/Basic256Sha256 подтверждён через GetEndpoints и активную сессию.
Другие контейнеры, volumes и данные не изменялись.

Настройка адреса: `OPC_UA_SECURITY_ENDPOINT`, по умолчанию `opc.tcp://localhost:50002`.
Тестовый bootstrap доверия разрешён только для localhost/127.0.0.1/::1.
Discovery идёт по незащищённому каналу без создания пользовательской сессии;
это получение публичного сертификата, а не подтверждение личности удалённого сервера.

## API существующего клиента

```typescript
const client = new OpcUaClient(endpoint, {
  securityMode: MessageSecurityMode.SignAndEncrypt,
  securityPolicy: SecurityPolicy.Basic256Sha256,
  pkiRoot: 'tmp/my-security-pki',
});
await client.trustServerCertificate(serverCertificate);
try {
  await client.connect();
  await client.readNode('ns=3;s=StepUp');
} finally {
  await client.disconnect();
}
```

`serverCertificate` в примере должен быть предварительно получен и проверен владельцем
сервера. В локальных тестах используется сертификат собственного Docker-симулятора.
Пример не является безопасным bootstrap для произвольного удалённого endpoint.

Конструктор без второго аргумента сохраняет None/None. Несогласованная пара
None/защищённая политика отклоняется. Также доступны `discoverEndpoints()`,
`checkServerCertificate()`, `trustServerCertificate()`, `certificateFile`, `pkiRoot`
и `negotiatedSecurity` (последнее читает endpoint реально созданной сессии).
Опциональный `serverCertificate` позволяет задать известный сертификат; он не включает
доверие и обязательно проверяется перед подключением.

## Автоматизированные проверки

Файл: `tests/security/opcUaSecurity.spec.ts`, проект Playwright `security`.

1. Explicit None/None: успешная сессия, реальный режим endpoint, отключение.
2. SignAndEncrypt/Basic256Sha256: rejected → явное trust → Good → сессия → чтение → отключение.
3. Реальный отказ неизвестному серверному сертификату в свежем PKI, типизированный статус,
   отсутствие сессии, rejected без trusted.
4. Старый конструктор без options и чтение живого узла.
5. Явно заданный serverCertificate не обходит проверку доверия.
