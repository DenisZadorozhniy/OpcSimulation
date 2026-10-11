import { Locator, Page } from '@playwright/test';
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

  async waitForLoaded(): Promise<void> {
    await this.page.waitForLoadState('domcontentloaded');
  }

  getUrl(): string {
    return this.page.url();
  }

  async getCityTitle(): Promise<string> {
    return (await this.cityTitle.innerText()).trim();
  }

  async getAqiText(): Promise<string> {
    return (await this.aqiValue.innerText()).trim();
  }

  async getUpdateTimeText(): Promise<string> {
    return (await this.updateTime.innerText()).trim();
  }

  async getAqiStatusText(): Promise<string> {
    return (await this.aqiStatus.innerText()).trim();
  }

  async isAqiDisplayed(): Promise<boolean> {
    return this.aqiValue.isVisible();
  }

  async isAqiStatusDisplayed(): Promise<boolean> {
    return this.aqiStatus.isVisible();
  }

  async hasVisibleError(): Promise<boolean> {
    const errors = await this.errorState.all();
    const visible = await Promise.all(errors.map((error) => error.isVisible()));
    return visible.some(Boolean);
  }
}
