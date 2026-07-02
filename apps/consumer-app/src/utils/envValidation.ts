/**
 * Veilpay Environment Validation
 *
 * Validates required environment variables at app startup.
 * Fails fast with a user-friendly message if critical config is missing.
 *
 * VALUES COME FROM DOPPLER:
 *   During EAS builds, the `preInstallHook` downloads all EXPO_PUBLIC_* vars
 *   from Doppler into `.env`, which Metro inlines into the JS bundle at build
 *   time. At runtime, these become string literals — there is no process.env
 *   read in production.
 *
 * Priority levels:
 * - CRITICAL: App cannot function (no backend)
 * - IMPORTANT: Feature degraded but app usable (no analytics, no WalletConnect)
 * - OPTIONAL: Nice-to-have (Sentry, Mixpanel)
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
    description: 'Backend API base URL for RPC proxy, transaction history, and push registration',
    userMessage: 'Backend server URL is not configured. The app cannot function.',
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
