// A community-notice helper that announces a release through a Discord
// webhook. The webhook credentials are explicit parameters, never read from
// the environment. This is a deliberate unrelated-provider control: the
// usage is real and correctly Discord's, but no supported provider call may
// be attributed to it. This workspace compiles only and is never invoked.

const discordApiBase = "https://discord.com/api";

// discord-release-announce-request
export async function announceOnDiscord(
  webhookId: string,
  webhookToken: string,
  releaseTag: string
): Promise<void> {
  const response = await fetch(
    `${discordApiBase}/webhooks/${webhookId}/${webhookToken}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        content: `Release ${releaseTag} is out.`
      })
    }
  );
  if (!response.ok) {
    throw new Error(`Discord request failed: ${response.status}`);
  }
}
