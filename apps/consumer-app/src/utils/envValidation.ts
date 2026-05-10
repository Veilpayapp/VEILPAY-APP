/**
 * Veilpay Environment Validation
 *
 * Validates required environment variables at app startup.
 * Fails fast with a user-friendly message if critical config is missing.
 *
 * Priority levels:
 * - CRITICAL: App cannot function (no RPC, no backend)
 * - IMPORTANT: Feature degraded but app usable (no analytics, no WalletConnect)
 * - OPTIONAL: Nice-to-have (Sentry, OTA updates)
 */

export type EnvValidationLevel = 'critical' | 'important' | 'optional';

export interface EnvValidationResult {
  isValid: boolean;
  errors: EnvValidationError[];
  warnings: EnvValidationWarning[];
}

export interface EnvValidationError {
  key: string;
  level: EnvValidationLevel;
  message: string;
  userMessage: string;
}

export interface EnvValidationWarning {
  key: string;
  message: string;
}

interface EnvVarSpec {
  key: string;
  level: EnvValidationLevel;
  description: string;
  userMessage: string;
  validate?: (value: string) => boolean;
}

const ENV_SPECS: EnvVarSpec[] = [
  // ── CRITICAL: App cannot function without these ──────────────────────────
  {
    key: 'EXPO_PUBLIC_BACKEND_BASE_URL',
    level: 'critical',
    description: 'Backend API base URL for transaction history and push registration',
    userMessage: 'Backend server URL is not configured. Transaction history and notifications will not work.',
    validate: (v) => {
      if (!v) return false;
      try {
        new URL(v);
        return true;
      } catch {
        return false;
      }
    },
  },
  {
    key: 'EXPO_PUBLIC_ALCHEMY_API_KEY',
    level: 'critical',
    description: 'Alchemy API key for reliable RPC access (free tier: 300M CU/month)',
    userMessage: 'No RPC API key configured. Blockchain connections will use unreliable public endpoints and may fail.',
  },
  {
    key: 'EXPO_PUBLIC_INFURA_API_KEY',
    level: 'important',
    description: 'Infura API key for RPC failover (free tier: 100K req/day)',
    userMessage: 'No Infura backup key configured. RPC failover will rely on public endpoints only.',
  },

  // ── IMPORTANT: Feature degraded but app usable ────────────────────────────
  {
    key: 'EXPO_PUBLIC_WALLETCONNECT_PROJECT_ID',
    level: 'important',
    description: 'WalletConnect Cloud project ID for dApp connections',
    userMessage: 'WalletConnect is not configured. You won\'t be able to connect to external dApps.',
  },
  {
    key: 'EXPO_PUBLIC_SENTRY_DSN',
    level: 'important',
    description: 'Sentry DSN for production crash reporting',
    userMessage: 'Crash reporting is not configured. Errors won\'t be reported to the team.',
  },
  {
    key: 'EXPO_PUBLIC_EAS_PROJECT_ID',
    level: 'important',
    description: 'EAS project ID for OTA updates',
    userMessage: 'Over-the-air updates are not configured. You\'ll need to reinstall for updates.',
  },

  // ── OPTIONAL: Nice-to-have ───────────────────────────────────────────────
  {
    key: 'EXPO_PUBLIC_MIXPANEL_TOKEN',
    level: 'optional',
    description: 'Mixpanel token for analytics tracking',
    userMessage: 'Analytics tracking is not configured.',
  },
  {
    key: 'EXPO_PUBLIC_EAS_UPDATE_URL',
    level: 'optional',
    description: 'EAS update URL for OTA update checks',
    userMessage: 'OTA update URL not set.',
  },
];

/**
 * Validates all environment variables and returns a structured result.
 *
 * The app should check `result.isValid` before proceeding.
 * If invalid, display the `userMessage` from each error.
 */
export function validateEnvironment(): EnvValidationResult {
  const errors: EnvValidationError[] = [];
  const warnings: EnvValidationWarning[] = [];

  for (const spec of ENV_SPECS) {
    const value = (process.env[spec.key] || '').trim();
    const isPresent = spec.validate ? spec.validate(value) : value.length > 0;

    if (!isPresent) {
      if (spec.level === 'critical') {
        errors.push({
          key: spec.key,
          level: spec.level,
          message: `Missing or invalid: ${spec.key} — ${spec.description}`,
          userMessage: spec.userMessage,
        });
      } else if (spec.level === 'important') {
        warnings.push({
          key: spec.key,
          message: spec.userMessage,
        });
      }
      // optional: silently skip
    }
  }

  // In development mode, relax critical requirements
  // (public RPC endpoints are acceptable for testing)
  const isDev = __DEV__;
  const criticalErrors = isDev
    ? errors.filter((e) => {
        // In dev, only EXPO_PUBLIC_BACKEND_BASE_URL is truly critical
        // (public RPCs work fine for testing)
        return e.key === 'EXPO_PUBLIC_BACKEND_BASE_URL';
      })
    : errors;

  return {
    isValid: criticalErrors.length === 0,
    errors: criticalErrors,
    warnings,
  };
}

/**
 * Returns a user-friendly summary of all validation issues.
 * Suitable for displaying in an Alert or on-screen message.
 */
export function getEnvValidationSummary(result: EnvValidationResult): string {
  const parts: string[] = [];

  if (result.errors.length > 0) {
    parts.push('⚠️ Configuration Issues:');
    for (const error of result.errors) {
      parts.push(`• ${error.userMessage}`);
    }
  }

  if (result.warnings.length > 0) {
    parts.push('');
    parts.push('ℹ️ Optional Features:');
    for (const warning of result.warnings) {
      parts.push(`• ${warning.message}`);
    }
  }

  return parts.join('\n');
}
