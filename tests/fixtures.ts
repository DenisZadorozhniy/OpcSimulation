import { test as base, expect } from '@playwright/test';
import { DeviceApiClient } from '../src/api/DeviceApiClient';
import { AirQualityMock } from '../src/mocks/AirQualityMock';
import { AirQualityPage } from '../src/pages/AirQualityPage';
import { SearchPage } from '../src/pages/SearchPage';

type Fixtures = {
  deviceApi: DeviceApiClient;
  london: { airQuality: AirQualityPage; mock: AirQualityMock; pageErrors: Error[] };
};

export const test = base.extend<Fixtures>({
  deviceApi: async ({ request }, use) => {
    const api = new DeviceApiClient(request);
    try {
      await use(api);
    } finally {
      await api.cleanup();
    }
  },
  london: async ({ page }, use) => {
    const mock = new AirQualityMock(page);
    const airQuality = new AirQualityPage(page);
    const search = new SearchPage(page);
    const pageErrors: Error[] = [];
    page.on('pageerror', (error) => pageErrors.push(error));
    await mock.install();
    try {
      await airQuality.open();
      await airQuality.openCitySearch();
      await search.searchCity('London');
      await search.selectLondon();
      await airQuality.expectLondon();
      await airQuality.refreshAqi();
      await expect
        .poll(
          () => {
            mock.assertHealthy();
            return mock.lastRealValue;
          },
          {
            timeout: 25_000,
            message: 'The real AQI response must arrive within the HTTP interception deadline',
          },
        )
        .toBeDefined();
      await mock.waitForIdle();
      await airQuality.expectAqi(mock.lastRealValue!);
      await use({ airQuality, mock, pageErrors });
      mock.assertHealthy();
    } finally {
      await mock.dispose();
    }
  },
});

export { expect };
