export type FiatGatewayProvider = 'transak' | 'onramp_money' | 'moonpay';

export type FiatGatewayFlow = 'buy' | 'sell';

export type FiatGatewayStatus =
  | 'initiated'
  | 'pending'
  | 'processing'
  | 'success'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface FiatGatewayOrderLike {
  walletAddress?: string | null;
  userAddress?: string | null;
  orderId?: string | null;
  id?: string | null;
  provider?: FiatGatewayProvider | null;
  flow?: FiatGatewayFlow | null;
  status?: FiatGatewayStatus | string | null;
  updatedAt?: number | null;
}

export function getFiatGatewayOrderAddress(order: FiatGatewayOrderLike | null | undefined): string | null {
  if (!order) {
    return null;
  }

  return order.walletAddress ?? order.userAddress ?? null;
}

export function isFiatGatewayOrderForAddress(
  order: FiatGatewayOrderLike | null | undefined,
  address: string | null | undefined
): boolean {
  if (!order || !address) {
    return false;
  }

  const orderAddress = getFiatGatewayOrderAddress(order);
  if (!orderAddress) {
    return false;
  }

  return orderAddress.toLowerCase() === address.toLowerCase();
}

export function normalizeFiatGatewayStatus(status: string | null | undefined): FiatGatewayStatus {
  const normalized = (status || '').toLowerCase();

  switch (normalized) {
    case 'initiated':
    case 'pending':
    case 'processing':
    case 'success':
    case 'completed':
    case 'failed':
    case 'cancelled':
      return normalized;
    case 'succeeded':
      return 'completed';
    default:
      return 'failed';
  }
}

export function isPaymentIntentUrl(url: string): boolean {
  const normalized = url.trim().toLowerCase();

  return (
    normalized.startsWith('upi://') ||
    normalized.startsWith('phonepe://') ||
    normalized.startsWith('gpay://') ||
    normalized.startsWith('intent://')
  );
}

export function isAllowedOnrampUrl(url: string): boolean {
  try {
    const parsed = new URL(url);

    if (parsed.protocol !== 'https:') {
      return false;
    }

    const host = parsed.hostname;
    return (
      host === 'onramp.money' || host.endsWith('.onramp.money') ||
      host === 'moonpay.com' || host.endsWith('.moonpay.com') ||
      host === 'transak.com' || host.endsWith('.transak.com')
    );
  } catch {
    return false;
  }
}