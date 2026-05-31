import { render, screen } from '@testing-library/react';
import Home from '../page';

// Mock the shared package
jest.mock('@veilpay/shared', () => ({
  SUPPORTED_CHAINS: [
    {
      key: 'ethereum',
      name: 'Ethereum',
      type: 'evm',
      chainId: 1,
      nativeCurrency: { symbol: 'ETH' },
    },
    {
      key: 'solana',
      name: 'Solana',
      type: 'solana',
      nativeCurrency: { symbol: 'SOL' },
    },
  ],
}));

describe('Home page', () => {
  it('renders the heading and description', () => {
    render(<Home />);
    
    expect(screen.getByRole('heading', { name: /VeilPay/i, level: 1 })).toBeInTheDocument();
    expect(screen.getByText('Multi-Chain Privacy Payment Protocol')).toBeInTheDocument();
  });

  it('renders supported chains', () => {
    render(<Home />);
    
    expect(screen.getByRole('heading', { name: /Supported Chains/i, level: 2 })).toBeInTheDocument();
    
    // Check for mocked chains
    expect(screen.getByText('Ethereum')).toBeInTheDocument();
    expect(screen.getByText('Type: EVM')).toBeInTheDocument();
    expect(screen.getByText('Chain ID: 1')).toBeInTheDocument();
    expect(screen.getByText('Native: ETH')).toBeInTheDocument();

    expect(screen.getByText('Solana')).toBeInTheDocument();
    expect(screen.getByText('Type: SOLANA')).toBeInTheDocument();
    expect(screen.getByText('Native: SOL')).toBeInTheDocument();
  });
});
