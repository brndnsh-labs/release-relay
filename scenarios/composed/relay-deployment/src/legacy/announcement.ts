// An ordinary function kept from a pre-class refactor of the sponsor
// portal. It is invoked only through .call(legacyScope) with a plain record
// whose `client` field is a display label string, never an SDK client, so
// its `this.client` access can never reach the provider client held by the
// real class; the rebinding is the point of the shape. It pins the reviewed
// negative expectation that no provider observation is attributed to this
// file despite the reused field name. This workspace compiles only and is
// never invoked.

export interface LegacyAnnouncementScope {
  client: string;
  releaseTag: string;
}

// legacy-announcement-scope
export function announceSponsorRelease(this: LegacyAnnouncementScope): string {
  return `${this.client} sponsor coverage active for ${this.releaseTag}`;
}

export function formatLegacyAnnouncement(scope: LegacyAnnouncementScope): string {
  return announceSponsorRelease.call(scope);
}
