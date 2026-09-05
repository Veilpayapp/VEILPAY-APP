/**
 * PrivacyStatusBanner — force-ready state tests (device-free).
 *
 * The banner self-hides once statusDetail clears and readyStatus is 'ready'
 * (classifyBanner returns null), which made its visible state hard to verify
 * on-device. These tests drive the ready variant deterministically by passing
 * props directly. Jest does no layout, so "untruncated at 711px" can only be
 * proxy-tested (both text nodes render in a flex:1 column); the exact-width
 * proof needs a device screenshot.
 */
import React from 'react';
import { render } from '@testing-library/react-native';
import { PrivacyStatusBanner } from '../home/PrivacyStatusBanner';

describe('PrivacyStatusBanner', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('forces the ready variant visible: renders both lines', () => {
    const { getByText, queryByText } = render(
      <PrivacyStatusBanner
        readyStatus="ready"
        statusDetail="Sync ready"
        privacyMode
      />
    );

    // Ready classifier must match BEFORE the generic /sync/ branch, otherwise
    // this would render as an indeterminate spinner (the shipped-bundle bug).
    expect(getByText('Private XLM ready')).toBeTruthy();
    expect(getByText('Sync complete — private sends enabled')).toBeTruthy();
    expect(queryByText(/Syncing private balance/)).toBeNull();
  });

  it('self-hides when statusDetail clears and readyStatus is ready', () => {
    const { rerender, queryByText } = render(
      <PrivacyStatusBanner
        readyStatus="ready"
        statusDetail="Sync ready"
        privacyMode
      />
    );
    expect(queryByText('Private XLM ready')).not.toBeNull();

    rerender(
      <PrivacyStatusBanner readyStatus="ready" statusDetail={null} privacyMode />
    );
    expect(queryByText('Private XLM ready')).toBeNull();
  });

  it('asks the owner to clear transient ready copy after the fade window', () => {
    jest.useFakeTimers();
    const onDismiss = jest.fn();
    render(
      <PrivacyStatusBanner
        readyStatus="ready"
        statusDetail="Sync ready"
        privacyMode
        onDismiss={onDismiss}
      />
    );

    jest.advanceTimersByTime(2_499);
    expect(onDismiss).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('renders nothing when privacyMode is off', () => {
    const { queryByText } = render(
      <PrivacyStatusBanner readyStatus="ready" statusDetail="Sync ready" privacyMode={false} />
    );
    expect(queryByText('Private XLM ready')).toBeNull();
  });

  it('still classifies other variants before the generic sync branch', () => {
    const { getByText } = render(
      <PrivacyStatusBanner
        readyStatus="setting_up"
        statusDetail="ASP leaf ready"
        privacyMode
      />
    );
    expect(getByText('Registering privacy membership')).toBeTruthy();
  });

  it('does not contradict confirmed readiness after a transient balance-sync failure', () => {
    const { getByText, queryByText } = render(
      <PrivacyStatusBanner
        readyStatus="ready"
        statusDetail="sync: network error: connection aborted"
        privacyMode
      />
    );

    expect(getByText('Private XLM ready')).toBeTruthy();
    expect(getByText('Latest balance refresh was unavailable')).toBeTruthy();
    expect(queryByText('Sync unavailable')).toBeNull();
  });
});
