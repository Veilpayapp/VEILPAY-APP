/**
 * Pass 2 — Route policy verifier.
 *
 * Walks the backend route files discovered in Pass 1 (Discovery) plus the
 * server bootstrap and JWT/session config, and applies textual heuristics to
 * verify each policy required by Requirement 6 acceptance criteria 6.6, 6.7,
 * 6.9, 6.10, and 6.11. Every probe is read-only — files are loaded with
 * `fs.readFile` and never written back. The Auditor never mutates source
 * files (Requirement 10.2).
 *
 * Emitted record set, per design.md "Security audit component":
 *   - One `webhook-signature`, `webhook-timestamp`, and `schema-validation`
 *     check per webhook route file.
 *   - One `auth`, `scope`, and `schema-validation` check per merchant /
 *     invoice / admin route file.
 *   - One `rate-limiting` and one `cors` check against the server bootstrap
 *     candidates (`apps/backend/src/{index,app,server,main}.ts`).
 *   - One `jwt-alg`, `jwt-ttl`, and `jwt-refresh` check across every TS file
 *     under `apps/backend/src` (recursive walk).
 *
 * Heuristics intentionally err toward simple regex matches over AST analysis
 * so the verifier can run without project-specific TypeScript type
 * resolution. False positives/negatives are surfaced into the per-result
 * `reason` string so the Pass 3 synthesizer can downgrade severity when
 * appropriate.
 */

import { promises as fs, type Dirent } from 'node:fs';
import * as path from 'node:path';

// =====================================================================
// Public types
// =====================================================================

/**
 * The fixed set of policy checks the verifier emits. Each value maps 1:1 to
 * a subset of Requirement 6 acceptance criteria:
 *   - webhook-signature, webhook-timestamp → 6.6
 *   - auth, scope                          → 6.7
 *   - schema-validation                    → 6.9
 *   - rate-limiting, cors                  → 6.10
 *   - jwt-alg, jwt-ttl, jwt-refresh        → 6.11
 */
export type RouteCheckKind =
  | 'webhook-signature'
  | 'webhook-timestamp'
  | 'auth'
  | 'scope'
  | 'schema-validation'
  | 'rate-limiting'
  | 'cors'
  | 'jwt-alg'
  | 'jwt-ttl'
  | 'jwt-refresh';

/**
 * One structured evidence record per route per check (task 3.7 wording).
 *
 * Field semantics:
 *   - `routePath` — repository-relative identifier of the surface being
 *     checked. For per-route checks this is the workspace-relative path of
 *     the route source file (e.g., `apps/backend/src/routes/webhook.ts`).
 *     For aggregate checks (bootstrap, JWT) it is a synthetic label like
 *     `<bootstrap>` or `<jwt-config>` so downstream renderers can group them
 *     deterministically.
 *   - `sourcePath` — absolute path of the file that was actually read for
 *     the heuristic. Empty string when no candidate file exists (e.g., a
 *     monorepo without `apps/backend/src/index.ts`); in that case `pass`
 *     is `false` and `reason` records the missing file.
 *   - `check` — the policy under verification (see `RouteCheckKind`).
 *   - `pass` — `true` when the heuristic matched and the policy is
 *     considered present, `false` otherwise. The Pass 3 synthesizer applies
 *     the Severity floor (High for missing webhook signature/timestamp,
 *     Medium for missing schema/rate-limiting/CORS, etc.) using this flag.
 *   - `reason` — one-sentence human-readable justification quoted into the
 *     Audit_Report. Mentions which pattern matched (or which patterns were
 *     absent) so the reader can audit the heuristic itself.
 */
export interface RouteCheckResult {
  readonly routePath: string;
  readonly sourcePath: string;
  readonly check: RouteCheckKind;
  readonly pass: boolean;
  readonly reason: string;
}

/**
 * Aggregate verifier output. The flat `results` list contains every record
 * emitted (per-route plus bootstrap plus JWT) for trivial iteration; the
 * `bootstrap` and `jwt` named handles point at the same record instances so
 * the Pass 3 synthesizer can reach them without filtering.
 */
export interface RouteVerifierOutput {
  readonly results: readonly RouteCheckResult[];
  readonly bootstrap: {
    readonly rateLimiting: RouteCheckResult;
    readonly cors: RouteCheckResult;
  };
  readonly jwt: {
    readonly alg: RouteCheckResult;
    readonly ttl: RouteCheckResult;
    readonly refresh: RouteCheckResult;
  };
}

/**
 * Inputs for `runRouteVerifier`. `backendRoutes` lists are workspace-
 * relative file paths (e.g., `apps/backend/src/routes/webhook.ts`) as
 * captured by Pass 1 Discovery — see `runDiscovery` in
 * `passes/discovery.ts`.
 */
export interface RouteVerifierInput {
  readonly workspaceRoot: string;
  readonly backendRoutes: {
    readonly webhooks: readonly string[];
    readonly merchant: readonly string[];
    readonly invoice: readonly string[];
    readonly admin: readonly string[];
  };
}

// =====================================================================
// Heuristic patterns
// =====================================================================

