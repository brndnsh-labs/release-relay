// Local display-model classes deliberately reuse the provider class names
// without importing any provider SDK, constructing any client, or naming any
// provider endpoint. The classes render UI badges for the release dashboard.
// This is a deliberate local-name control: no provider observation may be
// attributed to this file. This workspace compiles only and is never
// invoked.

export class OpenAI {
  constructor(readonly label: string) {}

  displayName(): string {
    return `model-badge-${this.label}`;
  }
}

export class Anthropic {
  constructor(readonly label: string) {}

  displayName(): string {
    return `model-badge-${this.label}`;
  }
}

export class Stripe {
  constructor(readonly label: string) {}

  displayName(): string {
    return `tier-badge-${this.label}`;
  }
}

export class GitHub {
  constructor(readonly label: string) {}

  displayName(): string {
    return `source-badge-${this.label}`;
  }
}

// local-provider-name-badges
export function renderBadge(provider: OpenAI | Anthropic | Stripe | GitHub): string {
  return provider.displayName();
}
