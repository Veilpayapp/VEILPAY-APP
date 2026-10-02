/**
 * Round-5 test-lifecycle hardening (Stream C).
 *
 * Jest (worker mode) force-exits any worker whose event loop is still busy
 * after the run — "A worker process has failed to exit gracefully ...".
 * The redis singleton clients in src/lib/redis.ts are module-scoped: a test
 * file that constructs them for real would hold a socket/retry timer for
 * the rest of the run. Tear them down after every file so the worker's
 * event loop can drain.
 *
 * No-op in the common cases: under the global ioredis mock
 * (tests/setup.ts) `disconnect()` is a jest.fn(), and when a test file
 * mocks lib/redis itself without exposing `disconnectRedis` the guard
 * below skips the call — exactly the round-3 failure mode where a changed
 * export broke every jest mock of the module. This file intentionally
 * registers no mocks of its own.
 */
afterAll(() => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const lib = require('../src/lib/redis') as {
    disconnectRedis?: () => void;
  };
  if (typeof lib.disconnectRedis === 'function') {
    lib.disconnectRedis();
  }
});
