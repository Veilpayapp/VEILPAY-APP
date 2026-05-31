/**
 * Audit pipeline passes (Discovery → Static Analysis → Synthesis → Reporting).
 *
 * Implementations land in tasks 2.x through 6.x. This index re-exports
 * stable surfaces so the CLI orchestrator (task 7.1) can import from a
 * single namespace.
 */

export {
  runDiscovery,
  type DiscoveryOutput,
  type DiscoveryOptions,
  type BackendRoutes,
} from './discovery';

export {
  runReporting,
  buildAbortMarkdown,
  type RunReportingInput,
  type RunReportingResult,
} from './reporting';
