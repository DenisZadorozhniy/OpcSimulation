import { test as base, expect } from '@playwright/test';
import { DeviceApiClient } from '../src/api/DeviceApiClient';
import { AirQualityMock } from '../src/mocks/AirQualityMock';
import { AirQualitySteps } from './steps/AirQualitySteps';

type Fixtures = {
  deviceApi: DeviceApiClient;
  london: { steps: AirQualitySteps; mock: AirQualityMock; pageErrors: Error[] };
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
    const steps = new AirQualitySteps(page, mock);
    const pageErrors: Error[] = [];
    page.on('pageerror', (error) => pageErrors.push(error));
    await mock.install();
    try {
      await steps.openLondonWithRealAqi();
      await use({ steps, mock, pageErrors });
      mock.assertHealthy();
    } finally {
      await mock.dispose();
    }
  },
});

export { expect };