/**
 * Webhook signature middleware indicators. Matches the explicit middleware
 * names called out by the design ("Walk webhook routes, confirm signature
 * header verification") plus generic HMAC verification calls so backends
 * that roll their own signature check are still recognized.
 */
const WEBHOOK_SIGNATURE_PATTERNS: readonly RegExp[] = [
  /\bverifySignature\b/,
  /\bverifyWebhookSignature\b/,
  /\bsignatureMiddleware\b/,
  /\bcrypto\.createHmac\b/,
  /\bcreateHmac\b/,
];

/**
 * Five-minute timestamp window indicators. The design fixes the window at
 * 300 seconds; this regex set covers the common literal forms (numeric
 * milliseconds, numeric seconds product, named constant).
 */
const WEBHOOK_TIMESTAMP_PATTERNS: readonly RegExp[] = [
  /\b5\s*\*\s*60\b/,
  /\b300_000\b/,
  /\b300000\b/,
  /\bMAX_WEBHOOK_AGE_MS\b/,
];

/**
 * Auth middleware indicators for merchant / invoice / admin routes. Covers
 * the in-tree `authMiddleware`/`requireAuth` pair plus `passport.authenticate`
 * and a generic `verifyJwt` helper.
 */
const AUTH_PATTERNS: readonly RegExp[] = [
  /\bauthMiddleware\b/,
  /\brequireAuth\b/,
  /\bpassport\.authenticate\b/,
  /\bverifyJwt\b/,
];

/**
 * Scope-check indicators. The design lists `requireScope`, `hasRole`,
 * `checkPermission` plus the `req.user.merchantId`-tenancy-guard pattern.
 *
 * The last two patterns capture the in-tree convention this codebase uses:
 * `req.merchantId !== id` (set by `authMiddleware`, not under `req.user`)
 * and the equivalent reads against `invoice.merchantId`/`payment.merchantId`
 * for cross-tenant equality guards. These extra patterns avoid the
 * 2026-05-29 false-positive on `merchant.ts` / `invoice.ts` where the
 * tenancy guard lives in the controller and uses the bare
 * `req.merchantId` shape rather than `req.user.merchantId`.
 */
const SCOPE_PATTERNS: readonly RegExp[] = [
  /\brequireScope\b/,
  /\bhasRole\b/,
  /\bcheckPermission\b/,
  /req\.user\.merchantId/,
  /req\.merchantId\b/,
  /\bmerchantId\s*!==\s*req\.merchantId\b/,
  /\breq\.merchantId\s*!==\b/,
];

/**
 * Schema validation indicators. Matches the import names of the three
 * supported libraries (`zod`, `joi`, `yup`), their canonical entry
 * points, a generic `validateRequest(<schema>)` helper, and the
 * `<NameSchema>.parse(req.body|params|query)` pattern this codebase
 * uses where schemas are defined in a shared types module and consumed
 * via `.parse` / `.safeParse` at the controller boundary.
 */
