# OpcSimulation

Автоматизация на TypeScript и Playwright по `TASK_REQUIREMENTS.pdf.pdf`:
aqicn.org, REST-жизненный цикл устройств, OPC UA и интеграционный поток OPC UA → API → UI.

## Подготовка

Требуются Node.js 24, npm, доступ к интернету и OPC UA симулятор.

```sh
npm ci
npx playwright install chromium
```

Для нового стенда запустите Microsoft OPC PLC в Docker:

```sh
docker run --rm -p 50000:50000 -p 8080:8080 --name opcplc mcr.microsoft.com/iotedge/opc-plc:latest --pn=50000 --autoaccept --unsecuretransport --sn=5 --sr=10 --fn=5 --fr=1
```

Если сервер уже работает на порту 50000, используйте его без запуска второго контейнера.
Описание образа: [официальный репозиторий OPC PLC](https://github.com/Azure-Samples/iot-edge-opc-plc).

```sh
npm run build
node out-tsc/scripts/waitForOpcUa.js
```

## Проверки

```sh
npm run typecheck
npm run build
npm run lint
npm run format:check
npm test
```

Отдельные наборы: `npm run test:api`, `npm run test:opcua`,
`npm run test:browser`, `npm run test:integration`.
UI-тесты локально открывают видимый Chrome, в том числе при запуске из WebStorm.
Для их запуска выполните `npm run test:browser`. В CI они работают без окна браузера.
Выбор браузера можно изменить через `PLAYWRIGHT_CHANNEL`.
Дополнительные локальные проверки API-клиента: `npx playwright test --project=clients`.
Они используют временный HTTP-сервер и не заменяют проверки публичного API.
`npm run test:ui` открывает интерфейс Playwright, `npm run test:headed` показывает браузер.
`npm run format` применяет форматирование.

Для установленного Chrome без загрузки Chromium в PowerShell:

```powershell
$env:PLAYWRIGHT_CHANNEL = 'chrome'
npm test
```

HTML-отчёт: `playwright-report/index.html`; JSON: `test-results/results.json`.
Для упавших браузерных тестов сохраняются скриншот и trace.
Не коммитьте результаты: traces могут содержать данные запросов к публичным сервисам.

## Настройки окружения

| Переменная                    | Значение по умолчанию              |
| ----------------------------- | ---------------------------------- |
| `API_BASE_URL`                | `https://api.restful-api.dev`      |
| `UI_BASE_URL`                 | `https://aqicn.org`                |
| `PLAYWRIGHT_CHANNEL`          | Chromium, установленный Playwright |
| `OPC_UA_ENDPOINT`             | `opc.tcp://localhost:50000`        |
| `OPC_UA_INVALID_ENDPOINT`     | `opc.tcp://localhost:59999`        |
| `OPC_UA_LIVE_NODE`            | `ns=3;s=StepUp`                    |
| `OPC_UA_LIVE_DATA_TYPE`       | `ns=0;i=7` — UInt32                |
| `OPC_UA_WRITABLE_NODE`        | `ns=3;s=FastNumberOfUpdates`       |
| `OPC_UA_SECOND_WRITABLE_NODE` | `ns=3;s=SlowNumberOfUpdates`       |
| `OPC_UA_WRITABLE_DATA_TYPE`   | `ns=0;i=6` — Int32                 |

Переменные читаются из окружения процесса; автоматической загрузки `.env` нет.
Узлы записи должны иметь тип Int32. Отрицательный endpoint должен действительно быть недоступен.

## Структура

- `src/api`: общий HTTP-клиент и типизированные методы устройств с правилами переходов.
- `src/opcua`: клиент соединений, browse, чтения, подписок и записи.
- `src/pages`: Page Objects; приватные локаторы, навигация, клики, чтение текста и видимость.
- `tests/steps`: `AirQualitySteps`; сценарии UI, assertions и координация перехвата AQI.
- `src/mocks`: перехват реального JSON AQI London и проверка структуры ответа.
- `tests/fixtures.ts`: подготовка London и очистка собственных API-объектов.
- `tests/api`, `tests/opcua`, `tests/ui`, `tests/integration`: четыре набора тестов.
- `.github/workflows/tests.yml`: зависимости, статические проверки, Docker, все тесты, артефакты.

Тесты выполняются одним worker: симулятор имеет общее изменяемое состояние.

UI-тесты и UI-часть integration обращаются к `london.steps`. Page Objects не содержат
`expect`, HTTP-вызовов или логики подмены. Проверки используют `expect.poll` поверх
методов Page Objects; определения локаторов остаются внутри `src/pages`.
API-тесты изменяют только ID, созданные собственным POST; объекты 1–13 защищены.
Исходное значение записываемого OPC UA узла восстанавливается в `finally`.

Созданные API ID записываются в игнорируемый `tmp/device-receipts.json` и удаляются
из журнала после успешной очистки. Если API заблокировал DELETE лимитом запросов,
после восстановления доступа выполните:

```sh
npm run build
npm run cleanup:devices
```

Команда удаляет только записанные тестовые ID для текущего `API_BASE_URL`.
Не удаляйте журнал, пока в нём есть неочищенные объекты; не добавляйте чужие ID.

## Ограничения

Публичные сервисы могут измениться, вернуть CAPTCHA, ограничить запросы или быть недоступными.
Тесты не заменяют такие ситуации фиктивным успехом и не используют `waitForTimeout`.
Проверки обработки потерянных/некорректных данных намеренно проверяют требования задания:
если aqicn.org сохраняет старый AQI без предупреждения, они падают.
Подробности исследования сайта и результаты запусков приведены в `NOTES.md`.

## OPC UA Security

Модуль использует существующий `OpcUaClient`: поддерживаются None/None и
SignAndEncrypt/Basic256Sha256, отдельный PKI и явное доверие серверному сертификату.
Запуск security-тестов: `npm run test:security`.
Требуется отдельный симулятор на порту 50002 без `--unsecuretransport`.
Команда Docker, пути сертификатов и результаты проверок: [SECURITY_NOTES.md](SECURITY_NOTES.md).

Workflow создан локально; его запуск в GitHub требует публикации с отдельного разрешения.
