/**
 * PRIV-001: analytics consent gate + DSAR local erase.
 */

import {
  deleteAnalyticsData,
  setAnalyticsConsent,
  trackEvent,
} from '../analytics';
import { ANALYTICS_EVENTS } from '../analyticsEvents';

const mockTrack = jest.fn();
const mockReset = jest.fn();
const mockOptOut = jest.fn();
const mockOptIn = jest.fn();

jest.mock('mixpanel-react-native', () => ({
  Mixpanel: jest.fn().mockImplementation(() => ({
    init: jest.fn(async () => undefined),
    track: mockTrack,
    reset: mockReset,
    optOutTracking: mockOptOut,
    optInTracking: mockOptIn,
    identify: jest.fn(),
    getPeople: () => ({ set: jest.fn() }),
  })),
}));

describe('analytics PRIV-001', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setAnalyticsConsent(false);
  });

  it('does not track when consent is off', () => {
    trackEvent(ANALYTICS_EVENTS.SCREEN_VIEW, { screen_name: 'Home' });
    expect(mockTrack).not.toHaveBeenCalled();
  });

  it('deleteAnalyticsData leaves tracking disabled', () => {
    setAnalyticsConsent(true);
    deleteAnalyticsData();
    trackEvent(ANALYTICS_EVENTS.SCREEN_VIEW, { screen_name: 'Home' });
    expect(mockTrack).not.toHaveBeenCalled();
  });
});
