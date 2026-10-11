import { Locator, Page } from '@playwright/test';

export class SearchPage {
  private readonly citySearchInput: Locator;
  private readonly londonSearchResult: Locator;

  constructor(page: Page) {
    this.citySearchInput = page.locator('#full-page-search-input');

    this.londonSearchResult = page
      .locator('#searchResults a')
      .filter({ hasText: /london; london, united kingdom/i })
      .first();
  }

  async searchCity(city: string): Promise<void> {
    await this.citySearchInput.fill('');
    await this.citySearchInput.pressSequentially(city);
  }

  async selectLondon(): Promise<void> {
    await this.londonSearchResult.click();
  }
}
