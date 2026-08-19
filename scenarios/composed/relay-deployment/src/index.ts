// The workspace barrel and only declared entry point. It re-exports the
// deployment's public surface so consumers can reach every module-flow shape
// — named exports, a default export, and re-exports — through one path.
// Nothing here constructs or calls a client.

export {
  readComparisonRange,
  type ComparisonRange,
  type ComparisonSummary
} from "#relay/github/source-reader.js";
export {
  default as draftReleaseBody,
  type DraftBulletPoint
} from "#relay/drafting/drafter.js";
export { reviewDraft } from "#relay/review/reviewer.js";
export { SponsorPortal } from "#relay/billing/sponsor-portal.js";
export {
  readDeploymentStatus,
  type DeploymentStatus
} from "#relay/internal/status.js";
export {
  announceSponsorRelease,
  formatLegacyAnnouncement,
  type LegacyAnnouncementScope
} from "#relay/legacy/announcement.js";
export {
  createDeployment,
  type DeploymentCredentials
} from "#relay/relay.js";
