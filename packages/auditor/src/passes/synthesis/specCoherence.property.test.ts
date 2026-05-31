/**
 * Property-based test for `Spec_Coherence_Report` subsection coverage
 * (Property 11 in `.kiro/specs/production-readiness-audit/design.md`).
 *
 * **Validates: Requirements 8.2, 8.3, 8.4, 8.5**
 *
 * The property under test is a structural contract on the output of
 * {@link buildSpecCoherenceReport}: regardless of which spec dirs are
 * supplied (and whether the `veilpay-privacy-stack` spec is among them),
 * the synthesizer must produce
 *
 *   - exactly one subsection per input spec dir (Requirement 8.2),
 *   - a privacy-stack subsection (real or fallback) with
 *     `compares_design_and_tasks === true` (Requirement 8.3),
 *   - gap entries whose `behavior`, `spec_section`, and `satisfied_by`
 *     fields are well-formed — the latter is either a non-empty list of
 *     non-empty source paths or the literal sentinel `'not yet present'`
 *     (Requirement 8.4), and
 *   - unspecced-behavior entries with non-empty `behavior`, `source_path`,
 *     and `recommendation` (Requirement 8.5).
 *
 * Strategy
 * --------
 * `buildSpecCoherenceReport` reads the workspace via `fs.readFile` /
 * `fs.readdir`, so the property test cannot stub out I/O cleanly. Each
 * `fast-check` run materializes a real fixture filesystem under
 * `os.tmpdir()`:
 *
 *   - 1..4 spec directories under `<tmp>/<run>/.kiro/specs/<name>`, each
 *     with a synthetic `requirements.md` containing 1..4
 *     `### Requirement N: <Title>` headings.
 *   - When the generator opts in, one of the spec dirs is named
 *     `veilpay-privacy-stack` and additionally carries `design.md` +
 *     `tasks.md` so the privacy-stack subsection comparison fires
 *     (Requirement 8.3); otherwise the synthesizer's fallback subsection
 *     is exercised.
 *   - 0..3 top-level files under `<tmp>/<run>/apps/backend/src/routes/`
 *     so `unspecced_behaviors` is populated and Requirement 8.5 has live
 *     entries to assert against.
 *
 * Run-count tradeoff
 * ------------------
 * Each iteration writes ~5..20 small files to the temp filesystem, so the
 * default `numRuns: 100` would take meaningfully longer than the rest of
 * the suite. The test caps `numRuns` at 20: at four spec dirs × four
 * requirements + a privacy-stack pair + a handful of unspecced files,
 * 20 runs already cover several hundred distinct file layouts, which is
 * sufficient for the structural invariants under test. The cap is
 * documented here rather than buried in the call so future contributors
 * can raise it deliberately if the contract evolves.
 *
 * Cleanup
 * -------
 * A single per-test root tmp dir is created in `beforeEach` and removed
 * recursively in `afterEach`. Each `fast-check` iteration creates its own
 * subdirectory under that root, so the entire tree is reaped in one
 * `fs.rm(..., { recursive: true, force: true })` call regardless of how
 * many iterations ran.
 */

import * as fc from 'fast-check';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { buildSpecCoherenceReport } from './specCoherence';
import type { BackendRoutes } from '../discovery';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Spec name that triggers the design + tasks comparison. */
const PRIVACY_STACK_NAME = 'veilpay-privacy-stack';

/** Sentinel surfaced by the synthesizer when no source file matches. */
const NOT_YET_PRESENT = 'not yet present';

/**
 * Reduced run count: each iteration writes a small fixture filesystem,
 * so the default 100 runs would dominate the suite walltime.
 */
const NUM_RUNS = 20;

/** Empty `BackendRoutes` shape; the synthesizer tolerates empty buckets. */
const EMPTY_BACKEND_ROUTES: BackendRoutes = {
  webhooks: [],
  merchant: [],
  invoice: [],
  admin: [],
};

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/** Lowercase ascii letters; basis for synthetic spec / file names. */
const LOWER_LETTERS = 'abcdefghijklmnopqrstuvwxyz'.split('');

/**
 * Generate a kebab-case-ish slug suitable for a spec directory name. The
 * grammar is `[a-z]{4,12}` — short enough to keep fixture trees small and
 * long enough that `fc.uniqueArray` can find distinct names without
 * exhausting the search space.
 */
const arbSlug = fc
  .array(fc.constantFrom(...LOWER_LETTERS), { minLength: 4, maxLength: 12 })
  .map((chars) => chars.join(''));

/** Spec dir name; never collides with the privacy-stack sentinel. */
const arbNonPrivacySpecName = arbSlug.filter((s) => s !== PRIVACY_STACK_NAME);

/**
 * One requirement heading: `### Requirement <num>: <Title>`. The title is
 * a CamelCase-ish identifier so the synthesizer's token heuristic has
 * something to match against — but tokens are not required to match any
 * source file (the property accepts both the matched and `not yet present`
 * arms of `satisfied_by`).
 */
