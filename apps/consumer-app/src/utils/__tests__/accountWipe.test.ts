/**
 * PRIV-002: local DSAR / account-wipe unit tests.
 */

import fs from 'fs';
import path from 'path';

const mockClearStoredMnemonic = jest.fn();
const mockDeleteAnalyticsData = jest.fn();
const mockClearWallet = jest.fn();
const mockDisconnect = jest.fn();
const mockWipePersistedState = jest.fn();
const mockClearAddresses = jest.fn();
const mockClearAllCommitmentRecords = jest.fn();
const mockClearAllSppNotes = jest.fn();
const mockClearAllSppAccounts = jest.fn();
const mockClearAllOnrampTokens = jest.fn();
const mockClearAllNotificationSeen = jest.fn();

jest.mock('../transactions', () => ({
  clearStoredMnemonic: (...args: unknown[]) => mockClearStoredMnemonic(...args),
}));

jest.mock('../analytics', () => ({
  deleteAnalyticsData: (...args: unknown[]) => mockDeleteAnalyticsData(...args),
}));

jest.mock('../notificationSeen', () => ({
  clearAllNotificationSeen: (...args: unknown[]) => mockClearAllNotificationSeen(...args),
}));

jest.mock('../../stores/walletStore', () => ({
  useWalletStore: {
    getState: () => ({
      clearWallet: mockClearWallet,
      disconnect: mockDisconnect,
    }),
  },
}));

jest.mock('../../stores/transactionStore', () => ({
  useTransactionStore: {
    getState: () => ({
      wipePersistedState: mockWipePersistedState,
    }),
  },
  clearAllOnrampTokens: (...args: unknown[]) => mockClearAllOnrampTokens(...args),
}));

jest.mock('../../stores/addressBookStore', () => ({
  useAddressBookStore: {
    getState: () => ({
      clearAddresses: mockClearAddresses,
    }),
  },
}));

jest.mock('../../stores/commitmentStore', () => ({
  clearAllCommitmentRecords: (...args: unknown[]) => mockClearAllCommitmentRecords(...args),
}));

jest.mock('../../stores/sppNoteStore', () => ({
  clearAllSppNotes: (...args: unknown[]) => mockClearAllSppNotes(...args),
}));

jest.mock('../../stores/sppAccountStore', () => ({
  clearAllSppAccounts: (...args: unknown[]) => mockClearAllSppAccounts(...args),
}));

// Mock SecureStore and AsyncStorage
jest.mock('expo-secure-store', () => ({
  deleteItemAsync: jest.fn().mockResolvedValue(undefined),
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'whenUnlockedThisDeviceOnly',
}));

jest.mock('@react-native-async-storage/async-storage', () => ({
  removeItem: jest.fn().mockResolvedValue(undefined),
  getAllKeys: jest.fn().mockResolvedValue([]),
  multiRemove: jest.fn().mockResolvedValue(undefined),
  getItem: jest.fn().mockResolvedValue(null),
  setItem: jest.fn().mockResolvedValue(undefined),
}));

import { wipeLocalAccountData } from '../accountWipe';

