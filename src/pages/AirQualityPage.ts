import { expect, Locator, Page } from '@playwright/test';
import { settings } from '../config';

export class AirQualityPage {
  private readonly page: Page;
  private readonly searchForYourCityMenuBtn: Locator;
  private readonly aqiValue: Locator;
  private readonly cityTitle: Locator;
  private readonly updateTime: Locator;
  private readonly aqiStatus: Locator;
  private readonly errorState: Locator;

  constructor(page: Page) {
    this.page = page;
    this.searchForYourCityMenuBtn = page.locator('#city7');
    this.aqiValue = page.locator('#citydivmain #aqiwgtvalue');
    this.cityTitle = page.locator('#citydivmain #aqiwgttitle1');
    this.updateTime = page.locator('#citydivmain #aqiwgtutime');
    this.aqiStatus = page.locator('#citydivmain #aqiwgtinfo');
    this.errorState = page
      .locator('#citydivmain .ui.error, #citydivmain [role="alert"]')
      .or(
        page
          .locator('#citydivmain')
          .getByText(
            /^(?:Data unavailable|Unable to load.*|Failed to load.*|An error occurred.*|Please try again.*)$/i,
          ),
      );
  }

  async open(): Promise<void> {
    await this.page.goto(`${settings.uiBaseUrl}/`, {
      waitUntil: 'domcontentloaded',
    });
  }

  async openCitySearch(): Promise<void> {
    await this.searchForYourCityMenuBtn.click();
  }

  async expectLondon(): Promise<void> {
    await this.page.waitForLoadState('domcontentloaded');
    await expect(this.page).toHaveURL(/\/city\/london\/?/);
    await expect(this.cityTitle).toHaveText('London AQI');
    await expect(this.aqiValue).toBeVisible();
  }

  async expectAqi(value: number): Promise<void> {
    await expect(this.aqiValue).toHaveText(String(value));
  }

  async readAqi(): Promise<number> {
    const text = (await this.aqiValue.innerText()).trim();
    if (!/^\d+(?:\.\d+)?$/.test(text)) throw new Error(`Invalid displayed AQI: ${text}`);
    return Number(text);
  }

  async refreshAqi(): Promise<void> {
    await this.page.waitForFunction(
      () =>
        typeof (window as unknown as { updateAqiWidgetAndForecast?: unknown })
          .updateAqiWidgetAndForecast === 'function',
    );
    // Invoke the site's own updater; it sends the real HTTP request and renders its response.
    await this.page.evaluate(() => {
      (
        window as unknown as { updateAqiWidgetAndForecast: (id: number) => void }
      ).updateAqiWidgetAndForecast(5724);
    });
  }

  async expectStaleSignal(): Promise<void> {
    await expect(this.updateTime).toContainText(/Last Update|days ago|a week ago/i);
    await expect(this.updateTime).not.toContainText(/^Updated/);
  }

  async expectUnavailableSignal(): Promise<void> {
    // Retaining a fresh-looking numeric value without an error is a real site defect.
    await expect
      .poll(
        async () => {
          const errors = await this.errorState.all();
          const visibleErrors = await Promise.all(errors.map((error) => error.isVisible()));
          if (visibleErrors.some(Boolean)) return true;
          if (
            (await this.aqiStatus.isVisible()) &&
            /^(?:no data|data unavailable)$/i.test((await this.aqiStatus.innerText()).trim())
          ) {
            return true;
          }
          if (!(await this.aqiValue.isVisible())) return false;
          const value = (await this.aqiValue.innerText()).trim();
          return /^(?:|-|—|n\/a|no data)$/i.test(value);
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
