import axios from "axios";

/**
 * GetResponse subscriber sync.
 *
 * Every GenWhisperer user belongs on the "GenWhisperer" list. `subscribeUser`
 * is called on sign-up AND on every successful magic-link sign-in, so users who
 * registered before this sync existed get backfilled on their next login. The
 * call is idempotent (GetResponse answers 409 for an existing contact) and
 * fails open — a GetResponse outage must never block authentication.
 *
 * Resolution of the list id is cached for the process lifetime and NEVER
 * creates a campaign: an earlier version created a new "GenWhisperer" campaign
 * whenever the name lookup came back empty, which risks silently splitting real
 * subscribers across duplicate lists. If the list can't be found we log and
 * skip. Set GETRESPONSE_LIST_ID to pin it and skip the lookup entirely.
 */

const GR_API = "https://api.getresponse.com/v3";

function getHeaders() {
  return {
    "X-Auth-Token": `api-key ${process.env.GETRESPONSE_API_KEY}`,
    "Content-Type": "application/json",
  };
}

/** Cached campaign id (or null once we've confirmed we can't resolve one). */
let cachedListId: string | null | undefined;

/**
 * Resolve the "GenWhisperer" campaign/list id. Returns null when it cannot be
 * resolved — callers skip the subscribe rather than creating a duplicate list.
 */
export async function resolveGenWhispererList(): Promise<string | null> {
  if (cachedListId !== undefined) return cachedListId;

  const pinned = process.env.GETRESPONSE_LIST_ID?.trim();
  if (pinned) {
    cachedListId = pinned;
    return cachedListId;
  }

  try {
    const { data: campaigns } = await axios.get(`${GR_API}/campaigns`, {
      headers: getHeaders(),
      params: { "query[name]": "GenWhisperer" },
    });

    if (Array.isArray(campaigns) && campaigns.length > 0) {
      // Prefer an exact (case-insensitive) name match — GetResponse name
      // queries are partial matches, so "GenWhisperer Beta" could rank first.
      const exact = campaigns.find(
        (c: { name?: string }) => (c.name ?? "").trim().toLowerCase() === "genwhisperer"
      );
      cachedListId = ((exact ?? campaigns[0]).campaignId as string) ?? null;
      console.log(`[GetResponse] Using list: ${cachedListId}`);
      return cachedListId;
    }

    // Deliberately NOT creating a list here — see the module comment.
    console.error(
      '[GetResponse] No campaign named "GenWhisperer" found; skipping subscribe. ' +
        "Set GETRESPONSE_LIST_ID to pin the correct list."
    );
    cachedListId = null;
    return null;
  } catch (err: unknown) {
    // Transient failure: leave the cache unset so the next call retries.
    console.error("[GetResponse] List lookup failed:", describeError(err));
    return null;
  }
}

/**
 * Subscribe a user to the GenWhisperer list. Safe to call repeatedly.
 * Silently ignores errors so a GetResponse failure never blocks sign-in.
 */
export async function subscribeUser(email: string, name?: string): Promise<void> {
  if (!process.env.GETRESPONSE_API_KEY) return;
  try {
    const listId = await resolveGenWhispererList();
    if (!listId) return;
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
  } catch (err: unknown) {
    // 409 = already subscribed — not an error.
    if (isAxiosStatus(err, 409)) {
      console.log(`[GetResponse] Already subscribed: ${email}`);
      return;
    }
    console.error("[GetResponse] Subscribe failed:", describeError(err));
  }
}

/** Reset the cached list id (tests / after changing GETRESPONSE_LIST_ID). */
export function resetListCache(): void {
  cachedListId = undefined;
}

function isAxiosStatus(err: unknown, status: number): boolean {
  return (err as { response?: { status?: number } })?.response?.status === status;
}

function describeError(err: unknown): unknown {
  const e = err as { response?: { data?: unknown }; message?: string };
  return e?.response?.data ?? e?.message ?? err;
}