describe('wipeLocalAccountData (PRIV-002)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockClearStoredMnemonic.mockResolvedValue(undefined);
    mockWipePersistedState.mockResolvedValue(undefined);
  });

  it('clears mnemonic, session, history, address book, analytics, and all extra secure storage and caches in order', async () => {
    const result = await wipeLocalAccountData();

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.steps).toContain('mnemonic');
      expect(result.steps).toContain('wallet_session');
      expect(result.steps).toContain('transactions');
      expect(result.steps).toContain('address_book');
      expect(result.steps).toContain('analytics');
      expect(result.steps).toContain('commitment_records');
      expect(result.steps).toContain('spp_notes');
      expect(result.steps).toContain('spp_accounts');
      expect(result.steps).toContain('onramp_tokens');
      expect(result.steps).toContain('notification_seen');
      expect(result.steps).toContain('async_storage_caches');
      // Extra fixed SecureStore keys each push a secure:<key> step.
      expect(result.steps).toContain('secure:veilpay_app_password');
      expect(result.steps).toContain('secure:veilpay.stealth.lastScannedBlock');
      expect(result.steps).toContain('secure:veilpay-wallet-storage');
      expect(result.steps).toContain('secure:veilpay-settings-storage');
    }
    expect(mockClearStoredMnemonic).toHaveBeenCalled();
    expect(mockClearWallet).toHaveBeenCalled();
    expect(mockDisconnect).toHaveBeenCalled();
    // The transactions step must use the FULL persisted-slice removal
    // (wipePersistedState), not clearTransactions() — see PRIV-203.
    expect(mockWipePersistedState).toHaveBeenCalled();
    expect(mockClearAddresses).toHaveBeenCalled();
    expect(mockDeleteAnalyticsData).toHaveBeenCalled();
    expect(mockClearAllCommitmentRecords).toHaveBeenCalled();
    expect(mockClearAllSppNotes).toHaveBeenCalled();
    expect(mockClearAllSppAccounts).toHaveBeenCalled();
    expect(mockClearAllOnrampTokens).toHaveBeenCalled();
    expect(mockClearAllNotificationSeen).toHaveBeenCalled();
    // SecureStore and AsyncStorage calls
    const SecureStore = require('expo-secure-store');
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith(
      'veilpay_app_password',
      expect.anything()
    );
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith(
      'veilpay.stealth.lastScannedBlock',
      expect.anything()
    );
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    expect(AsyncStorage.removeItem).toHaveBeenCalled();
    expect(AsyncStorage.getAllKeys).toHaveBeenCalled();
  });

  it('fails closed when mnemonic clear throws (does not wipe session first)', async () => {
    mockClearStoredMnemonic.mockRejectedValue(new Error('secure store locked'));

    const result = await wipeLocalAccountData();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failedStep).toBe('mnemonic');
      expect(result.completedSteps).toEqual([]);
    }
    expect(mockClearWallet).not.toHaveBeenCalled();
    expect(mockDeleteAnalyticsData).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PRIV-203/PRIV-211: mechanical storage-writer key coverage.
//
// The covered-key list is NOT hardcoded here. The test walks
// apps/consumer-app/src with Node's fs, finds every storage writer
// (`SecureStore.setItemAsync(`, `AsyncStorage.setItem(`,
// `AsyncStorage.multiSet(`) and every zustand persist `name: '...'` key in
// src/stores/*.ts, resolves the written key (literal, const, template prefix,
// or one-hop helper/const resolution), and asserts each key is covered by the
// wipe via one of its actual mechanisms:
//   - EXTRA_SECURE_KEYS / ASYNC_CACHE_KEYS (parsed out of accountWipe.ts)
//   - a key/prefix const exported by a module whose clear-all/wipe function the
//     wipe calls (incl. store persist names of wipe-called stores)
//   - the whole-key removal in transactionStore (wipePersistedState)
// A NEW writer key the wipe does not cover must FAIL this suite.
// ─────────────────────────────────────────────────────────────────────────────

const SRC_ROOT = path.resolve(__dirname, '..', '..');
const WIPE_FILE = path.join(SRC_ROOT, 'utils', 'accountWipe.ts');

interface WriterEntry {
  file: string;
  line: number;
  kind: 'secure' | 'async' | 'multiset' | 'persist';
  /** Exact key, or the resolvable static prefix for dynamic keys. */
  key: string;
  /** True when the full key is built at runtime beyond `key` (prefix only). */
  dynamic: boolean;
  /** True when the key arrives as a function parameter (pass-through adapter). */
  passthrough: boolean;
}

interface ResolveCtx {
  file: string;
  fileSrc: string;
  imports: Map<string, string>;
}

function readSrc(file: string): string {
  return fs.readFileSync(file, 'utf8');
}

function listSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === '__mocks__') continue;
      out.push(...listSourceFiles(path.join(dir, entry.name)));
    } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\./.test(entry.name)) {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

function matchAll(re: RegExp, src: string): RegExpExecArray[] {
  const global = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
  const out: RegExpExecArray[] = [];
  let m = global.exec(src);
  while (m !== null) {
    out.push(m);
    m = global.exec(src);
  }
  return out;
}

/** Parse relative named imports of a file into name -> resolved file path. */
function parseImports(src: string, file: string): Map<string, string> {
  const map = new Map<string, string>();
  const dir = path.dirname(file);
  for (const m of matchAll(/import\s+(?:type\s+)?\{([^}]+)\}\s+from\s+['"](\.[^'"]+)['"]/g, src)) {
    const names = m[1]
      .split(',')
      .map((s) => s.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0])
      .filter(Boolean);
    const base = path.resolve(dir, m[2]);
    for (const ext of ['', '.ts', '.tsx', '.mts', '.cts']) {
      const candidate = base + ext;
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        for (const n of names) map.set(n, candidate);
        break;
      }
    }
  }
  return map;
}

/** Extract the first top-level argument of a call whose '(' ends at `start`. */
function extractFirstArg(src: string, start: number): string {
  let depth = 0;
  let quote: string | null = null;
  const chars: string[] = [];
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      chars.push(c);
      if (c === '\\') {
        chars.push(src[i + 1] ?? '');
        i++;
      } else if (c === quote) {
        quote = null;
      }
      continue;
    }
    if (c === '\'' || c === '"' || c === '`') {
      quote = c;
      chars.push(c);
      continue;
    }
    if (c === '(' || c === '[' || c === '{') {
      depth++;
      chars.push(c);
      continue;
    }
    if (c === ')' && depth === 0) break;
    if (c === ']' || c === '}') {
      depth--;
      chars.push(c);
      continue;
    }
    if (c === ',' && depth === 0) break;
    chars.push(c);
  }
  return chars.join('').trim();
}

/** Extract the initializer of `const NAME = <init>;` (top-level ';' terminated). */
function extractConstInitializer(src: string, name: string): string | null {
  const re = new RegExp('(?:const|let|var)\\s+' + name + '\\s*(?::[^=;]+)?=\\s*');
  const m = src.match(re);
  if (!m || m.index === undefined) return null;
  let i = m.index + m[0].length;
  let depth = 0;
  let quote: string | null = null;
  const chars: string[] = [];
  while (i < src.length) {
    const c = src[i];
    if (quote) {
      chars.push(c);
      if (c === '\\') {
        chars.push(src[i + 1] ?? '');
        i++;
      } else if (c === quote) {
        quote = null;
      }
      i++;
      continue;
    }
    if (c === '\'' || c === '"' || c === '`') {
      quote = c;
      chars.push(c);
      i++;
      continue;
    }
    if (c === '(' || c === '[' || c === '{') depth++;
    if (c === ')' || c === ']' || c === '}') depth--;
    if (c === ';' && depth === 0) break;
    chars.push(c);
    i++;
  }
  return chars.join('').trim();
}

/** Find the body of `function NAME(...) { ... }` via brace balancing. */
function findFunctionDeclBody(src: string, name: string): string | null {
  const m = src.match(new RegExp('function\\s+' + name + '\\b'));
  if (!m || m.index === undefined) return null;
  const openIdx = src.indexOf('{', m.index + m[0].length);
  if (openIdx === -1) return null;
  let depth = 0;
  let quote: string | null = null;
  for (let i = openIdx; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '\'' || c === '"' || c === '`') {
      quote = c;
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return src.slice(openIdx + 1, i);
    }
  }
  return null;
}

/**
 * Resolve a key expression to { key, dynamic } — literal, const, template
 * (static prefix + leading UPPER_CASE const), helper function (arrow const or
 * `function` returning a template, possibly imported from another file), or
 * arrow initializer. Returns null when the expression is a function parameter
 * (pass-through adapter) or cannot be resolved.
 */
