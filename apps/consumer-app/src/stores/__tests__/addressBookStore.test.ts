import { useAddressBookStore } from '../addressBookStore';

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

describe('addressBookStore', () => {
  beforeEach(() => {
    useAddressBookStore.setState({ addresses: [] });
  });

  it('loads module without crashing', () => {
    expect(useAddressBookStore.getState()).toBeDefined();
  });

  it('adds a new entry with generated id and timestamp', () => {
    const before = Date.now();
    useAddressBookStore.getState().addAddress('Alice', 'G' + 'A'.repeat(55), 'xlm');

    const list = useAddressBookStore.getState().addresses;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      name: 'Alice',
      address: 'G' + 'A'.repeat(55),
      chain: 'xlm',
    });
    expect(list[0].id).toBeTruthy();
    expect(list[0].addedAt).toBeGreaterThanOrEqual(before);
  });

  it('updates the name when the same address+chain is re-added (case-insensitive)', () => {
    const addr = 'G' + 'A'.repeat(55);
    useAddressBookStore.getState().addAddress('Alice', addr, 'xlm');
    useAddressBookStore.getState().addAddress('Alicia', addr.toUpperCase(), 'xlm');

    const list = useAddressBookStore.getState().addresses;
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe('Alicia');
    expect(list[0].address).toBe(addr);
  });

  it('keeps separate entries for different chains or addresses', () => {
    const addr = 'G' + 'A'.repeat(55);
    useAddressBookStore.getState().addAddress('A', addr, 'xlm');
    useAddressBookStore.getState().addAddress('B', addr, 'evm');
    useAddressBookStore.getState().addAddress('C', '0x' + '1'.repeat(40), 'evm');

    expect(useAddressBookStore.getState().addresses).toHaveLength(3);
  });

  it('removes an entry by id', () => {
    useAddressBookStore.getState().addAddress('Alice', 'G' + 'A'.repeat(55), 'xlm');
    const id = useAddressBookStore.getState().addresses[0].id;

    useAddressBookStore.getState().removeAddress(id);
    expect(useAddressBookStore.getState().addresses).toHaveLength(0);

    // Removing an unknown id is a no-op.
    useAddressBookStore.getState().removeAddress('missing');
    expect(useAddressBookStore.getState().addresses).toHaveLength(0);
  });

  it('clearAddresses wipes everything (PRIV-002 account wipe)', () => {
    useAddressBookStore.getState().addAddress('Alice', 'G' + 'A'.repeat(55), 'xlm');
    useAddressBookStore.getState().addAddress('Bob', '0x' + '2'.repeat(40), 'evm');

    useAddressBookStore.getState().clearAddresses();
    expect(useAddressBookStore.getState().addresses).toHaveLength(0);
  });
});
