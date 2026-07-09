import { Linking } from "react-native";

// CA-C1 fix: URL allowlist to prevent phishing via deep links
const ALLOWED_HOSTS: string[] = [
  "veilpay.app",
  "app.uniswap.org",
  "explorer.solana.com",
  "etherscan.io",
  "polygonscan.com",
  "arbiscan.io",
  "optimistic.etherscan.io",
  "basescan.org",

  "sepolia.etherscan.io",
];

const ALLOWED_SCHEMES: string[] = ["https", "http"];

function isUrlAllowed(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (!ALLOWED_SCHEMES.includes(parsed.protocol.replace(":", ""))) {
      return false;
    }
    const host = parsed.hostname.toLowerCase();
    return ALLOWED_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
  } catch {
    return false;
  }
}

export async function openExternalUrl(url: string): Promise<boolean> {
  if (!isUrlAllowed(url)) {
    console.warn(`[ExternalLink] Blocked disallowed URL: ${url}`);
    return false;
  }

  try {
    const canOpen = await Linking.canOpenURL(url);
    if (!canOpen) {
      return false;
    }

    await Linking.openURL(url);
    return true;
  } catch {
    return false;
  }
}
