import { expect } from '@playwright/test';

import { sentryTest } from '../../../utils/fixtures';
import {
  expectedClickBreadcrumb,
  expectedFCPPerformanceSpan,
  expectedFPPerformanceSpan,
  expectedLCPPerformanceSpan,
  expectedMemoryPerformanceSpan,
  expectedNavigationBreadcrumb,
  expectedNavigationPerformanceSpan,
  expectedNavigationPushPerformanceSpan,
  expectedReloadPerformanceSpan,
  getExpectedReplayEvent,
} from '../../../utils/replayEventTemplates';
import {
  getReplayEvent,
  getReplayRecordingContent,
  normalize,
  shouldSkipReplayTest,
  waitForReplayRequest,
} from '../../../utils/replayHelpers';

/*
This is a quite complex test with the goal to ensure correct recording across multiple pages,
navigations and page reloads. In particular, we want to check that all breadcrumbs, spans as
well as the correct DOM snapshots and updates are recorded and sent.
*/
sentryTest(
  'record page navigations and performance entries across multiple pages',
  async ({ getLocalTestPath, page, browserName }) => {
    // We only test this against the NPM package and replay bundles
    // and only on chromium as most performance entries are only available in chromium
    if (shouldSkipReplayTest() || browserName !== 'chromium') {
      sentryTest.skip();
    }

    await page.route('https://dsn.ingest.sentry.io/**/*', route => {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ id: 'test-id' }),
      });
    });

    const reqPromise0 = waitForReplayRequest(page, 0);
    const reqPromise1 = waitForReplayRequest(page, 1);

    const url = await getLocalTestPath({ testDir: __dirname });

    await page.goto(url);
    const replayEvent0 = getReplayEvent(await reqPromise0);
    const recording0 = getReplayRecordingContent(await reqPromise0);

    expect(replayEvent0).toEqual(getExpectedReplayEvent({ segment_id: 0 }));
    expect(normalize(recording0.fullSnapshots)).toMatchSnapshot('seg-0-snap-full');
    expect(recording0.incrementalSnapshots.length).toEqual(0);

    await page.click('#go-background');

    const replayEvent1 = getReplayEvent(await reqPromise1);
    const recording1 = getReplayRecordingContent(await reqPromise1);

    expect(replayEvent1).toEqual(
      getExpectedReplayEvent({ segment_id: 1, urls: [], replay_start_timestamp: undefined }),
    );
    expect(recording1.fullSnapshots.length).toEqual(0);
    expect(normalize(recording1.incrementalSnapshots)).toMatchSnapshot('seg-1-snap-incremental');

    // We can't guarantee the order of the performance spans, or in which of the two segments they are sent
    // So to avoid flakes, we collect them all and check that they are all there
    const collectedPerformanceSpans = [...recording0.performanceSpans, ...recording1.performanceSpans];
    const collectedBreadcrumbs = [...recording0.breadcrumbs, ...recording1.breadcrumbs];

    expect(collectedPerformanceSpans.length).toEqual(6);
    expect(collectedPerformanceSpans).toEqual(
      expect.arrayContaining([
        expectedNavigationPerformanceSpan,
        expectedLCPPerformanceSpan,
        expectedFPPerformanceSpan,
        expectedFCPPerformanceSpan,
        expectedMemoryPerformanceSpan, // two memory spans - once per flush
        expectedMemoryPerformanceSpan,
      ]),
    );

    expect(collectedBreadcrumbs).toEqual([expectedClickBreadcrumb]);

    // -----------------------------------------------------------------------------------------
    // Test page reload

    await page.reload();

    const reqPromise2 = waitForReplayRequest(page, 2);
    const reqPromise3 = waitForReplayRequest(page, 3);

    const replayEvent2 = getReplayEvent(await reqPromise2);
    const recording2 = getReplayRecordingContent(await reqPromise2);

    expect(replayEvent2).toEqual(getExpectedReplayEvent({ segment_id: 2, replay_start_timestamp: undefined }));
    expect(normalize(recording2.fullSnapshots)).toMatchSnapshot('seg-2-snap-full');
    expect(recording2.incrementalSnapshots.length).toEqual(0);

    await page.click('#go-background');

    const replayEvent3 = getReplayEvent(await reqPromise3);
    const recording3 = getReplayRecordingContent(await reqPromise3);

    expect(replayEvent3).toEqual(
      getExpectedReplayEvent({ segment_id: 3, urls: [], replay_start_timestamp: undefined }),
    );
    expect(recording3.fullSnapshots.length).toEqual(0);
    expect(normalize(recording3.incrementalSnapshots)).toMatchSnapshot('seg-3-snap-incremental');

    const collectedPerformanceSpansAfterReload = [...recording2.performanceSpans, ...recording3.performanceSpans];
    const collectedBreadcrumbsAdterReload = [...recording2.breadcrumbs, ...recording3.breadcrumbs];

    expect(collectedPerformanceSpansAfterReload.length).toEqual(6);
    expect(collectedPerformanceSpansAfterReload).toEqual(
      expect.arrayContaining([
        expectedReloadPerformanceSpan,
        expectedLCPPerformanceSpan,
        expectedFPPerformanceSpan,
        expectedFCPPerformanceSpan,
        expectedMemoryPerformanceSpan,
        expectedMemoryPerformanceSpan,
      ]),
    );

    expect(collectedBreadcrumbsAdterReload).toEqual([expectedClickBreadcrumb]);

    // -----------------------------------------------------------------------------------------
    // Test subsequent link navigation to another page

    await page.click('a');

    const reqPromise4 = waitForReplayRequest(page, 4);
    const reqPromise5 = waitForReplayRequest(page, 5);

    const replayEvent4 = getReplayEvent(await reqPromise4);
    const recording4 = getReplayRecordingContent(await reqPromise4);

    expect(replayEvent4).toEqual(
      getExpectedReplayEvent({
        segment_id: 4,
        replay_start_timestamp: undefined,
        // @ts-ignore this is fine
        urls: [expect.stringContaining('page-0.html')],
        request: {
          // @ts-ignore this is fine
          url: expect.stringContaining('page-0.html'),
          headers: {
            // @ts-ignore this is fine
            'User-Agent': expect.stringContaining(''),
          },
        },
      }),
    );
    expect(normalize(recording4.fullSnapshots)).toMatchSnapshot('seg-4-snap-full');
    expect(recording4.incrementalSnapshots.length).toEqual(0);

    await page.click('#go-background');

    const replayEvent5 = getReplayEvent(await reqPromise5);
    const recording5 = getReplayRecordingContent(await reqPromise5);

    expect(replayEvent5).toEqual(
      getExpectedReplayEvent({
        segment_id: 5,
        urls: [],
        replay_start_timestamp: undefined,
        request: {
          // @ts-ignore this is fine
          url: expect.stringContaining('page-0.html'),
          headers: {
            // @ts-ignore this is fine
            'User-Agent': expect.stringContaining(''),
          },
        },
      }),
    );
    expect(recording5.fullSnapshots.length).toEqual(0);
    expect(normalize(recording5.incrementalSnapshots)).toMatchSnapshot('seg-5-snap-incremental');

    const collectedPerformanceSpansAfterLinkNavigation = [
      ...recording4.performanceSpans,
      ...recording5.performanceSpans,
    ];
    const collectedBreadcrumbsAfterLinkNavigation = [...recording4.breadcrumbs, ...recording5.breadcrumbs];

    expect(collectedPerformanceSpansAfterLinkNavigation).toEqual(
      expect.arrayContaining([
        expectedNavigationPerformanceSpan,
        expectedLCPPerformanceSpan,
        expectedFPPerformanceSpan,
        expectedFCPPerformanceSpan,
        expectedMemoryPerformanceSpan,
        expectedMemoryPerformanceSpan,
      ]),
    );

    expect(collectedBreadcrumbsAfterLinkNavigation.length).toEqual(1);
    expect(collectedBreadcrumbsAfterLinkNavigation).toEqual([expectedClickBreadcrumb]);

    // -----------------------------------------------------------------------------------------
    // Test subsequent navigation without a page reload (i.e. SPA navigation)

    await page.click('#spa-navigation');

    const reqPromise6 = waitForReplayRequest(page, 6);
    const replayEvent6 = getReplayEvent(await reqPromise6);
    const recording6 = getReplayRecordingContent(await reqPromise6);

    expect(replayEvent6).toEqual(
      getExpectedReplayEvent({
        segment_id: 6,
        urls: ['/spa'],
        replay_start_timestamp: undefined,
        request: {
          // @ts-ignore this is fine
          url: expect.stringContaining('page-0.html'),
          headers: {
            // @ts-ignore this is fine
            'User-Agent': expect.stringContaining(''),
          },
        },
      }),
    );
    expect(recording6.fullSnapshots.length).toEqual(0);
    expect(normalize(recording6.incrementalSnapshots)).toMatchSnapshot('seg-6-snap-incremental');

    await page.click('#go-background');

    const reqPromise7 = waitForReplayRequest(page, 7);
    const replayEvent7 = getReplayEvent(await reqPromise7);
    const recording7 = getReplayRecordingContent(await reqPromise7);

    expect(replayEvent7).toEqual(
      getExpectedReplayEvent({
        segment_id: 7,
        urls: [],
        replay_start_timestamp: undefined,
        request: {
          // @ts-ignore this is fine
          url: expect.stringContaining('page-0.html'),
          headers: {
            // @ts-ignore this is fine
            'User-Agent': expect.stringContaining(''),
          },
        },
      }),
    );
    expect(recording7.fullSnapshots.length).toEqual(0);
    expect(normalize(recording7.incrementalSnapshots)).toMatchSnapshot('seg-7-snap-incremental');

    const collectedPerformanceSpansAfterSPANavigation = [
      ...recording6.performanceSpans,
      ...recording7.performanceSpans,
    ];
    const collectedBreadcrumbsAfterSPANavigation = [...recording6.breadcrumbs, ...recording7.breadcrumbs];

    expect(collectedPerformanceSpansAfterSPANavigation.length).toEqual(3);
    expect(collectedPerformanceSpansAfterSPANavigation).toEqual(
      expect.arrayContaining([
        expectedNavigationPushPerformanceSpan,
        expectedMemoryPerformanceSpan,
        expectedMemoryPerformanceSpan,
      ]),
    );

    expect(collectedBreadcrumbsAfterSPANavigation).toEqual([
      expectedClickBreadcrumb,
      expectedNavigationBreadcrumb,
      expectedClickBreadcrumb,
    ]);

    //   // -----------------------------------------------------------------------------------------
    //   // And just to finish this off, let's go back to the index page

    await page.click('a');

    const reqPromise8 = waitForReplayRequest(page, 8);
    const reqPromise9 = waitForReplayRequest(page, 9);

    const replayEvent8 = getReplayEvent(await reqPromise8);
    const recording8 = getReplayRecordingContent(await reqPromise8);

    expect(replayEvent8).toEqual(
      getExpectedReplayEvent({
        segment_id: 8,
        replay_start_timestamp: undefined,
      }),
    );
    expect(normalize(recording8.fullSnapshots)).toMatchSnapshot('seg-8-snap-full');
    expect(recording8.incrementalSnapshots.length).toEqual(0);

    await page.click('#go-background');

    const replayEvent9 = getReplayEvent(await reqPromise9);
    const recording9 = getReplayRecordingContent(await reqPromise9);

    expect(replayEvent9).toEqual(
      getExpectedReplayEvent({
        segment_id: 9,
        urls: [],
        replay_start_timestamp: undefined,
      }),
    );
    expect(recording9.fullSnapshots.length).toEqual(0);
    expect(normalize(recording9.incrementalSnapshots)).toMatchSnapshot('seg-9-snap-incremental');

    const collectedPerformanceSpansAfterIndexNavigation = [
      ...recording8.performanceSpans,
      ...recording9.performanceSpans,
    ];
    const collectedBreadcrumbsAfterIndexNavigation = [...recording8.breadcrumbs, ...recording9.breadcrumbs];

    expect(collectedPerformanceSpansAfterIndexNavigation.length).toEqual(6);
    expect(collectedPerformanceSpansAfterIndexNavigation).toEqual(
      expect.arrayContaining([
        expectedNavigationPerformanceSpan,
        expectedLCPPerformanceSpan,
        expectedFPPerformanceSpan,
        expectedFCPPerformanceSpan,
        expectedMemoryPerformanceSpan,
        expectedMemoryPerformanceSpan,
      ]),
    );

    expect(collectedBreadcrumbsAfterIndexNavigation).toEqual([expectedClickBreadcrumb]);
  },
);
