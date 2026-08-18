import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "./lib/auth";
import { RequireAuth, RequireAdmin } from "./components/Guards";
import UnderConstruction from "./pages/UnderConstruction";
import SignIn from "./pages/SignIn";
import Verify from "./pages/Verify";
import GuideOpenRouterKey from "./pages/GuideOpenRouterKey";
import GuideGenesisProject from "./pages/GuideGenesisProject";
import Chat from "./pages/Chat";
import Account from "./pages/Account";
import Admin from "./pages/Admin";
import NotFound from "./pages/NotFound";

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          {/* V2 build gate: landing replaced with a coming-soon page.
             Auth + API routes stay live so magic-link sign-in and
             /api/health keep working. Rollback to v1 = deploy v1-final. */}
          <Route path="/" element={<UnderConstruction />} />
          <Route path="/sign-in" element={<SignIn />} />
          <Route path="/auth/verify" element={<Verify />} />
          {/* Public guides — linked from Profile + Projects (built in Phase 3) */}
          <Route path="/guide/openrouter-key" element={<GuideOpenRouterKey />} />
          <Route path="/guide/genesis-project" element={<GuideGenesisProject />} />
          <Route path="/chat" element={<RequireAuth><Chat /></RequireAuth>} />
          <Route path="/account" element={<RequireAuth><Account /></RequireAuth>} />
          <Route path="/admin" element={<RequireAdmin><Admin /></RequireAdmin>} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
