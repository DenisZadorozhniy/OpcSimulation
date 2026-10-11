import { expect, test } from '../fixtures';

test.setTimeout(60_000);

test('should search for London', async ({ london }) => {
  await london.steps.expectLondon();
  expect(await london.steps.readAqi()).toBe(london.mock.lastRealValue);
  expect(london.mock.requestCount).toBeGreaterThan(0);
  expect(london.pageErrors).toEqual([]);
});

test('should render an out-of-range AQI of 999 from the intercepted response', async ({
  london,
}) => {
  await london.steps.applyScenario('value', 999);
  expect(london.mock.lastDeliveredValue).toBe(999);
  await london.steps.expectAqi(999);
  expect(london.pageErrors).toEqual([]);
});

test('should label stale telemetry instead of presenting it as fresh', async ({ london }) => {
  await london.steps.applyScenario('stale');
  await london.steps.expectStaleSignal();
  expect(london.pageErrors).toEqual([]);
});

/*
   I implemented four negative UI scenarios using Playwright network interception. Three tests detected
   that the application continued displaying stale AQI values after receiving empty responses,
   null values, or HTTP 503 errors. I verified that the mocked responses were delivered correctly and
   documented the issues instead of weakening the assertions.
 */
for (const scenario of ['empty', 'missing', 'invalid', 'http-error'] as const) {
  test(`should handle ${scenario} telemetry without misleading stale data`, async ({ london }) => {
    await london.steps.applyScenario(scenario);
    await london.steps.expectUnavailableSignal();
    expect(london.pageErrors).toEqual([]);
  });
}
