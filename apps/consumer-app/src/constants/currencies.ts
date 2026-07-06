export interface CurrencyOption {
  id: string;
  name: string;
  symbol: string;
}

export const CURRENCIES: CurrencyOption[] = [
  { id: 'USD', name: 'US Dollar', symbol: '$' },
  { id: 'EUR', name: 'Euro', symbol: '€' },
  { id: 'GBP', name: 'British Pound', symbol: '£' },
  { id: 'JPY', name: 'Japanese Yen', symbol: '¥' },
  { id: 'AUD', name: 'Australian Dollar', symbol: 'A$' },
  { id: 'CAD', name: 'Canadian Dollar', symbol: 'C$' },
  { id: 'INR', name: 'Indian Rupee', symbol: '₹' },
];
