import { expect, Page } from '@playwright/test';
import { AirQualityMock, AqiScenario } from '../../src/mocks/AirQualityMock';
import { AirQualityPage } from '../../src/pages/AirQualityPage';
import { SearchPage } from '../../src/pages/SearchPage';

export class AirQualitySteps {
  private readonly airQuality: AirQualityPage;
  private readonly search: SearchPage;

  constructor(
    private readonly page: Page,
    private readonly mock: AirQualityMock,
  ) {
    this.airQuality = new AirQualityPage(page);
    this.search = new SearchPage(page);
  }

  async openLondonWithRealAqi(): Promise<void> {
    await this.airQuality.open();
    await this.airQuality.openCitySearch();
    await this.search.searchCity('London');
    await this.search.selectLondon();
    await this.expectLondon();
    await this.refreshAqi();
    await expect
      .poll(
        () => {
          this.mock.assertHealthy();
          return this.mock.lastRealValue;
        },
        {
          timeout: 25_000,
          message: 'The real AQI response must arrive within the HTTP interception deadline',
        },
      )
      .toBeDefined();
    await this.mock.waitForIdle();
    await this.expectAqi(this.mock.lastRealValue!);
  }

  async expectLondon(): Promise<void> {
    await this.airQuality.waitForLoaded();
    await expect.poll(() => this.airQuality.getUrl()).toMatch(/\/city\/london\/?/);
    await expect.poll(() => this.airQuality.getCityTitle()).toBe('London AQI');
    await expect.poll(() => this.airQuality.isAqiDisplayed()).toBe(true);
  }

  async expectAqi(value: number): Promise<void> {
    await expect.poll(() => this.airQuality.getAqiText()).toBe(String(value));
  }

  async readAqi(): Promise<number> {
    const text = await this.airQuality.getAqiText();
    if (!/^\d+(?:\.\d+)?$/.test(text)) throw new Error(`Invalid displayed AQI: ${text}`);
    return Number(text);
  }

  async refreshAqi(): Promise<void> {
    await this.page.waitForFunction(
      () =>
        typeof (window as unknown as { updateAqiWidgetAndForecast?: unknown })
          .updateAqiWidgetAndForecast === 'function',
    );
    await this.page.evaluate(() => {
      (
        window as unknown as { updateAqiWidgetAndForecast: (id: number) => void }
      ).updateAqiWidgetAndForecast(5724);
    });
  }

  async applyScenario(scenario: AqiScenario, value?: number): Promise<void> {
    const before = this.mock.requestCount;
    this.mock.setScenario(scenario, value);
    await this.mock.expectScenarioDelivered(() => this.refreshAqi());
    await expect.poll(() => this.mock.requestCount).toBeGreaterThan(before);
    this.mock.assertHealthy();
  }

  async expectStaleSignal(): Promise<void> {
    await expect
      .poll(() => this.airQuality.getUpdateTimeText())
      .toMatch(/Last Update|days ago|a week ago/i);
    await expect.poll(() => this.airQuality.getUpdateTimeText()).not.toMatch(/^Updated/);
  }

  async expectUnavailableSignal(): Promise<void> {
    await expect
      .poll(
        async () => {
          if (await this.airQuality.hasVisibleError()) return true;
          if (
            (await this.airQuality.isAqiStatusDisplayed()) &&
            /^(?:no data|data unavailable)$/i.test(await this.airQuality.getAqiStatusText())
          )
            return true;
          if (!(await this.airQuality.isAqiDisplayed())) return false;
          return /^(?:|-|—|n\/a|no data)$/i.test(await this.airQuality.getAqiText());
        },
        {
          message:
            'Lost/invalid telemetry must show an error or empty state, not a fresh-looking stale AQI',
          timeout: 10_000,
        },
      )
      .toBe(true);
  }
}
