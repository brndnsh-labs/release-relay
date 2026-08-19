// An archive helper that builds the object URL for a stored release
// artifact in a private S3 bucket. The bucket and key are explicit
// parameters and the region is fixed configuration; the helper only formats
// a URL and never issues a request. This is a deliberate unrelated-provider
// control: the usage is real and correctly AWS's, but no supported provider
// call may be attributed to it. This workspace compiles only and is never
// invoked.

const archiveRegion = "us-east-1";

// archive-object-url-builder
export function archiveObjectUrl(bucket: string, key: string): string {
  return `https://${bucket}.s3.${archiveRegion}.amazonaws.com/${key}`;
}
