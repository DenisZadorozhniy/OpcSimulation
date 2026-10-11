import { Locator, Page } from '@playwright/test';

export class WeatherPage {
  readonly page: Page;
  readonly searchInput: Locator;
  readonly currentTemperature: Locator;
  readonly errorTitle: Locator;
  readonly errorMessage: Locator;
  readonly tryAgainButton: Locator;

  constructor(page: Page) {
    this.page = page;

    this.searchInput = page.getByPlaceholder('Search City');

    this.currentTemperature = page.locator(
      'div.font-normal.leading-none.text-white.text-\\[56px\\]',
    );

    this.errorTitle = page.getByRole('heading', {
      name: 'Something went wrong',
    });

    this.errorMessage = page.getByText('Unable to load weather');

    this.tryAgainButton = page.getByRole('button', {
      name: 'Please try again',
    });
  }

  async open(): Promise<void> {
    await this.page.goto('https://openweathermap.org/');
  }

  async searchCity(city: string): Promise<void> {
    await this.searchInput.fill(city);
    await this.searchInput.press('Enter');
  }
}
