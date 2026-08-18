export const supportedProviders = ["github", "openai", "anthropic", "stripe"] as const;

export type SupportedProvider = (typeof supportedProviders)[number];

export const repositoryPhase = "specification" as const;
