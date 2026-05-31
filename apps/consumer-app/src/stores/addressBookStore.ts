import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

export interface AddressEntry {
  id: string;
  name: string;
  address: string;
  chain: string;
  addedAt: number;
}

interface AddressBookState {
  addresses: AddressEntry[];
  addAddress: (name: string, address: string, chain: string) => void;
  removeAddress: (id: string) => void;
}

export const useAddressBookStore = create<AddressBookState>()(
  persist(
    (set) => ({
      addresses: [],
      addAddress: (name, address, chain) => {
        set((state) => {
          // Update existing entry if the same address+chain already saved
          const existingIdx = state.addresses.findIndex(
            (a) => a.address.toLowerCase() === address.toLowerCase() && a.chain === chain
          );
          if (existingIdx >= 0) {
            const updated = [...state.addresses];
            updated[existingIdx] = { ...updated[existingIdx], name };
            return { addresses: updated };
          }
          // Otherwise add new entry
          return {
            addresses: [
              ...state.addresses,
              {
                id: `${Date.now()}-${Math.random().toString(36).substring(7)}`,
                name,
                address,
                chain,
                addedAt: Date.now(),
              },
            ],
          };
        });
      },
      removeAddress: (id) => {
        set((state) => ({
          addresses: state.addresses.filter((a) => a.id !== id),
        }));
      },
    }),
    {
      name: 'veilpay-address-book',
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);
