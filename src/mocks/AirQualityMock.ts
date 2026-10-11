import { expect, Page, Route } from '@playwright/test';
import { AqiResponse, getAqiMessage } from './AqiResponse';

export const londonFeedPattern =
  /^https:\/\/api2\.waqi\.info\/api\/feed\/@5724\/aqi\.json(?:\?.*)?$/;
export type AqiScenario =
  'real' | 'value' | 'empty' | 'missing' | 'invalid' | 'http-error' | 'stale';

export class AirQualityMock {
  private scenario: AqiScenario = 'real';
  private value?: number;
  private generation = Math.floor(Date.now() / 1000);
  private payload?: AqiResponse;
  private failure?: Error;
  private readonly measurements: number[] = [];
  private readonly injected: (number | string | null)[] = [];
  private handled = 0;
  private pending = 0;

  constructor(private readonly page: Page) {}

  get requestCount(): number {
    return this.handled;
  }
  get lastRealValue(): number | undefined {
    return this.measurements.at(-1);
  }
  get lastDeliveredValue(): number | string | null | undefined {
    return this.injected.at(-1);
  }

  setScenario(scenario: AqiScenario, value?: number): void {
    if (scenario === 'value' && (value === undefined || !Number.isFinite(value))) {
      throw new Error('Injected AQI must be finite');
    }
    this.scenario = scenario;
    this.value = value;
  }

  assertHealthy(): void {
    if (this.failure) throw this.failure;
  }

  async install(): Promise<void> {
    await this.page.route(londonFeedPattern, async (route) => {
      this.pending++;
      try {
        await this.handle(route);
      } catch (cause) {
        this.failure = new Error('AQI interception failed', { cause });
        await route.abort('failed').catch(() => undefined);
      } finally {
        this.pending--;
      }
    });
  }

  async waitForIdle(): Promise<void> {
    await expect
      .poll(
        () => {
          this.assertHealthy();
          return this.pending;
        },
        { timeout: 25_000, message: 'All AQI responses must complete before switching scenarios' },
      )
      .toBe(0);
  }

  async expectScenarioDelivered(refresh: () => Promise<void>): Promise<void> {
    const scenario = this.scenario;
    const received = this.page.waitForResponse(
      (response) =>
        londonFeedPattern.test(response.url()) && response.request().method() === 'POST',
    );
    await refresh();
    const response = await received;
    expect(await response.finished()).toBeNull();
    expect(response.fromServiceWorker()).toBe(false);
    expect(response.status()).toBe(scenario === 'http-error' ? 503 : 200);
    const body = await response.json();
    if (scenario === 'empty') expect(body).toEqual({});
    else if (scenario === 'http-error') expect(body).toEqual({ error: 'Telemetry unavailable' });
    else if (scenario === 'missing' || scenario === 'invalid') {
      const entry = (body as AqiResponse).rxs.obs.find((item) => item.status === 'ok');
      expect(entry?.msg?.aqi).toBe(scenario === 'missing' ? null : 'invalid-sensor-value');
    }
    await this.waitForIdle();
    this.assertHealthy();
  }

  async dispose(): Promise<void> {
    await this.page.unroute(londonFeedPattern);
  }

  private async handle(route: Route): Promise<void> {
    if (route.request().method() !== 'POST')
      throw new Error('London AQI request is no longer POST');
    const scenario = this.scenario;
    const injectedValue = this.value;
    if (scenario === 'http-error') {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        json: { error: 'Telemetry unavailable' },
      });
    } else if (scenario === 'empty') {
      await route.fulfill({ status: 200, contentType: 'application/json', json: {} });
    } else {
      if (scenario === 'real' || !this.payload) {
        const response = await route.fetch({ timeout: 20_000 });
        if (!response.ok()) throw new Error(`Live AQI HTTP ${response.status()}`);
        const payload: unknown = await response.json();
        const msg = getAqiMessage(payload);
        this.measurements.push(msg.aqi as number);
        this.payload = payload as AqiResponse;
      }
      const payload = structuredClone(this.payload!);
      const msg = getAqiMessage(payload);
      // The site ignores updates older than its server-rendered HTML cache.
      // Advance only the version metadata; the baseline AQI remains the real response value.
      this.generation = Math.max(this.generation, msg.xsync.gen) + 1;
      msg.xsync.gen = this.generation;
      if (scenario === 'value') msg.aqi = injectedValue!;
      if (scenario === 'missing') msg.aqi = null;
      if (scenario === 'invalid') msg.aqi = 'invalid-sensor-value';
      if (scenario === 'stale') {
        msg.time.v = Math.floor(Date.now() / 1000) - 7 * 24 * 60 * 60;
        msg.time.iso = new Date(msg.time.v * 1000).toISOString();
        msg.time.s = msg.time.iso.slice(0, 19).replace('T', ' ');
      }
      this.injected.push(msg.aqi);
      await route.fulfill({ status: 200, contentType: 'application/json', json: payload });
    }
    this.handled++;
  }
}