interface RequirementSpec {
  readonly num: number;
  readonly title: string;
}

const arbCamelToken = fc
  .array(fc.constantFrom(...LOWER_LETTERS), { minLength: 4, maxLength: 8 })
  .map((chars) => {
    const first = chars[0] ?? 'x';
    return first.toUpperCase() + chars.slice(1).join('');
  });

const arbRequirement: fc.Arbitrary<RequirementSpec> = fc.record({
  num: fc.integer({ min: 1, max: 99 }),
  title: arbCamelToken,
});

/**
 * Generate one spec fixture: a name + a list of requirements (1..4).
 * Requirements are deduplicated by their `num` so the rendered heading
 * list is unambiguous.
 */
interface SpecFixture {
  readonly name: string;
  readonly requirements: readonly RequirementSpec[];
}

const arbSpecFixture: fc.Arbitrary<SpecFixture> = fc.record({
  name: arbNonPrivacySpecName,
  requirements: fc.uniqueArray(arbRequirement, {
    minLength: 1,
    maxLength: 4,
    selector: (r) => r.num,
  }),
});

/** Top-level filename under `apps/backend/src/routes/`. */
const arbRouteExtension = fc.constantFrom('.ts', '.tsx', '.js');
const arbRouteBasename = fc
  .array(fc.constantFrom(...LOWER_LETTERS), { minLength: 4, maxLength: 10 })
  .map((chars) => chars.join(''));
const arbRouteFilename = fc
  .tuple(arbRouteBasename, arbRouteExtension)
  .map(([name, ext]) => `${name}${ext}`);

/**
 * Top-level fixture record. Captures everything one fast-check iteration
 * needs to build a workspace tree and drive the synthesizer.
 */
interface FixtureSpec {
  readonly specs: readonly SpecFixture[];
  readonly includePrivacyStack: boolean;
  readonly unspeccedFiles: readonly string[];
}

const arbFixture: fc.Arbitrary<FixtureSpec> = fc.record({
  specs: fc.uniqueArray(arbSpecFixture, {
    minLength: 1,
    maxLength: 4,
    selector: (s) => s.name,
  }),
  includePrivacyStack: fc.boolean(),
  unspeccedFiles: fc.uniqueArray(arbRouteFilename, {
    minLength: 0,
    maxLength: 3,
  }),
});

// ---------------------------------------------------------------------------
// Fixture builder
// ---------------------------------------------------------------------------

/**
 * Materialize the synthetic workspace under `runDir` and return the
 * repository-relative spec dir paths the synthesizer expects. The shape
 * mirrors `runDiscovery`'s output: each entry is a POSIX path beginning
 * with `.kiro/specs/`.
 */
async function buildFixtureWorkspace(
  runDir: string,
  fixture: FixtureSpec,
): Promise<string[]> {
  const specsRoot = path.join(runDir, '.kiro', 'specs');
  await fs.mkdir(specsRoot, { recursive: true });

  // Decide which (if any) of the supplied specs should be renamed to the
  // privacy-stack sentinel. We rename the first entry rather than appending
  // so the spec count exactly matches the generated `specs.length`.
  const specs = fixture.specs.map((s, idx) =>
    fixture.includePrivacyStack && idx === 0 ? { ...s, name: PRIVACY_STACK_NAME } : s,
  );

  const specDirRels: string[] = [];
  for (const spec of specs) {
    const specDirAbs = path.join(specsRoot, spec.name);
    await fs.mkdir(specDirAbs, { recursive: true });

    // Build a minimal but well-formed requirements.md.
    const requirementHeadings = spec.requirements
      .map((r) => `### Requirement ${r.num}: ${r.title}`)
      .join('\n\n');
    const requirementsBody = [
      `# ${spec.name}`,
      '',
      '## Introduction',
      '',
      `Synthetic requirements for the ${spec.name} property test fixture.`,
      '',
      requirementHeadings,
      '',
    ].join('\n');
    await fs.writeFile(path.join(specDirAbs, 'requirements.md'), requirementsBody, 'utf8');

    // For the privacy-stack spec, emit design.md + tasks.md so the
    // synthesizer's privacy-stack comparison branch fires (Requirement 8.3).
    if (spec.name === PRIVACY_STACK_NAME) {
      await fs.writeFile(
        path.join(specDirAbs, 'design.md'),
        '# Design\n\nSynthetic design document for fixture.\n',
        'utf8',
      );
      await fs.writeFile(
        path.join(specDirAbs, 'tasks.md'),
        '# Tasks\n\n- [ ] Synthetic task for fixture.\n',
        'utf8',
      );
    }

    specDirRels.push(`.kiro/specs/${spec.name}`);
  }

  // Top-level route files become candidate unspecced behaviors. They are
  // only emitted if `unspeccedFiles` is non-empty, so the property still
  // covers the empty-list arm of Requirement 8.5.
  if (fixture.unspeccedFiles.length > 0) {
    const routesAbs = path.join(runDir, 'apps', 'backend', 'src', 'routes');
    await fs.mkdir(routesAbs, { recursive: true });
    for (const filename of fixture.unspeccedFiles) {
      await fs.writeFile(
        path.join(routesAbs, filename),
        `// Synthetic route stub for fixture: ${filename}\nexport {};\n`,
        'utf8',
      );
    }
  }

  return specDirRels;
}

