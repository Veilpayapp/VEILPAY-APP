/**
 * VeilPay release notes / "What's New" changelog.
 *
 * SOURCE OF TRUTH for the user-facing update details shown in the About →
 * Version → "What's New" modal. Keep this in lockstep with `version.json`:
 *
 *   • On every shipped update, prepend a new entry describing what changed.
 *   • `version`/`build` should match the `version.json` values that carry the
 *     change. For a native release, bump `version.json` first, then add the
 *     matching entry here. For an OTA-only (JS) update that keeps the same
 *     runtimeVersion, add a dated entry under the current `version` — do NOT
 *     bump `version`, or installed builds won't receive the OTA.
 *
 * The newest release must always be first (RELEASE_NOTES[0] === LATEST_RELEASE).
 */

export interface ReleaseNote {
  /** App version this release maps to (matches version.json `version`). */
  version: string;
  /** Build/versionCode this release maps to (matches version.json build). */
  build: number;
  /** Release date, YYYY-MM-DD. */
  date: string;
  /** Short, user-facing bullets — what the user actually gets. */
  highlights: string[];
}

/**
 * Newest first. Prepend a new object here whenever an update ships.
 */
export const RELEASE_NOTES: ReleaseNote[] = [
  {
    version: '1.0.1',
    build: 6,
    date: '2026-07-05',
    highlights: [
      'No more grey flash on startup — the branded splash now stays up until the app is ready.',
    ],
  },
  {
    version: '1.0.1',
    build: 5,
    date: '2026-07-05',
    highlights: [
      'Updates now ask before installing — you get a prompt instead of a silent background update.',
      'App opens instantly again — removed the startup delay that could show a blank screen.',
      'Fixed the pending Buy/Sell card stretching off the edge of the screen.',
    ],
  },
  {
    version: '1.0.1',
    build: 4,
    date: '2026-07-05',
    highlights: [
      'Faster app launch — the unlock prompt now appears right away instead of after a delay.',
      'New branded loading screen so startup no longer looks like a blank screen.',
    ],
  },
  {
    version: '1.0.1',
    build: 3,
    date: '2026-07-05',
    highlights: [
      'Fixed Stellar (XLM) balances showing as $0.00 / 0 XLM on the dashboard.',
    ],
  },
  {
    version: '1.0.1',
    build: 2,
    date: '2026-07-05',
    highlights: [
      'Fixed "Currency not supported" when buying crypto through Onramp.money.',
      'Added 24 supported fiat currencies for buying crypto, including USD, EUR, GBP and AED.',
      'New in-app update experience — check for and install updates from Settings.',
      'Buy/Sell now shows the tokens each provider actually supports.',
    ],
  },
];

/** The most recent release — what the "What's New" modal highlights by default. */
export const LATEST_RELEASE: ReleaseNote = RELEASE_NOTES[0];
