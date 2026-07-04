import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { UpdatePromptModal } from '../UpdatePromptModal';

describe('UpdatePromptModal', () => {
  const setup = (props: Partial<React.ComponentProps<typeof UpdatePromptModal>> = {}) => {
    const onLater = jest.fn();
    const onUpdate = jest.fn();
    const utils = render(
      <UpdatePromptModal
        visible
        onLater={onLater}
        onUpdate={onUpdate}
        {...props}
      />,
    );
    return { onLater, onUpdate, ...utils };
  };

  it('renders the title and both actions when visible', () => {
    const { getByText } = setup();
    expect(getByText('Update Available')).toBeTruthy();
    expect(getByText('LATER')).toBeTruthy();
    expect(getByText('UPDATE NOW')).toBeTruthy();
  });

  it('does not render content when not visible', () => {
    const { queryByText } = setup({ visible: false });
    expect(queryByText('Update Available')).toBeNull();
  });

  it('fires onUpdate when "Update now" is pressed', () => {
    const { getByText, onUpdate } = setup();
    fireEvent.press(getByText('UPDATE NOW'));
    expect(onUpdate).toHaveBeenCalledTimes(1);
  });

  it('fires onLater when "Later" is pressed', () => {
    const { getByText, onLater } = setup();
    fireEvent.press(getByText('LATER'));
    expect(onLater).toHaveBeenCalledTimes(1);
  });

  it('shows a downloading state and blocks both actions while downloading', () => {
    const { getByText, queryByText, onLater, onUpdate } = setup({ isDownloading: true });

    // Label swaps to the in-progress copy...
    expect(getByText('UPDATING…')).toBeTruthy();
    expect(queryByText('UPDATE NOW')).toBeNull();

    // ...and the buttons are disabled, so presses are swallowed.
    fireEvent.press(getByText('UPDATING…'));
    fireEvent.press(getByText('LATER'));
    expect(onUpdate).not.toHaveBeenCalled();
    expect(onLater).not.toHaveBeenCalled();
  });

  it('renders an error message when one is provided', () => {
    const { getByText } = setup({ error: 'Failed to download update' });
    expect(getByText('Failed to download update')).toBeTruthy();
  });
});