// ---------------------------------------------------------------------------
// Property assertions
// ---------------------------------------------------------------------------

/** Per-test temp root; one mkdtemp call in beforeEach, recursive rm in afterEach. */
let tmpRoot: string;

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'spec-coherence-prop-'));
});

afterEach(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe('Spec_Coherence subsection coverage (Property 11)', () => {
  it('produces one subsection per spec dir with well-formed gaps and unspecced entries', async () => {
    await fc.assert(
      fc.asyncProperty(arbFixture, async (fixture) => {
        // Per-iteration subdirectory keeps fixtures isolated. The outer
        // afterEach removes the entire tmpRoot, so we never leak files.
        const runDir = await fs.mkdtemp(path.join(tmpRoot, 'run-'));
        const specDirRels = await buildFixtureWorkspace(runDir, fixture);

        const report = await buildSpecCoherenceReport({
          workspaceRoot: runDir,
          specDirs: specDirRels,
          evidenceCorpus: { backendRoutes: EMPTY_BACKEND_ROUTES },
        });

        // ---- Requirement 8.2: one subsection per spec dir ----------------
        expect(report.spec_subsections.length).toBe(specDirRels.length);

        // ---- Per-subsection structural invariants ------------------------
        for (const subsection of report.spec_subsections) {
          expect(typeof subsection.spec_id).toBe('string');
          expect(subsection.spec_id.length).toBeGreaterThan(0);
          expect(typeof subsection.scope_summary).toBe('string');
          expect(subsection.scope_summary.length).toBeGreaterThan(0);
          expect(Array.isArray(subsection.gaps)).toBe(true);

          for (const gap of subsection.gaps) {
            // Requirement 8.4 — behavior + spec_section non-empty.
            expect(typeof gap.behavior).toBe('string');
            expect(gap.behavior.length).toBeGreaterThan(0);
            expect(typeof gap.spec_section).toBe('string');
            expect(gap.spec_section.length).toBeGreaterThan(0);

            // Requirement 8.4 — satisfied_by is either the literal
            // sentinel or a non-empty array of non-empty path strings.
            if (typeof gap.satisfied_by === 'string') {
              expect(gap.satisfied_by).toBe(NOT_YET_PRESENT);
            } else {
              expect(Array.isArray(gap.satisfied_by)).toBe(true);
              expect(gap.satisfied_by.length).toBeGreaterThan(0);
              for (const filePath of gap.satisfied_by) {
                expect(typeof filePath).toBe('string');
                expect(filePath.length).toBeGreaterThan(0);
              }
            }
          }
        }

        // ---- Requirement 8.3: privacy-stack subsection compares both ----
        // The synthesizer always populates `privacy_stack_subsection`, even
        // when the spec dir is missing (it returns a fallback). In both
        // arms, `compares_design_and_tasks` must be `true`.
        expect(report.privacy_stack_subsection).toBeDefined();
        expect(report.privacy_stack_subsection.compares_design_and_tasks).toBe(true);
        expect(report.privacy_stack_subsection.spec_id).toBe(PRIVACY_STACK_NAME);

        // When a privacy-stack spec was actually written into the fixture,
        // its real subsection must also surface inside spec_subsections.
        if (fixture.includePrivacyStack) {
          const real = report.spec_subsections.find(
            (s) => s.spec_id === PRIVACY_STACK_NAME,
          );
          expect(real).toBeDefined();
          expect(real?.compares_design_and_tasks).toBe(true);
        }

        // ---- Requirement 8.5: unspecced entries are well-formed ----------
        expect(Array.isArray(report.unspecced_behaviors)).toBe(true);
        for (const entry of report.unspecced_behaviors) {
          expect(typeof entry.behavior).toBe('string');
          expect(entry.behavior.length).toBeGreaterThan(0);
          expect(typeof entry.source_path).toBe('string');
          expect(entry.source_path.length).toBeGreaterThan(0);
          expect(typeof entry.recommendation).toBe('string');
          expect(entry.recommendation.length).toBeGreaterThan(0);
        }

        // When the fixture wrote unspecced files, at least one must appear.
        // Source paths are POSIX-style and rooted at apps/backend/src/routes.
        if (fixture.unspeccedFiles.length > 0) {
          expect(report.unspecced_behaviors.length).toBeGreaterThan(0);
          for (const entry of report.unspecced_behaviors) {
            expect(entry.source_path.startsWith('apps/backend/src/routes/')).toBe(true);
          }
        }
      }),
      { numRuns: NUM_RUNS },
    );
  }, 30000);
});
