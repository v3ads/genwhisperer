import axios from "axios";

const GR_API = "https://api.getresponse.com/v3";

function getHeaders() {
  return {
    "X-Auth-Token": `api-key ${process.env.GETRESPONSE_API_KEY}`,
    "Content-Type": "application/json",
  };
}

/**
 * Find or create the "GenWhisperer" campaign/list.
 * Returns the campaign ID.
 */
export async function ensureGenWhispererList(): Promise<string> {
  const existing = process.env.GETRESPONSE_LIST_ID;
  if (existing && existing.trim()) return existing.trim();

  // Search for existing campaign named "GenWhisperer"
  const { data: campaigns } = await axios.get(`${GR_API}/campaigns`, {
    headers: getHeaders(),
    params: { "query[name]": "GenWhisperer" },
  });

  if (Array.isArray(campaigns) && campaigns.length > 0) {
    const listId = campaigns[0].campaignId as string;
    console.log(`[GetResponse] Found existing list: ${listId}`);
    return listId;
  }

  // Create the list
  const { data: created } = await axios.post(
    `${GR_API}/campaigns`,
    {
      name: "GenWhisperer",
      languageCode: "EN",
      confirmation: {
        fromField: { fromFieldId: "from" },
        replyTo: { fromFieldId: "from" },
        subscriptionConfirmationBodyId: "confirmation_body",
        subscriptionConfirmationSubjectId: "confirmation_subject",
      },
      profile: {
        description: "GenWhisperer users",
        industryTagId: "1",
      },
    },
    { headers: getHeaders() }
  );

  const listId = created.campaignId as string;
  console.log(`[GetResponse] Created new list: ${listId}`);
  return listId;
}

/**
 * Subscribe a new user to the GenWhisperer list.
 * Silently ignores errors so a GR failure never blocks sign-up.
 */
export async function subscribeUser(email: string, name?: string): Promise<void> {
  try {
    const listId = await ensureGenWhispererList();
    await axios.post(
      `${GR_API}/contacts`,
      {
        email,
        name: name ?? email.split("@")[0],
        campaign: { campaignId: listId },
        ipAddress: "0.0.0.0",
      },
      { headers: getHeaders() }
    );
    console.log(`[GetResponse] Subscribed: ${email}`);
  } catch (err: any) {
    // 409 = already subscribed — not an error
    if (err?.response?.status === 409) {
      console.log(`[GetResponse] Already subscribed: ${email}`);
      return;
    }
    console.error("[GetResponse] Subscribe failed:", err?.response?.data ?? err.message);
  }
}
