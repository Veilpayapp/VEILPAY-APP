import { SCREENS } from '../../constants/screens';
import { getScreenTransition, transitionPresets } from '../transitions';

describe('navigation transitions', () => {
  it('returns modal transition for send payment', () => {
    const options = getScreenTransition(SCREENS.SEND_PAYMENT);

    expect(options.animation).toBe('slide_from_bottom');
    expect(options.presentation).toBe('containedTransparentModal');
    expect(options.gestureDirection).toBe('vertical');
  });

  it('returns transparent modal transition for token selector', () => {
    const options = getScreenTransition(SCREENS.TOKEN_SELECTOR);

    expect(options.animation).toBe('fade');
    expect(options.presentation).toBe('transparentModal');
  });

  it('falls back to push transition for unknown screens', () => {
    const fallback = getScreenTransition('UnknownScreen');

    expect(fallback).toMatchObject(transitionPresets.push);
  });
});
