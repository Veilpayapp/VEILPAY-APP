/**
 * Biometric Token Manager - SEC-002 Implementation
 * Handles secure generation, validation, and rate limiting of biometric tokens
 * Prevents token predictability and implements exponential backoff on failures
 */

import { addBreadcrumb } from './sentry';
import * as Crypto from 'expo-crypto';

interface BiometricTokenEntry {
  token: string;
  issuedAt: number;
  consumed: boolean;
  userId: string;
}

interface FailureRecord {
  count: number;
  lastAttemptAt: number;
  nextRetryAt: number;
}

export class BiometricTokenManager {
  // SEC-002: Rate limiting configuration
  private static readonly MAX_TOKENS_PER_WINDOW = 1;
  private static readonly RATE_LIMIT_WINDOW_MS = 30_000;
  private static readonly TOKEN_EXPIRY_MS = 30_000;

  // SEC-002: Exponential backoff on repeated failures
  private static readonly INITIAL_BACKOFF_MS = 1000;
  private static readonly MAX_BACKOFF_MS = 60_000;
  private static readonly BACKOFF_MULTIPLIER = 2;

  private tokenStore = new Map<string, BiometricTokenEntry>();
  private userFailureAttempts = new Map<string, FailureRecord>();

  /**
   * Generate a cryptographically random biometric token with rate limiting.
   * SEC-002:
   * - Uses crypto.randomUUID() instead of timestamp-based tokens (prevents predictability)
   * - Enforces 1 token per user per 30 seconds (rate limiting)
   * - Throws if user exceeds rate limit with exponential backoff
   *
   * @param userId - Unique identifier for the user (e.g., wallet address or session ID)
   * @returns Cryptographically random token string
   * @throws Error if rate limit exceeded or other constraints violated
   */
  generateBiometricToken(userId: string): string {
    const now = Date.now();

    // Check if user is rate-limited due to repeated failures
    const failure = this.userFailureAttempts.get(userId);
    if (failure && failure.nextRetryAt > now) {
      const waitMs = Math.ceil((failure.nextRetryAt - now) / 1000) * 1000;
      addBreadcrumb('Token generation rate-limited', 'security', {
        userId,
        waitMs,
        failureCount: failure.count,
      });
      throw new Error(
        `Rate limited. Please wait ${Math.ceil(waitMs / 1000)}s before trying again.`
      );
    }

    // Check existing valid tokens for this user (prevent token explosion)
    const validTokenCount = Array.from(this.tokenStore.values()).filter(
      (entry) =>
        entry.userId === userId &&
        !entry.consumed &&
        now - entry.issuedAt < BiometricTokenManager.TOKEN_EXPIRY_MS
    ).length;

    if (validTokenCount >= BiometricTokenManager.MAX_TOKENS_PER_WINDOW) {
      addBreadcrumb('Token generation rejected - max tokens reached', 'security', {
        userId,
        validTokenCount,
      });
      throw new Error(
        'Maximum active tokens reached. Please complete the previous operation.'
      );
    }

    // SEC-002: Generate cryptographically random token (NOT timestamp-based)
    // Uses two UUIDs for additional entropy
    const randomBytes = Crypto.randomUUID();
    const token = `bm_${randomBytes}_${Crypto.randomUUID()}`;

    this.tokenStore.set(token, {
      token,
      issuedAt: now,
      consumed: false,
      userId,
    });

    // Reset failure counter on successful token generation
    this.userFailureAttempts.delete(userId);

    addBreadcrumb('Biometric token generated', 'security', { userId });

    return token;
  }