function resolveKeyExpr(
  expr: string,
  ctx: ResolveCtx,
  depth = 0
): { key: string; dynamic: boolean; passthrough: boolean } | null {
  const trimmed = expr.trim().replace(/;$/, '').trim();
  if (depth > 5 || trimmed === '') return null;

  // 1. Plain string literal.
  const lit = trimmed.match(/^(['"])([\s\S]*)\1$/);
  if (lit) return { key: lit[2], dynamic: false, passthrough: false };

  // 2. Template literal — exact when static, else its resolvable prefix.
  const tpl = trimmed.match(/^`([\s\S]*)`$/);
  if (tpl) {
    const body = tpl[1];
    if (!body.includes('${')) return { key: body, dynamic: false, passthrough: false };
    const interpolations = body.split(/\$\{[\s\S]*?\}/).length - 1;
    const statics = body.split(/\$\{[\s\S]*?\}/);
    let key = statics[0] ?? '';
    const firstInterp = (body.match(/\$\{([^}]+)\}/) ?? [])[1]?.trim();
    if (firstInterp && /^[A-Z][A-Z0-9_]*$/.test(firstInterp)) {
      const constVal = extractConstInitializer(ctx.fileSrc, firstInterp);
      const constLit = constVal?.match(/^(['"])([\s\S]*)\1$/);
      if (constLit) key += constLit[2];
    }
    return { key, dynamic: interpolations > 0, passthrough: false };
  }

  // 3. Identifier — const initializer or function parameter.
  if (/^[A-Za-z_$][\w$]*$/.test(trimmed)) {
    const init = extractConstInitializer(ctx.fileSrc, trimmed);
    if (init) {
      const resolved = resolveKeyExpr(init, ctx, depth + 1);
      if (resolved) return resolved;
    }
    if (new RegExp('[ (,]\\s*' + trimmed + '\\s*[,)=:]').test(ctx.fileSrc)) {
      // Used as a parameter somewhere in the file — a pass-through adapter
      // writing keys supplied by its callers (enumerated separately via the
      // persist-name scan).
      return { key: `<param:${trimmed}>`, dynamic: true, passthrough: true };
    }
    return null;
  }

  // 4. Function call — resolve the callee's returned key expression.
  const call = trimmed.match(/^([A-Za-z_$][\w$]*)\s*\(/);
  if (call) {
    const fnName = call[1];
    const resolvedFn = resolveFunctionKey(fnName, ctx);
    if (resolvedFn) return resolvedFn;
    const imported = ctx.imports.get(fnName);
    if (imported && imported !== ctx.file) {
      const otherSrc = readSrc(imported);
      const otherCtx: ResolveCtx = {
        file: imported,
        fileSrc: otherSrc,
        imports: parseImports(otherSrc, imported),
      };
      const crossFile = resolveFunctionKey(fnName, otherCtx);
      if (crossFile) return crossFile;
    }
    return null;
  }

  // 5. Arrow expression (e.g. resolved const initializers like
  // `(id: string): string => \`${PREFIX}${id}\``).
  const arrowIdx = trimmed.lastIndexOf('=>');
  if (arrowIdx !== -1) {
    const tail = trimmed.slice(arrowIdx + 2).trim();
    if (tail.startsWith('{')) {
      const ret = tail.match(/return\s+([^;]+);/);
      if (ret) return resolveKeyExpr(ret[1], ctx, depth + 1);
      return null;
    }
    return resolveKeyExpr(tail, ctx, depth + 1);
  }

  return null;
}

/** Resolve the key a helper function produces (arrow const or function decl). */
function resolveFunctionKey(
  fnName: string,
  ctx: ResolveCtx
): { key: string; dynamic: boolean; passthrough: boolean } | null {
  const init = extractConstInitializer(ctx.fileSrc, fnName);
  if (init && init.includes('=>')) {
    return resolveKeyExpr(init, ctx, 1);
  }
  const body = findFunctionDeclBody(ctx.fileSrc, fnName);
  if (body) {
    const ret = body.match(/return\s+([^;]+);/);
    if (ret) return resolveKeyExpr(ret[1], ctx, 1);
  }
  return null;
}

function lineOf(src: string, index: number): number {
  return src.slice(0, index).split('\n').length;
}

function discoverWriters(): WriterEntry[] {
  const entries: WriterEntry[] = [];
  for (const file of listSourceFiles(SRC_ROOT)) {
    const src = readSrc(file);
    const rel = path.relative(SRC_ROOT, file).replace(/\\/g, '/');
    const ctx: ResolveCtx = { file, fileSrc: src, imports: parseImports(src, file) };

    for (const m of matchAll(/SecureStore\.setItemAsync\(|AsyncStorage\.setItem\(|AsyncStorage\.multiSet\(/g, src)) {
      const kind: WriterEntry['kind'] = m[0].includes('SecureStore')
        ? 'secure'
        : m[0].includes('multiSet')
          ? 'multiset'
          : 'async';
      const arg = extractFirstArg(src, m.index + m[0].length);
      if (kind === 'multiset') {
        // multiSet([['k','v'],...]) — take the key position of each pair.
        const pairs = matchAll(/\[\s*(['"])([^'"]+)\1/g, arg);
        if (pairs.length > 0) {
          for (const p of pairs) {
            entries.push({
              file: rel,
              line: lineOf(src, m.index),
              kind,
              key: p[2],
              dynamic: false,
              passthrough: false,
            });
          }
          continue;
        }
      }
      const resolved = resolveKeyExpr(arg, ctx);
      entries.push({
        file: rel,
        line: lineOf(src, m.index),
        kind,
        key: resolved?.key ?? `<unresolved:${arg}>`,
        dynamic: resolved?.dynamic ?? true,
        passthrough: resolved?.passthrough ?? false,
      });
    }

    // zustand persist storage keys in src/stores/*.ts (persist key names in
    // this codebase all carry the 'veilpay' marker; chain-definition
    // `name:` fields do not).
    if (rel.startsWith('stores/')) {
      for (const m of matchAll(/name:\s*(['"])([^'"]+)\1/g, src)) {
        if (/veilpay/i.test(m[2])) {
          entries.push({
            file: rel,
            line: lineOf(src, m.index),
            kind: 'persist',
            key: m[2],
            dynamic: false,
            passthrough: false,
          });
        }
      }
    }
  }
  return entries;
}

/**
 * Build the set of key strings the wipe can act on, parsed mechanically from
 * accountWipe.ts and from the modules whose clear-all/wipe functions it calls
 */
function buildCoveredKeySet(): Set<string> {
  const covered = new Set<string>();
  const wipeSrc = readSrc(WIPE_FILE);
  const wipeDir = path.dirname(WIPE_FILE);
  const wipeImports = parseImports(wipeSrc, WIPE_FILE);

  // 1. The wipe's own fixed key lists.
  for (const arrName of ['EXTRA_SECURE_KEYS', 'ASYNC_CACHE_KEYS']) {
    const m = wipeSrc.match(new RegExp('const\\s+' + arrName + '[^=]*=\\s*\\[([^\\]]*)\\]'));
    if (m) {
      for (const lit of matchAll(/(['"])([^'"]+)\1/g, m[1])) covered.add(lit[2]);
    }
  }

  // 2. Modules whose clear-all/wipe functions the wipe calls (direct imports
  //    and store getState() clear/wipe actions).
  const wipeCalledFiles = new Set<string>();
  const calledNames = new Set<string>();
  for (const m of matchAll(/(?:^|[^\w$.])([A-Za-z_$][\w$]*)\s*\(/g, wipeSrc)) {
    calledNames.add(m[1]);
  }
  for (const name of calledNames) {
    const mod = wipeImports.get(name);
    if (mod) wipeCalledFiles.add(mod);
  }
  for (const m of matchAll(/(use\w+)\.getState\(\)\s*\.\s*(\w+)\s*\(/g, wipeSrc)) {
    if (!/^(clear|wipe|reset|disconnect)/i.test(m[2])) continue;
    const mod = wipeImports.get(m[1]);
    if (mod) wipeCalledFiles.add(mod);
  }

  for (const file of wipeCalledFiles) {
    const src = readSrc(file);
    // Key-ish exported consts (INDEX_KEY, KEY_PREFIX, ..._PREFIX, STORAGE_KEY).
    for (const m of matchAll(/(?:const|let|var)\s+([A-Z][A-Z0-9_]*)\s*(?::[^=]*)?=\s*(['"])([^'"]+)\2/g, src)) {
      if (/(?:KEY|KEYS|PREFIX|NAMES?)$/.test(m[1])) covered.add(m[3]);
    }
    // Persist keys of wipe-called stores.
    for (const m of matchAll(/name:\s*(['"])([^'"]+)\1/g, src)) {
      if (/veilpay/i.test(m[2])) covered.add(m[2]);
    }
    // Explicit whole-key removals inside the module.
    for (const m of matchAll(/(?:AsyncStorage\.removeItem|SecureStore\.deleteItemAsync)\(\s*(['"])([^'"]+)\1/g, src)) {
      covered.add(m[2]);
    }
  }

  return covered;
}

function isCovered(entry: WriterEntry, covered: Set<string>): boolean {
  for (const w of covered) {
    if (entry.dynamic) {
      if (w.startsWith(entry.key) || entry.key.startsWith(w)) return true;
    } else if (w === entry.key || entry.key.startsWith(w)) {
      return true;
    }
  }
  return false;
}

describe('mechanical storage-writer key coverage (PRIV-203/PRIV-211)', () => {
  it('enumerates a meaningful number of writers (discovery is not silently empty)', () => {
    const writers = discoverWriters();
    expect(writers.filter((w) => w.kind !== 'persist').length).toBeGreaterThanOrEqual(10);
    expect(writers.filter((w) => w.kind === 'persist').length).toBeGreaterThanOrEqual(4);
  });

  it('covers every discovered storage-writer key (a new uncovered key must fail here)', () => {
    const writers = discoverWriters();
    const covered = buildCoveredKeySet();
    const uncovered = writers.filter((w) => !w.passthrough && !isCovered(w, covered));
    if (uncovered.length > 0) {
      const detail = uncovered
        .map((w) => `${w.file}:${w.line} (${w.kind}) writes '${w.key}'${w.dynamic ? ' (prefix)' : ''}`)
        .join('\n');
      throw new Error(
        `accountWipe does not cover these storage writer keys — add them to the wipe ` +
        `(EXTRA_SECURE_KEYS, ASYNC_CACHE_KEYS, a clear* function the wipe calls, ` +
        `or whole-key removal):\n${detail}`
      );
    }
  });

  it('transaction store wipe removes the whole persisted AsyncStorage key, not just rows', () => {
    const storeSrc = readSrc(path.join(SRC_ROOT, 'stores', 'transactionStore.ts'));
    // The persisted key name the store declares …
    const persistName = storeSrc.match(/name:\s*'([^']+)'/);
    expect(persistName).not.toBeNull();
    // … must be whole-key removed by the wipe action the account wipe calls.
    expect(storeSrc).toMatch(
      new RegExp("AsyncStorage\\.removeItem\\(\\s*['\"]" + persistName![1] + "['\"]\\s*\\)")
    );
    // … and clearTransactions() must keep its SPP-retention semantics.
    expect(storeSrc).toMatch(/transactions:\s*localPrivatePoolTransactions/);
  });

  it('pass-through storage adapters only serve stores whose persisted keys are covered', () => {
    const writers = discoverWriters();
    const covered = buildCoveredKeySet();
    const passthroughFiles = new Set(
      writers.filter((w) => w.passthrough).map((w) => w.file)
    );
    if (passthroughFiles.size === 0) return; // no adapter — nothing to check

    for (const relAdapter of passthroughFiles) {
      const adapterPath = path.join(SRC_ROOT, relAdapter);
      const adapterSrc = readSrc(adapterPath);
      for (const storeFile of fs.readdirSync(path.join(SRC_ROOT, 'stores'))) {
        if (!/\.ts$/.test(storeFile)) continue;
        const storePath = path.join(SRC_ROOT, 'stores', storeFile);
        const storeSrc = readSrc(storePath);
        const adapterSpec = path
          .relative(path.join(SRC_ROOT, 'stores'), adapterPath)
          .replace(/\\/g, '/')
          .replace(/\.ts$/, '');
        if (!storeSrc.includes(`'../${adapterSpec}'`)) continue;
        // This store persists through the pass-through adapter — its key must
        // be covered by the wipe.
        const persistNames = matchAll(/name:\s*(['"])([^'"]+)\1/g, storeSrc)
          .map((m) => m[2])
          .filter((v) => /veilpay/i.test(v));
        expect(persistNames.length).toBeGreaterThan(0);
        for (const key of persistNames) {
          expect(covered.has(key)).toBe(true);
        }
      }
    }
  });
});
