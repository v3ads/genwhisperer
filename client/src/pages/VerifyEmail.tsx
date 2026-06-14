import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

export default function VerifyEmail() {
  const [searchParams] = useSearchParams();
  const [status, setStatus] = useState<"loading" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const navigate = useNavigate();

  useEffect(() => {
    const token = searchParams.get("token");
    if (!token) {
      setStatus("error");
      setErrorMsg("No token found in the URL.");
      return;
    }
    // The backend verify endpoint sets the cookie and redirects to /chat.
    // This page is only shown if the redirect fails (e.g. JS-handled navigation).
    window.location.href = `/api/auth/verify?token=${token}`;
  }, [searchParams]);

  if (status === "error") {
    return (
      <div style={{ minHeight: "100vh", background: "var(--bg)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
        <div style={{ textAlign: "center", maxWidth: 360 }}>
          <div style={{ fontSize: 32, marginBottom: 16 }}>⚠️</div>
          <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 10 }}>Invalid link</h2>
          <p style={{ color: "var(--text-2)", fontSize: 14, marginBottom: 24 }}>{errorMsg}</p>
          <button
            onClick={() => navigate("/auth/signin")}
            style={{ background: "var(--text)", color: "var(--bg)", padding: "10px 24px", borderRadius: 8, fontSize: 14, fontWeight: 600 }}
          >
            Request a new link
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ textAlign: "center" }}>
        <div style={{ width: 32, height: 32, border: "2px solid var(--border)", borderTopColor: "var(--text-2)", borderRadius: "50%", margin: "0 auto 16px" }} className="animate-spin" />
        <p style={{ color: "var(--text-2)", fontSize: 14 }}>Signing you in…</p>
      </div>
    </div>
  );
}
