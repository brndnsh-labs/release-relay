// An on-call helper that texts the maintainer through Twilio's own HTTP
// API. The account credentials are explicit parameters, never read from the
// environment, and the phone numbers are inert structural examples. This is
// a deliberate unrelated-provider control: the usage is real and correctly
// Twilio's, but no supported provider call may be attributed to it. This
// workspace compiles only and is never invoked.

// twilio-maintainer-text-request
export async function textMaintainer(
  accountSid: string,
  authToken: string,
  to: string
): Promise<void> {
  const response = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
    {
      method: "POST",
      headers: {
        authorization: `Basic ${btoa(`${accountSid}:${authToken}`)}`,
        "content-type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams({
        To: to,
        From: "+15550000000",
        Body: "Release relay finished."
      })
    }
  );
  if (!response.ok) {
    throw new Error(`Twilio request failed: ${response.status}`);
  }
}