const SCHEMA_PATTERNS: readonly RegExp[] = [
  /\bfrom\s+['"]zod['"]/,
  /\bfrom\s+['"]joi['"]/,
  /\bfrom\s+['"]yup['"]/,
  /\bz\.object\b/,
  /\bJoi\.object\b/,
  /\byup\.object\b/,
  /\bvalidateRequest\s*\(/,
  /\b\w*Schema\.parse\s*\(/,
  /\b\w*Schema\.safeParse\s*\(/,
];

/**
 * Rate-limiting middleware indicators for the server bootstrap.
 */
const RATE_LIMIT_PATTERNS: readonly RegExp[] = [
  /express-rate-limit/,
  /fastify-rate-limit/,
  /\brateLimit\s*\(/,
  /\bRateLimit\b/,
  /\brateLimiter\b/,
];

/**
 * Permissive CORS indicators. Either of these matches fails the
 * `cors-allow-list` check; otherwise any other `cors(` invocation passes.
 */
const CORS_WILDCARD_PATTERNS: readonly RegExp[] = [
  /origin\s*:\s*['"]\*['"]/,
  /origin\s*:\s*true\b/,
];

/**
 * Any cors invocation at all. Used as the positive signal once the wildcard
 * patterns above have been ruled out.
 */
const CORS_INVOCATION_PATTERN = /\bcors\s*\(/;

/**
 * Auth-model indicators. A "JWT" stack and an "HMAC + nonce" stack are
 * both acceptable models for the auth boundary; this audit refuses to
 * assume one over the other. The indicators below classify a backend's
 * auth model so the JWT alg/ttl/refresh probes can downgrade their
 * floor when the equivalent HMAC+nonce primitives are present.
 *
 *   - JWT model: `jsonwebtoken`, `jose`, or a `jwt.sign(`/`jwt.verify(`
 *     call.
 *   - HMAC + nonce model: a `createHmac(...).digest(...)` call combined
 *     with explicit timestamp-window enforcement (`Math.abs(... -
 *     timestamp) > <300_000-ish>`) and a Redis-or-equivalent nonce key.
 *     This is the model VeilPay uses for its `x-api-key` /
 *     `x-signature` / `x-timestamp` request envelope.
 */
const JWT_LIBRARY_PATTERN = /\bfrom\s+['"](?:jsonwebtoken|jose)['"]/;
const JWT_CALL_PATTERN = /\bjwt\.(?:sign|verify)\b/;
const HMAC_TIMESTAMP_WINDOW_PATTERNS: readonly RegExp[] = [
  /\b300_000\b/,
  /\b300000\b/,
  /\b5\s*\*\s*60\s*\*\s*1000\b/,
  /\b5\s*\*\s*60_000\b/,
];
const HMAC_NONCE_PATTERNS: readonly RegExp[] = [
  /auth:nonce:/,
  /\breplay\b/i,
  /\bsetex\b/,
];

/**
 * Allowed JWT signing algorithms (Requirement 6.11 expects an asymmetric
 * algorithm or HS256 with rotation; the design table lists RS256/ES256/HS256
 * as acceptable values).
 */
const JWT_ALG_PATTERN =
  /algorithm\s*:\s*['"](RS256|ES256|HS256|RS384|RS512|ES384|ES512|HS384|HS512)['"]/;

/**
 * JWT TTL indicator — the `expiresIn:` option used by `jsonwebtoken.sign`
 * and equivalent helpers.
 */
const JWT_TTL_PATTERN = /expiresIn\s*:/;

/**
 * Refresh-token strategy indicator. Matches both `refreshToken` and
 * `refresh_token` so snake_case database columns also count.
 */
const JWT_REFRESH_PATTERN = /\brefresh[_-]?token/i;

/**
 * Server bootstrap candidate filenames, relative to `apps/backend/src/`.
 * The first candidate that exists on disk is used for the rate-limiting and
 * CORS checks (mirrors the task wording: "grep `apps/backend/src/index.ts`,
 * `app.ts`, `server.ts`, `main.ts`").
 */
const BOOTSTRAP_CANDIDATES = ['index.ts', 'app.ts', 'server.ts', 'main.ts'] as const;

/**
 * Synthetic `routePath` labels for aggregate (non-per-route) checks. Wrapped
 * in angle brackets so they cannot collide with a real workspace-relative
 * path and the Pass 4 renderer can recognize them.
 */
const BOOTSTRAP_ROUTE_PATH = '<bootstrap>' as const;
const JWT_ROUTE_PATH = '<jwt-config>' as const;

// =====================================================================
// Public entry point
// =====================================================================

/**
 * Walk every backend route file plus the server bootstrap and JWT config,
 * and emit one `RouteCheckResult` per route per applicable check.
 *
 * The function is fully async because every read goes through `fs.readFile`
 * (no synchronous IO) and the bootstrap / JWT walks may inspect many files.
 * The function never writes — even if a candidate file is missing it returns
 * a failed `RouteCheckResult` with `sourcePath: ''` instead of throwing.
 */
export async function runRouteVerifier(
  input: RouteVerifierInput,
): Promise<RouteVerifierOutput> {
  const { workspaceRoot, backendRoutes } = input;

  const results: RouteCheckResult[] = [];

  // 1. Per-webhook-route checks. Build the route corpus (route + imported
  //    controllers / middleware) so checks see the full reachable
  //    handler, not just the route registration file.
  for (const route of backendRoutes.webhooks) {
    const routeFile = await loadRouteFile(workspaceRoot, route);
    const corpus = await expandRouteCorpus(workspaceRoot, routeFile);
    results.push(
      checkWebhookSignature(route, corpus),
      checkWebhookTimestamp(route, corpus),
      checkSchemaValidation(route, corpus),
    );
  }

  // 2. Per-authenticated-route checks (merchant / invoice / admin).
  const authedSurfaces: ReadonlyArray<readonly string[]> = [
    backendRoutes.merchant,
    backendRoutes.invoice,
    backendRoutes.admin,
  ];
  for (const surface of authedSurfaces) {
    for (const route of surface) {
      const routeFile = await loadRouteFile(workspaceRoot, route);
      const corpus = await expandRouteCorpus(workspaceRoot, routeFile);
      results.push(
        checkAuth(route, corpus),
        checkScope(route, corpus),
        checkSchemaValidation(route, corpus),
      );
    }
  }

  // 3. Server bootstrap checks (rate limiting + CORS allow-list).
  const bootstrapFile = await loadFirstExisting(
    workspaceRoot,
    BOOTSTRAP_CANDIDATES.map((name) => path.posix.join('apps/backend/src', name)),
  );
  const rateLimiting = checkRateLimiting(bootstrapFile);
  const cors = checkCors(bootstrapFile);
  results.push(rateLimiting, cors);

  // 4. Auth-model checks. The codebase may use JWT (in which case we
  //    require alg + ttl + refresh declarations) OR an HMAC+nonce
  //    request-signing model (in which case we require an HMAC primitive,
  //    a 5-minute timestamp window, and a replay nonce). Either model
  //    satisfies Requirement 6.11.
  const backendSrcAbs = path.resolve(workspaceRoot, 'apps/backend/src');
  const jwtCorpus = await loadBackendCorpus(backendSrcAbs);
  const alg = checkJwtAlg(jwtCorpus);
  const ttl = checkJwtTtl(jwtCorpus);
  const refresh = checkJwtRefresh(jwtCorpus);
  results.push(alg, ttl, refresh);

  return {
    results,
    bootstrap: { rateLimiting, cors },
    jwt: { alg, ttl, refresh },
  };
}

// =====================================================================
// File loading helpers
// =====================================================================

/**
 * Loaded representation of a single source file. `text` is empty and
 * `absolutePath` is `''` when the file was missing on disk; callers detect
 * this by checking `exists`.
 */
interface LoadedFile {
  readonly relativePath: string;
  readonly absolutePath: string;
  readonly text: string;
  readonly exists: boolean;
}

/**
 * Expanded route corpus — a route file plus every controller / middleware
 * file it imports. Pass 2 originally read only the route file, but real
 * Express apps overwhelmingly delegate auth, scope, schema validation,
 * and HMAC checks into a `controllers/` or `middleware/` module. Greppping
 * the route file alone produced a flood of false-positive "missing scope
 * check" / "missing schema validation" findings (the 2026-05-29 audit run
 * surfaced six of them). Walking the imports and grepping the union
 * eliminates that whole class of false positives without adding network
 * I/O or heavy AST machinery.
 */
interface RouteCorpus {
  readonly routeFile: LoadedFile;
  /** All loaded files contributing to the corpus, route file first. */
  readonly files: readonly LoadedFile[];
  /** Concatenation of every loaded file's text, joined with `\n\n`. */
  readonly combinedText: string;
}

/**
 * Load one route file from disk. Treats a missing file as a soft failure —
 * the verifier emits `pass: false` results referencing the missing path
 * rather than aborting the audit.
 */
async function loadRouteFile(
  workspaceRoot: string,
  relativePath: string,
): Promise<LoadedFile> {
  const absolutePath = path.resolve(workspaceRoot, relativePath);
  try {
    const text = await fs.readFile(absolutePath, 'utf8');
    return { relativePath, absolutePath, text, exists: true };
  } catch {
    return { relativePath, absolutePath: '', text: '', exists: false };
  }
}

/**
 * Try each candidate path in order and return the first one that loads
 * successfully. When none exist the returned `LoadedFile` has
 * `exists: false` and an empty text body — the bootstrap checks then emit
 * `pass: false` with a "no bootstrap file found" reason.
 */
async function loadFirstExisting(
  workspaceRoot: string,
  candidates: readonly string[],
): Promise<LoadedFile> {
  for (const candidate of candidates) {
    const file = await loadRouteFile(workspaceRoot, candidate);
    if (file.exists) {
      return file;
    }
  }
  return {
    relativePath: candidates.join(' | '),
    absolutePath: '',
    text: '',
    exists: false,
  };
}

/**
 * Walk a route file's `import { ... } from '<relative>'` statements and
 * load every controller / middleware / schema module it depends on,
 * resolving `.ts` and `.tsx` extensions when the import is unsuffixed.
 *
 * Heuristic boundaries:
 *   - Only relative imports (`./` or `../`) are followed; package imports
 *     (`zod`, `express`, …) are noise we already detect via SCHEMA_PATTERNS.
 *   - Only paths whose resolved relative path starts with `apps/` or
 *     `packages/` are loaded — keeps us out of `node_modules` even when a
 *     route happens to import via a workspace alias.
 *   - The walk is two levels deep (route → controller → lib helpers).
 *     A single hop misses the common shape where a route file imports a
 *     controller and the controller delegates the actual primitive call
 *     into `lib/auth.ts` / `lib/onramp.ts` / `types/index.ts`. Two hops
 *     is enough to find those primitives without quadratically chasing
 *     through every utility file the controller transitively touches.
 */
async function expandRouteCorpus(
  workspaceRoot: string,
  routeFile: LoadedFile,
): Promise<RouteCorpus> {
  if (!routeFile.exists) {
    return {
      routeFile,
      files: [routeFile],
      combinedText: routeFile.text,
    };
  }

  const seen = new Set<string>([routeFile.relativePath]);
  const dependencyFiles: LoadedFile[] = [];
  /**
   * `frontier` is the set of newly-loaded files whose imports we have not
   * yet expanded. We process two BFS waves — that's "two hops". Going
   * deeper would risk over-counting in unrelated business logic; one hop
   * misses common shapes like route → controller → lib.
   */
  let frontier: LoadedFile[] = [routeFile];
  const MAX_HOPS = 2;

  for (let hop = 0; hop < MAX_HOPS && frontier.length > 0; hop += 1) {
    const next: LoadedFile[] = [];
    for (const fromFile of frontier) {
      const importPaths = extractRelativeImports(fromFile.text);
      const fromDirRel = path.posix.dirname(fromFile.relativePath);
      for (const rawImport of importPaths) {
        const candidates = resolveImportCandidates(fromDirRel, rawImport);
        for (const candidate of candidates) {
          if (seen.has(candidate)) continue;
          const loaded = await loadRouteFile(workspaceRoot, candidate);
          if (loaded.exists) {
            dependencyFiles.push(loaded);
            seen.add(candidate);
            next.push(loaded);
            break; // First existing extension wins per import.
          }
        }
      }
    }
    frontier = next;
  }

  const files = [routeFile, ...dependencyFiles];
  const combinedText = files.map((f) => f.text).join('\n\n');
  return { routeFile, files, combinedText };
}

/**
 * Extract every `from '<relative>'` substring that begins with `./` or
 * `../`. Stays at the regex level on purpose: a real TS parser would
 * cost more than the false-positive reduction is worth, and Express
 * route files almost universally use simple top-level imports.
 */
function extractRelativeImports(text: string): readonly string[] {
  const out: string[] = [];
  // Matches `import ... from '<path>'` and `import('<path>')` dynamic forms.
  const re = /\bfrom\s+['"](\.[^'"\n]+)['"]|import\s*\(\s*['"](\.[^'"\n]+)['"]/g;
  for (;;) {
    const match = re.exec(text);
    if (match === null) break;
    const importPath = match[1] ?? match[2];
    if (typeof importPath === 'string' && importPath.length > 0) {
      out.push(importPath);
    }
  }
  return out;
}

/**
 * Given a workspace-relative directory and a relative import string,
 * produce candidate workspace-relative file paths to try in order.
 * Mirrors TypeScript's "ts → tsx → /index.ts" extension resolution.
 */
function resolveImportCandidates(
  routeDirRel: string,
  importPath: string,
): readonly string[] {
  const joined = path.posix.normalize(path.posix.join(routeDirRel, importPath));
  // Reject imports that escape the workspace (rare, but possible via deep
  // relative paths). Anything starting with `..` after normalize means we
  // climbed above the workspace root.
  if (joined.startsWith('..')) {
    return [];
  }
  if (path.posix.extname(joined) !== '') {
    return [joined];
  }
  return [
    `${joined}.ts`,
    `${joined}.tsx`,
    `${joined}/index.ts`,
    `${joined}/index.tsx`,
  ];
}

/**
 * Concatenated corpus of every `.ts` file under `apps/backend/src`. Used by
 * the JWT checks because signing config can live anywhere — `lib/auth.ts`,
 * `services/token.ts`, controller files — and we only need a single
 * aggregate match to mark the policy as present.
 *
 * The corpus is bounded by the size of the backend `src` tree; each file is
 * read once via `fs.readFile`. Files that fail to read are skipped silently
 * (they cannot match anyway). `node_modules` is excluded by directory name.
 */
async function loadBackendCorpus(srcAbsolutePath: string): Promise<string> {
  const files = await listTypeScriptFiles(srcAbsolutePath);
  const buffers: string[] = [];
  for (const file of files) {
    try {
      buffers.push(await fs.readFile(file, 'utf8'));
    } catch {
      // Skip unreadable files — they cannot satisfy any pattern.
    }
  }
  return buffers.join('\n');
}

/**
 * Recursively enumerate `.ts` files under `dir`. Skips `node_modules` and
 * any directory whose name starts with a dot to avoid scanning build caches
 * such as `.turbo`. Returns an empty array if the root is missing so a
 * stripped-down workspace fixture still runs.
 */
async function listTypeScriptFiles(dir: string): Promise<string[]> {
  const out: string[] = [];

  async function walk(current: string): Promise<void> {
    let entries: Dirent[];
    try {
      entries = (await fs.readdir(current, { withFileTypes: true })) as Dirent[];
    } catch {
      return;
    }
    for (const entry of entries) {
      const name = entry.name;
      if (name === 'node_modules' || name.startsWith('.')) {
        continue;
      }
      const full = path.join(current, name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile() && name.endsWith('.ts')) {
        out.push(full);
      }
    }
  }

  await walk(dir);
  return out;
}

// =====================================================================
// Per-route checks
// =====================================================================

/**
 * `webhook-signature` heuristic.
 *
 * Two-stage check, matching the task wording:
 *   1. The file references at least one of the signature middleware names
 *      or HMAC primitives (`WEBHOOK_SIGNATURE_PATTERNS`).
 *   2. The middleware is registered before the handler — approximated as
 *      either `router.use(...)` containing one of the pattern names earlier
 *      than any `router.post(`, OR the signature middleware appearing as
 *      an argument inside a `router.post('/path', signatureMw, handler)`
 *      call (the canonical Express style).
 *
 * The position check is intentionally lenient: a missing position match
 * still passes when the middleware name is present, but the reason field
 * notes that registration order could not be confirmed. The Pass 3
 * synthesizer treats the absence of any signature reference as a High-floor
 * finding (Requirement 6.6).
 */
function checkWebhookSignature(
  routePath: string,
  corpus: RouteCorpus,
): RouteCheckResult {
  const file = corpus.routeFile;
  if (!file.exists) {
    return missingFile(routePath, 'webhook-signature');
  }

  const matched = matchAny(corpus.combinedText, WEBHOOK_SIGNATURE_PATTERNS);
  if (matched === null) {
    return {
      routePath,
      sourcePath: file.absolutePath,
      check: 'webhook-signature',
      pass: false,
      reason:
        'No webhook signature middleware reference (verifySignature/verifyWebhookSignature/HMAC) found in route file or its imported controllers.',
    };
  }

  const positionOk = signatureRegistrationOrderOk(file.text, matched);
  return {
    routePath,
    sourcePath: file.absolutePath,
    check: 'webhook-signature',
    pass: true,
    reason: positionOk
      ? `Signature middleware "${matched.source}" registered before route handler.`
      : `Signature middleware "${matched.source}" reachable from route corpus; registration order could not be confirmed by static heuristic.`,
  };
}

/**
 * Approximate "registered before the handler" by either:
 *   - finding a `router.use(...<sig>...)` call at a lower file offset than
 *     the first `router.post(`, OR
 *   - finding a `router.post('/path', <sig>, handler)` call where `<sig>`
 *     appears as a positional argument before the handler.
 */
function signatureRegistrationOrderOk(text: string, sig: RegExp): boolean {
  const useMatch = new RegExp(`router\\.use\\s*\\([^)]*${sig.source}[^)]*\\)`).exec(text);
  const postMatch = /router\.post\s*\(/.exec(text);

  if (useMatch !== null && postMatch !== null && useMatch.index < postMatch.index) {
    return true;
  }

  // Inline middleware in router.post('/path', sigMw, handler) form.
  const inlineRegex = new RegExp(
    `router\\.(?:post|get|put|patch|delete)\\s*\\([^)]*${sig.source}[^)]*\\)`,
  );
  return inlineRegex.test(text);
}

/**
 * `webhook-timestamp` heuristic — pure text search for a 5-minute window
 * (`5 * 60`, `300_000`, `300000`, or `MAX_WEBHOOK_AGE_MS`).
 */
function checkWebhookTimestamp(
  routePath: string,
  corpus: RouteCorpus,
): RouteCheckResult {
  const file = corpus.routeFile;
  if (!file.exists) {
    return missingFile(routePath, 'webhook-timestamp');
  }

  const matched = matchAny(corpus.combinedText, WEBHOOK_TIMESTAMP_PATTERNS);
  return {
    routePath,
    sourcePath: file.absolutePath,
    check: 'webhook-timestamp',
    pass: matched !== null,
    reason:
      matched !== null
        ? `5-minute timestamp window found via pattern "${matched.source}".`
        : 'No 5-minute webhook timestamp window literal (5 * 60, 300_000, 300000, MAX_WEBHOOK_AGE_MS) found in route file or its imported controllers.',
  };
}

/**
 * `auth` heuristic — file references one of the documented auth middlewares
 * (`AUTH_PATTERNS`). The fail case is a Critical-floor finding for
 * merchant/invoice/admin routes per Requirement 6.7.
 */
function checkAuth(routePath: string, corpus: RouteCorpus): RouteCheckResult {
  const file = corpus.routeFile;
  if (!file.exists) {
    return missingFile(routePath, 'auth');
  }

  const matched = matchAny(corpus.combinedText, AUTH_PATTERNS);
  return {
    routePath,
    sourcePath: file.absolutePath,
    check: 'auth',
    pass: matched !== null,
    reason:
      matched !== null
        ? `Auth middleware reference "${matched.source}" present.`
        : 'No auth middleware (authMiddleware/requireAuth/passport.authenticate/verifyJwt) reference found in route file or its imported controllers.',
  };
}

/**
 * `scope` heuristic — file references one of the documented scope/role
 * helpers, or the `req.user.merchantId` tenancy guard. Failure here pairs
 * with auth: a route that authenticates but has no scope check still fails
 * Requirement 6.7's "auth boundaries on every merchant/invoice/admin
 * endpoint".
 */
function checkScope(routePath: string, corpus: RouteCorpus): RouteCheckResult {
  const file = corpus.routeFile;
  if (!file.exists) {
    return missingFile(routePath, 'scope');
  }

  const matched = matchAny(corpus.combinedText, SCOPE_PATTERNS);
  return {
    routePath,
    sourcePath: file.absolutePath,
    check: 'scope',
    pass: matched !== null,
    reason:
      matched !== null
        ? `Scope/permission check "${matched.source}" present.`
        : 'No scope/role/permission check (requireScope/hasRole/checkPermission/req.user.merchantId) found in route file or its imported controllers.',
  };
}

/**
 * `schema-validation` heuristic — file imports one of the supported
 * validation libraries or invokes a `validateRequest(<schema>)` helper.
 * Missing schema validation is a Medium-floor finding per Requirement 6.9.
 */
function checkSchemaValidation(
  routePath: string,
  corpus: RouteCorpus,
): RouteCheckResult {
  const file = corpus.routeFile;
  if (!file.exists) {
    return missingFile(routePath, 'schema-validation');
  }

  const matched = matchAny(corpus.combinedText, SCHEMA_PATTERNS);
  return {
    routePath,
    sourcePath: file.absolutePath,
    check: 'schema-validation',
    pass: matched !== null,
    reason:
      matched !== null
        ? `Schema validation reference "${matched.source}" present.`
        : 'No schema validation library (zod/joi/yup) or validateRequest(<schema>) helper found in route file or its imported controllers.',
  };
}

// =====================================================================
// Bootstrap checks
// =====================================================================

/**
 * `rate-limiting` heuristic — server bootstrap mentions an `express-rate-
 * limit` / `fastify-rate-limit` import or a `rateLimit(`/`rateLimiter` call.
 */
function checkRateLimiting(file: LoadedFile): RouteCheckResult {
  if (!file.exists) {
    return {
      routePath: BOOTSTRAP_ROUTE_PATH,
      sourcePath: '',
      check: 'rate-limiting',
      pass: false,
      reason:
        'No server bootstrap file (apps/backend/src/{index,app,server,main}.ts) found to inspect for rate limiting.',
    };
  }

  const matched = matchAny(file.text, RATE_LIMIT_PATTERNS);
  return {
    routePath: BOOTSTRAP_ROUTE_PATH,
    sourcePath: file.absolutePath,
    check: 'rate-limiting',
    pass: matched !== null,
    reason:
      matched !== null
        ? `Rate-limiting middleware reference "${matched.source}" present in ${file.relativePath}.`
        : `No rate-limiting reference (express-rate-limit/fastify-rate-limit/rateLimit) found in ${file.relativePath}.`,
  };
}

/**
 * `cors` heuristic.
 *
 * Per the task wording, fail when the bootstrap contains `origin: '*'` or
 * `origin: true`. Otherwise, a `cors(` invocation is treated as evidence of
 * an allow-list (string, array, function, or indirect config object). When
 * neither a wildcard nor a `cors(` call is present, fail with a "no CORS
 * configuration" reason.
 */
function checkCors(file: LoadedFile): RouteCheckResult {
  if (!file.exists) {
    return {
      routePath: BOOTSTRAP_ROUTE_PATH,
      sourcePath: '',
      check: 'cors',
      pass: false,
      reason:
        'No server bootstrap file (apps/backend/src/{index,app,server,main}.ts) found to inspect for CORS allow-list.',
    };
  }

  const wildcard = matchAny(file.text, CORS_WILDCARD_PATTERNS);
  if (wildcard !== null) {
    return {
      routePath: BOOTSTRAP_ROUTE_PATH,
      sourcePath: file.absolutePath,
      check: 'cors',
      pass: false,
      reason: `Permissive CORS origin detected via pattern "${wildcard.source}" in ${file.relativePath}.`,
    };
  }

  if (CORS_INVOCATION_PATTERN.test(file.text)) {
    return {
      routePath: BOOTSTRAP_ROUTE_PATH,
      sourcePath: file.absolutePath,
      check: 'cors',
      pass: true,
      reason: `CORS configured via cors(...) invocation in ${file.relativePath}; no wildcard origin detected.`,
    };
  }

  return {
    routePath: BOOTSTRAP_ROUTE_PATH,
    sourcePath: file.absolutePath,
    check: 'cors',
    pass: false,
    reason: `No CORS configuration found in ${file.relativePath}.`,
  };
}

// =====================================================================
// JWT/session checks
// =====================================================================

/**
 * Result of classifying a backend's auth model from its source corpus.
 *
 * `kind`:
 *   - `'jwt'`      — backend imports a JWT library or invokes
 *                    `jwt.sign(`/`jwt.verify(` somewhere.
 *   - `'hmac'`     — backend implements an HMAC + nonce request envelope:
 *                    a `createHmac(...)` call AND a 5-minute timestamp
 *                    window AND a nonce/replay primitive.
 *   - `'unknown'`  — neither model could be detected.
 */
type AuthModelKind = 'jwt' | 'hmac' | 'unknown';

/**
 * Classify the backend auth model so the JWT alg/ttl/refresh probes can
 * recognise an HMAC + nonce stack as a valid alternative. The HMAC + nonce
 * stack — used by VeilPay's `x-api-key` / `x-signature` / `x-timestamp`
 * envelope — provides the same security properties as JWT alg/ttl/refresh
 * (algorithm fixed by SHA-256 HMAC, freshness enforced by the timestamp
 * window, replay invalidation via the nonce TTL), so a hard JWT-only check
 * misclassifies it as missing every JWT primitive.
 */
function classifyAuthModel(corpus: string): AuthModelKind {
  const usesJwt = JWT_LIBRARY_PATTERN.test(corpus) || JWT_CALL_PATTERN.test(corpus);
  if (usesJwt) {
    return 'jwt';
  }
  const hasHmac = /\bcreateHmac\s*\(/.test(corpus);
  const hasWindow = HMAC_TIMESTAMP_WINDOW_PATTERNS.some((p) => p.test(corpus));
  const hasNonce = HMAC_NONCE_PATTERNS.some((p) => p.test(corpus));
  if (hasHmac && hasWindow && hasNonce) {
    return 'hmac';
  }
  return 'unknown';
}

/**
 * `jwt-alg` heuristic — any file under `apps/backend/src` declares a
 * supported signing algorithm (RS256/ES256/HS256 and the larger keysize
 * variants). When the backend uses an HMAC + nonce request envelope
 * instead of JWT, the check passes because SHA-256 HMAC is the de-facto
 * declared algorithm in that model.
 */
function checkJwtAlg(corpus: string): RouteCheckResult {
  const model = classifyAuthModel(corpus);
  const match = JWT_ALG_PATTERN.exec(corpus);
  if (match !== null) {
    return {
      routePath: JWT_ROUTE_PATH,
      sourcePath: '',
      check: 'jwt-alg',
      pass: true,
      reason: `JWT signing algorithm "${match[1] ?? '(captured)'}" declared in backend source.`,
    };
  }
  if (model === 'hmac') {
    return {
      routePath: JWT_ROUTE_PATH,
      sourcePath: '',
      check: 'jwt-alg',
      pass: true,
      reason:
        'Backend uses an HMAC + nonce request-signing model (createHmac + timestamp window + nonce); SHA-256 HMAC is the implicit signing algorithm and JWT alg declaration is not applicable.',
    };
  }
  return {
    routePath: JWT_ROUTE_PATH,
    sourcePath: '',
    check: 'jwt-alg',
    pass: false,
    reason:
      'No JWT signing algorithm (RS256/ES256/HS256) declared and no HMAC+nonce auth model detected in apps/backend/src.',
  };
}

/**
 * `jwt-ttl` heuristic — backend source declares an `expiresIn:` option for
 * a sign call. Presence of any TTL is enough to pass; the exact value is
 * left for downstream Pass 3 enrichment. When the backend uses an HMAC +
 * nonce envelope, the timestamp window itself is the TTL: a request older
 * than 5 minutes is rejected at the boundary.
 */
function checkJwtTtl(corpus: string): RouteCheckResult {
  const model = classifyAuthModel(corpus);
  const present = JWT_TTL_PATTERN.test(corpus);
  if (present) {
    return {
      routePath: JWT_ROUTE_PATH,
      sourcePath: '',
      check: 'jwt-ttl',
      pass: true,
      reason: 'JWT TTL declared via "expiresIn:" option in backend source.',
    };
  }
  if (model === 'hmac') {
    return {
      routePath: JWT_ROUTE_PATH,
      sourcePath: '',
      check: 'jwt-ttl',
      pass: true,
      reason:
        'Backend uses an HMAC + nonce request-signing model; the 5-minute timestamp window is the per-request TTL and JWT expiresIn is not applicable.',
    };
  }
  return {
    routePath: JWT_ROUTE_PATH,
    sourcePath: '',
    check: 'jwt-ttl',
    pass: false,
    reason:
      'No JWT TTL ("expiresIn:") declared and no HMAC+nonce timestamp window detected in apps/backend/src.',
  };
}

/**
 * `jwt-refresh` heuristic — backend source mentions a refresh-token flow.
 * Matches both `refreshToken` and `refresh_token`. When the backend uses
 * an HMAC + nonce envelope, every request is independently signed against
 * the API key, so there is no long-lived session to refresh and the check
 * is satisfied by the nonce-based replay guard.
 */
function checkJwtRefresh(corpus: string): RouteCheckResult {
  const model = classifyAuthModel(corpus);
  const present = JWT_REFRESH_PATTERN.test(corpus);
  if (present) {
    return {
      routePath: JWT_ROUTE_PATH,
      sourcePath: '',
      check: 'jwt-refresh',
      pass: true,
      reason: 'Refresh-token flow referenced in backend source.',
    };
  }
  if (model === 'hmac') {
    return {
      routePath: JWT_ROUTE_PATH,
      sourcePath: '',
      check: 'jwt-refresh',
      pass: true,
      reason:
        'Backend uses an HMAC + nonce request-signing model; every request is independently signed and replay-guarded, so a refresh-token flow is not applicable.',
    };
  }
  return {
    routePath: JWT_ROUTE_PATH,
    sourcePath: '',
    check: 'jwt-refresh',
    pass: false,
    reason:
      'No refresh-token flow (refreshToken/refresh_token) referenced and no HMAC+nonce auth model detected in apps/backend/src.',
  };
}

// =====================================================================
// Generic helpers
// =====================================================================

/**
 * Return the first regex from `patterns` that matches `text`, or `null` if
 * none match. Returning the regex itself (rather than just a boolean) lets
 * callers quote the matching pattern's source into the `reason` string for
 * audit traceability.
 */
function matchAny(text: string, patterns: readonly RegExp[]): RegExp | null {
  for (const pattern of patterns) {
    if (pattern.test(text)) {
      return pattern;
    }
  }
  return null;
}

/**
 * Build a `RouteCheckResult` for a missing route source file. The Pass 3
 * synthesizer interprets a missing file as a hard fail of every applicable
 * check rather than a probe error, since Discovery already inventoried the
 * route paths from the live workspace.
 */
function missingFile(
  routePath: string,
  check: RouteCheckKind,
): RouteCheckResult {
  return {
    routePath,
    sourcePath: '',
    check,
    pass: false,
    reason: `Route file ${routePath} could not be read; check could not be performed.`,
  };
}