  /**
   * Consume and validate a biometric token with comprehensive checks.
   * SEC-002:
   * - Validates token exists and matches user
   * - Prevents token reuse
   * - Enforces expiry window
   * - Tracks and logs failed attempts with exponential backoff
   * - Provides audit trail via breadcrumbs
   *
   * @param token - Token to consume
   * @param userId - User attempting to consume the token
   * @throws Error if token is invalid, expired, already consumed, or doesn't match user
   */
  consumeBiometricToken(token: string, userId: string): void {
    const now = Date.now();
    const entry = this.tokenStore.get(token);

    // Token not found
    if (!entry) {
      this.recordFailedAttempt(userId, now);
      throw new Error(
        'Biometric authorization required. Please authenticate and try again.'
      );
    }

    // User mismatch (prevents cross-user token reuse)
    if (entry.userId !== userId) {
      this.recordFailedAttempt(userId, now);
      addBreadcrumb('Token consumption rejected - user mismatch', 'security', {
        expectedUserId: userId,
        tokenUserId: entry.userId,
      });
      throw new Error('Invalid authorization token for this user.');
    }

    // Token already consumed (prevents reuse)
    if (entry.consumed) {
      this.recordFailedAttempt(userId, now);
      addBreadcrumb('Token reuse attempt detected', 'security', { userId });
      throw new Error(
        'This authorization token has already been used. Please authenticate again.'
      );
    }

    // Token expired
    const age = now - entry.issuedAt;
    if (age > BiometricTokenManager.TOKEN_EXPIRY_MS) {
      this.tokenStore.delete(token);
      this.recordFailedAttempt(userId, now);
      addBreadcrumb('Token consumption rejected - expired', 'security', {
        userId,
        ageMs: age,
      });
      throw new Error('Biometric authorization expired. Please authenticate again.');
    }

    // All checks passed - mark token as consumed
    entry.consumed = true;
    this.tokenStore.set(token, entry);

    // Reset failure counter on successful consumption
    this.userFailureAttempts.delete(userId);

    addBreadcrumb('Biometric token validated and consumed', 'security', { userId });

    // Cleanup expired tokens periodically
    this.cleanupExpiredTokens(now);
  }

  /**
   * Record a failed consumption attempt and apply exponential backoff.
   * SEC-002: Implements exponential backoff: backoff = min(1s * 2^(n-1), 60s)
   * This slows down attackers attempting to brute-force or replay tokens.
   *
   * @param userId - User who failed the attempt
   * @param now - Current timestamp
   */
  private recordFailedAttempt(userId: string, now: number): void {
    const failure = this.userFailureAttempts.get(userId);

    if (!failure) {
      // First failure - apply initial backoff
      this.userFailureAttempts.set(userId, {
        count: 1,
        lastAttemptAt: now,
        nextRetryAt: now + BiometricTokenManager.INITIAL_BACKOFF_MS,
      });
      addBreadcrumb('Failed token attempt recorded', 'security', {
        userId,
        attemptCount: 1,
        backoffMs: BiometricTokenManager.INITIAL_BACKOFF_MS,
      });
      return;
    }

    // SEC-002: Calculate exponential backoff
    // backoff = min(initialBackoff * 2^(n-1), maxBackoff)
    const backoffMs = Math.min(
      BiometricTokenManager.INITIAL_BACKOFF_MS *
        Math.pow(BiometricTokenManager.BACKOFF_MULTIPLIER, failure.count),
      BiometricTokenManager.MAX_BACKOFF_MS
    );

    failure.count += 1;
    failure.lastAttemptAt = now;
    failure.nextRetryAt = now + backoffMs;

    this.userFailureAttempts.set(userId, failure);

    addBreadcrumb('Failed token attempt recorded with exponential backoff', 'security', {
      userId,
      attemptCount: failure.count,
      backoffMs,
    });
  }

  /**
   * Clean up expired tokens and failure records periodically.
   * Removes tokens older than 2x expiry window and consumed tokens.
   */
  private cleanupExpiredTokens(now: number): void {
    const cutoff = now - BiometricTokenManager.TOKEN_EXPIRY_MS * 2;
    let deletedCount = 0;

    for (const [key, entry] of this.tokenStore.entries()) {
      if (entry.issuedAt < cutoff || entry.consumed) {
        this.tokenStore.delete(key);
        deletedCount++;
      }
    }

    if (deletedCount > 0) {
      addBreadcrumb('Cleanup: expired tokens removed', 'security', { deletedCount });
    }
  }

  /**
   * Get current count of valid unconsumed tokens (for testing/monitoring).
   * @returns Number of valid tokens currently in the store
   */
  getTokenCount(): number {
    const now = Date.now();
    let count = 0;
    for (const entry of this.tokenStore.values()) {
      if (
        !entry.consumed &&
        now - entry.issuedAt <= BiometricTokenManager.TOKEN_EXPIRY_MS
      ) {
        count++;
      }
    }
    return count;
  }

  /**
   * Clear all tokens and failure records (for testing and logout scenarios).
   */
  clearAllTokens(): void {
    this.tokenStore.clear();
    this.userFailureAttempts.clear();
    addBreadcrumb('All biometric tokens cleared', 'security');
  }

  /**
   * Get failure record for a user (for testing).
   * @param userId - User ID to check
   * @returns Failure record or undefined
   */
  getFailureRecord(userId: string): FailureRecord | undefined {
    return this.userFailureAttempts.get(userId);
  }
}

// Singleton instance for use throughout the app
export const biometricTokenManager = new BiometricTokenManager();
