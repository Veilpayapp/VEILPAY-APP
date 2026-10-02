import React from 'react';
import { Alert } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { AddCustomNetworkScreen } from '../AddCustomNetworkScreen';
import { NavigationContainer } from '@react-navigation/native';

const mockAddCustomChain = jest.fn();
const mockAllChains = jest.fn(() => [] as any[]);

jest.mock('../../stores/walletStore', () => ({
  // Lazily reference the mock fns: the factory runs at module-require time,
  // before the consts above are initialised.
  useWalletStore: Object.assign(
    (selector?: any) => {
      const state = { addCustomChain: mockAddCustomChain, allChains: mockAllChains };
      return typeof selector === 'function' ? selector(state) : state;
    },
    { getState: () => ({ addCustomChain: mockAddCustomChain, allChains: mockAllChains }) }
  ),
}));

describe('AddCustomNetworkScreen', () => {
  const renderScreen = () => {
    const navigation = { goBack: jest.fn(), navigate: jest.fn() };
    const screen = render(
      <NavigationContainer>
        <AddCustomNetworkScreen {...({ navigation, route: { params: {} } } as any)} />
      </NavigationContainer>
    );
    return { ...screen, navigation };
  };

  const fillForm = (
    screen: ReturnType<typeof renderScreen>,
    over: { name?: string; chainId?: string; rpcUrl?: string; symbol?: string; explorerUrl?: string } = {}
  ) => {
    fireEvent.changeText(screen.getByLabelText('Network Name'), over.name ?? 'Avalanche C-Chain');
    fireEvent.changeText(screen.getByLabelText('Chain ID'), over.chainId ?? '43114');
    fireEvent.changeText(screen.getByLabelText('RPC URL'), over.rpcUrl ?? 'https://api.avax.network/ext/bc/C/rpc');
    fireEvent.changeText(screen.getByLabelText('Native Token Symbol'), over.symbol ?? 'AVAX');
    if (over.explorerUrl !== undefined) {
      fireEvent.changeText(screen.getByLabelText('Block Explorer URL (optional)'), over.explorerUrl);
    }
  };

  const mockRpcSuccess = (chainIdHex = '0xa86a') => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ result: chainIdHex }),
    });
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Alert, 'alert').mockImplementation(jest.fn());
  });

  afterEach(() => {
    (Alert.alert as jest.Mock).mockRestore?.();
  });

  it('renders without crashing', () => {
    const { queryAllByText } = render(
      <NavigationContainer>
        <AddCustomNetworkScreen {...({ navigation: {}, route: { params: {} } } as any)} />
      </NavigationContainer>
    );
    expect(queryAllByText(/Network/i).length).toBeGreaterThan(0);
  });

  it('adds a network after a successful RPC validation', async () => {
    const screen = renderScreen();
    fillForm(screen, { explorerUrl: 'https://snowtrace.io' });
    mockRpcSuccess('0xa86a'); // 43114

    fireEvent.press(screen.getByText('Add Network'));

    await waitFor(() => expect(mockAddCustomChain).toHaveBeenCalled());
    expect(mockAddCustomChain).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 43114,
        key: 'custom-43114',
        name: 'Avalanche C-Chain',
        type: 'evm',
        symbol: 'AVAX',
        rpcUrl: 'https://api.avax.network/ext/bc/C/rpc',
        explorerUrl: 'https://snowtrace.io',
        isTestnet: false,
      })
    );
    expect(Alert.alert).toHaveBeenCalledWith(
      'Network Added',
      expect.stringContaining('Avalanche C-Chain'),
      expect.any(Array)
    );

    // OK button navigates back.
    const buttons = (Alert.alert as jest.Mock).mock.calls[0][2];
    act(() => buttons[0].onPress());
    expect(screen.navigation.goBack).toHaveBeenCalled();
  });

  it('shows the testnet badge when the toggle is on', () => {
    const screen = renderScreen();
    expect(screen.queryByText(/Testnet networks use fake tokens/)).toBeNull();
    fireEvent(screen.getByRole('switch'), 'onValueChange', true);
    expect(screen.getByText(/Testnet networks use fake tokens/)).toBeTruthy();
  });

  it('rejects a non-numeric chain id', async () => {
    const screen = renderScreen();
    fillForm(screen, { chainId: 'abc' });
    fireEvent.press(screen.getByText('Add Network'));
    await waitFor(() =>
      expect(screen.getByText('Chain ID must be a positive integer')).toBeTruthy()
    );
    expect(mockAddCustomChain).not.toHaveBeenCalled();
  });

  it('rejects a malformed RPC URL', async () => {
    const screen = renderScreen();
    fillForm(screen, { rpcUrl: 'notaurl' });
    fireEvent.press(screen.getByText('Add Network'));
    await waitFor(() => expect(screen.getByText('Invalid RPC URL format')).toBeTruthy());
  });

  it('surfaces RPC HTTP failures', async () => {
    const screen = renderScreen();
    fillForm(screen);
    (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: false, status: 500 });
    fireEvent.press(screen.getByText('Add Network'));
    await waitFor(() => expect(screen.getByText('RPC returned status 500')).toBeTruthy());
  });

  it('surfaces JSON-RPC error responses', async () => {
    const screen = renderScreen();
    fillForm(screen);
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ error: { message: 'method not found' } }),
    });
    fireEvent.press(screen.getByText('Add Network'));
    await waitFor(() => expect(screen.getByText('RPC error: method not found')).toBeTruthy());
  });

  it('rejects when the RPC reports a different chain id', async () => {
    const screen = renderScreen();
    fillForm(screen);
    mockRpcSuccess('0x1'); // Ethereum mainnet, not 43114
    fireEvent.press(screen.getByText('Add Network'));
    await waitFor(() =>
      expect(screen.getByText('Chain ID mismatch: RPC reports 1 but you entered 43114')).toBeTruthy()
    );
    expect(mockAddCustomChain).not.toHaveBeenCalled();
  });

  it('accepts when the RPC returns no chain id result', async () => {
    const screen = renderScreen();
    fillForm(screen);
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({}),
    });
    fireEvent.press(screen.getByText('Add Network'));
    await waitFor(() => expect(mockAddCustomChain).toHaveBeenCalled());
  });

  it('surfaces fetch timeouts and transport failures', async () => {
    const screen = renderScreen();
    fillForm(screen);

    (global.fetch as jest.Mock).mockRejectedValueOnce(
      Object.assign(new Error('aborted'), { name: 'AbortError' })
    );
    fireEvent.press(screen.getByText('Add Network'));
    await waitFor(() => expect(screen.getByText('RPC validation timed out (8s)')).toBeTruthy());

    (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('ECONNREFUSED'));
    fireEvent.press(screen.getByText('Add Network'));
    await waitFor(() => expect(screen.getByText('ECONNREFUSED')).toBeTruthy());
  });

  it('blocks duplicates by chain id', async () => {
    mockAllChains.mockReturnValue([{ key: 'custom-43114' } as any]);
    const screen = renderScreen();
    fillForm(screen);
    mockRpcSuccess('0xa86a');
    fireEvent.press(screen.getByText('Add Network'));
    await waitFor(() =>
      expect(screen.getByText('A network with Chain ID 43114 already exists')).toBeTruthy()
    );
    expect(mockAddCustomChain).not.toHaveBeenCalled();
  });

  it('navigates back from the header', () => {
    const screen = renderScreen();
    fireEvent.press(screen.getByLabelText('Go back'));
    expect(screen.navigation.goBack).toHaveBeenCalled();
  });
});
