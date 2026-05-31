/**
 * Pure Markdown renderers for the consolidated `Audit_Report` and
 * `Plan_Document` annotations.
 *
 * - `annotatePlans` — task 6.3, Plan_Document annotator (Superseded_Marker
 *   prepend or `## Audit Refresh` append).
 * - `renderAuditReport` — task 6.1, lands in a sibling module.
 */

export {
  annotatePlan,
  buildAnnotatedPlanContent,
  type AnnotatePlanOptions,
  type AnnotatePlanRequest,
  type AnnotatePlanResult,
} from './annotatePlans';
