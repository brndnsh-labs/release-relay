// A community-notice helper that posts a release message to a Slack channel
// through Slack's own HTTP API. The bot token is an explicit parameter,
// never read from the environment. This is a deliberate unrelated-provider
// control: the usage is real and correctly Slack's, but no supported
// provider call may be attributed to it. This workspace compiles only and
// is never invoked.

// slack-release-message-request
export async function postReleaseMessage(
  botToken: string,
  channel: string,
  releaseTag: string
): Promise<void> {
  const response = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      authorization: `Bearer ${botToken}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      channel,
      text: `Release ${releaseTag} is out.`
    })
  });
  if (!response.ok) {
    throw new Error(`Slack request failed: ${response.status}`);
  }
}
