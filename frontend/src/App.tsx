import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "./lib/auth";
import { RequireAuth, RequireAdmin } from "./components/Guards";
import UnderConstruction from "./pages/UnderConstruction";
import SignIn from "./pages/SignIn";
import Verify from "./pages/Verify";
import GuideOpenRouterKey from "./pages/GuideOpenRouterKey";
import GuideGenesisProject from "./pages/GuideGenesisProject";
import Builder from "./pages/Builder";
import Profile from "./pages/Profile";
import Projects from "./pages/Projects";
import Conversations from "./pages/Conversations";
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
          {/* Public guides — linked from Profile + Projects */}
          <Route path="/guide/openrouter-key" element={<GuideOpenRouterKey />} />
          <Route path="/guide/genesis-project" element={<GuideGenesisProject />} />
          {/* V2 protected app */}
          <Route path="/builder" element={<RequireAuth><Builder /></RequireAuth>} />
          <Route path="/profile" element={<RequireAuth><Profile /></RequireAuth>} />
          <Route path="/projects" element={<RequireAuth><Projects /></RequireAuth>} />
          <Route path="/conversations" element={<RequireAuth><Conversations /></RequireAuth>} />
          <Route path="/admin" element={<RequireAdmin><Admin /></RequireAdmin>} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
