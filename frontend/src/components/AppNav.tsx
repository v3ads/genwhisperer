import { useNavigate, useLocation } from "react-router-dom";
import { Brand } from "./Brand";
import { useAuth } from "../lib/auth";

/**
 * Shared top nav for the V2 protected pages (Builder/Profile/Projects/
 * Conversations). Brand on the left, nav links, user chip + logout on the
 * right. Highlights the active link via useLocation.
 */
export function AppNav() {
  const nav = useNavigate();
  const loc = useLocation();
  const { user, logout } = useAuth();

  const links: Array<{ to: string; label: string; match: string }> = [
    { to: "/builder", label: "Builder", match: "/builder" },
    { to: "/conversations", label: "History", match: "/conversations" },
    { to: "/projects", label: "Projects", match: "/projects" },
    { to: "/profile", label: "Profile", match: "/profile" },
  ];

  const isActive = (m: string) => loc.pathname === m || loc.pathname.startsWith(m + "/");

  return (
    <nav className="app-nav">
      <Brand large />
      <div className="sp" />
      <div className="links">
        {links.map((l) => (
          <a key={l.to} className={isActive(l.match) ? "active" : ""} onClick={() => nav(l.to)}>
            {l.label}
          </a>
        ))}
      </div>
      {user && <span className="user-chip" title={user.email}>{user.email}</span>}
      <button
        className="logout"
        onClick={async () => {
          await logout();
          nav("/sign-in");
        }}
      >
        Sign out
      </button>
    </nav>
  );
}
