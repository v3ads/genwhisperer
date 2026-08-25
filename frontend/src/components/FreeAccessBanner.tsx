import { useEffect, useState } from "react";
import { billing as billingApi, type SubscriptionState } from "../lib/api";

/**
 * Free-access notice shown at the top of every signed-in page while
 * GenWhisperer is free and gathering testimonials.
 *
 * Dismissal is remembered in localStorage so it stops nagging returning users,
 * but it still appears for every new sign-up (and again if we change the copy
 * version below). Rendered only when the server says free mode is on, so
 * flipping `free_mode` off removes it with no redeploy.
 */

const DISMISS_KEY = "gw_free_banner_dismissed_v1";

// The subscription state is shared by AppNav (this banner) and the Builder.
// Memoize the in-flight request so mounting on any page costs one call.
let subPromise: Promise<SubscriptionState> | null = null;
function loadSub(): Promise<SubscriptionState> {
  if (!subPromise) subPromise = billingApi.subscription();
  return subPromise;
}

export function FreeAccessBanner() {
  const [sub, setSub] = useState<SubscriptionState | null>(null);
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(DISMISS_KEY) === "1";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    let alive = true;
    loadSub()
      .then((s) => {
        if (alive) setSub(s);
      })
      .catch(() => {
        /* non-fatal: no banner rather than a broken page */
      });
    return () => {
      alive = false;
    };
  }, []);

  if (dismissed || !sub?.freeMode) return null;

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* private browsing — just hide it for this session */
    }
    setDismissed(true);
  };

  return (
    <div className="free-banner" role="status">
      <span className="free-banner-tag">Free</span>
      <p>
        <strong>GenWhisperer is currently free.</strong> Go ahead — try it and test it. If you
        like it, we'd love a testimonial:{" "}
        <a href={`mailto:${sub.testimonialEmail}?subject=GenWhisperer%20testimonial`}>
          {sub.testimonialEmail}
        </a>
      </p>
      <button className="free-banner-x" onClick={dismiss} aria-label="Dismiss this notice">
        ×
      </button>
    </div>
  );
}
