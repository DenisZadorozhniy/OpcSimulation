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

## Клиентский PKI

По умолчанию rootFolder: `<проект>/tmp/opcua-pki`.
Security-тесты используют отдельный `testInfo.outputPath(...)` для каждого сценария:
`client-pki`, `isolated-untrusted-pki`, `explicit-untrusted-pki`; discovery также имеет свой PKI.
Они не меняют доверие старых тестов и не зависят от предыдущих запусков.

- `own/certs/client_certificate.pem`: self-signed сертификат клиента, автоматически
  генерируемый node-opcua при первом подключении. Реальный путь доступен в `client.certificateFile`.
- `own/private/private_key.pem`: закрытый ключ клиента; не публиковать и не коммитить.
- `trusted/certs`: явно доверенные серверные сертификаты.
- `rejected`: неизвестные/недоверенные сертификаты после проверки.
- `issuers`: сертификаты издателей для цепочек; для данного self-signed стенда не используются.

`automaticallyAcceptUnknownCertificate` установлен в **false**, в том числе для
клиента None (на совместимость с TC3 это не повлияло). Доверие серверу устанавливается
через штатный `OPCUACertificateManager.trustCertificate()`, после чего
`checkCertificate()` снова проверяет сертификат. Криптографическая проверка не отключается.
Тест подтверждает BadCertificateUntrusted, наличие rejected, переход в trusted/certs
и последующий статус Good.

## Сервер и двустороннее доверие

В контейнере собственный публичный сертификат найден в
`/app/pki/own/certs/OpcPlc [2AC766BD04EB55C47B9ED83FDB59FFE37C77A122].der`.
Закрытый материал сервера находится в `/app/pki/own/private`.
`--autoaccept` позволяет серверу принять клиентский сертификат только в этом локальном
тестовом окружении. В ходе проверки отдельные файлы клиентских сертификатов
в `/app/pki/trusted` не обнаружены: наличие доверия на сервере подтверждается успешной
защищённой сессией, а не предположением о сохранённых файлах.

SHA-256 обнаруженного публичного сертификата:
`a1227a46c54ed2426ea477f2079eccde21bee1cefb9b01f7dcb9c8f98bf09d16`.
Он совпал с результатом `sha256sum /app/pki/own/certs/*` внутри контейнера.
Это отпечаток текущего стенда; после пересоздания контейнера он может измениться.
Каждый security-тест прикладывает фактически обнаруженный SHA-256 к отчёту.
Для промышленной среды требуется независимая проверка сертификата/CA и отказ от autoaccept;
автоматически доверять сертификату, полученному через discovery удалённого сервера, нельзя.

## Реальная ошибка доверия и особенности библиотеки

При свежем изолированном PKI и отсутствии serverCertificate в опциях попытка
SignAndEncrypt-подключения реально завершилась:
`server Certificate verification failed with err BadCertificateUntrusted (0x801a0000)`.
Сессия не создана, серверный сертификат появился в rejected, trusted/certs остался пустым.
Тест ограничен 15 секундами, повторные попытки подключения выключены (maxRetry=0).

Установленная библиотека выбрасывает обычный Error с текстом статуса и не переносит
StatusCode в объект ошибки. Поэтому небольшой наследник certificate manager сохраняет
реальный результат штатного `checkCertificate()`, не изменяя его решение. Wrapper возвращает
`OpcUaConnectionError` с `statusCode` и исходным `cause`. Тест сравнивает числовой
`StatusCodes.BadCertificateUntrusted.value`, а не произвольную строку.
Для ошибок транспорта без сертификатного результата `statusCode` отсутствует.

Во время разработки выявлено, что передача `serverCertificate` напрямую в OPCUAClient
может обойти встроенную проверку доверия этой версии: подключение с пустым trust store
оказалось успешным. Wrapper устраняет это отдельным вызовом штатной проверки перед connect;
пятый тест защищает именно этот путь от регрессии. Неизвестный сертификат не принимается.

## Автоматизированные проверки

Файл: `tests/security/opcUaSecurity.spec.ts`, проект Playwright `security`.

1. Explicit None/None: успешная сессия, реальный режим endpoint, отключение.
2. SignAndEncrypt/Basic256Sha256: rejected → явное trust → Good → сессия → чтение → отключение.
3. Реальный отказ неизвестному серверному сертификату в свежем PKI, типизированный статус,
   отсутствие сессии, rejected без trusted.
4. Старый конструктор без options и чтение живого узла.
5. Явно заданный serverCertificate не обходит проверку доверия.

11 октября 2026 года итоговый запуск security + существующий TC3: **13/13 прошли**
(5 новых и 8 прежних тестов), без skip и retries. Readiness, TypeScript, ESLint,
Prettier и сборка проверены. Предварительные запуски выявляли ошибки реализации
типизированного статуса и обход при serverCertificate; они исправлены, а не замаскированы.
Диагностика BadCertificateUntrusted в негативном тесте ожидаема и не подавляется.
Исходные сообщения BadNoSubscription при закрытии подписок TC3 также не подавлены.

CI создаёт второй контейнер на 50002, ожидает нужный endpoint и включает security в `npm test`.
PKI с закрытыми ключами исключён из загрузки CI-артефактов.
Workflow подготовлен локально, публикация и запуск на GitHub не выполнялись.
Известные падения внешних UI/API-наборов не исправляются и не скрываются этим модулем.
