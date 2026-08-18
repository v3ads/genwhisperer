import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "./lib/auth";
import { RequireAuth, RequireAdmin } from "./components/Guards";
import Landing from "./pages/Landing";
import SignIn from "./pages/SignIn";
import Verify from "./pages/Verify";
import GuideOpenRouterKey from "./pages/GuideOpenRouterKey";
import GuideGenesisProject from "./pages/GuideGenesisProject";
import Builder from "./pages/Builder";
import Profile from "./pages/Profile";
import Projects from "./pages/Projects";
import Conversations from "./pages/Conversations";
import Admin from "./pages/Admin";
import Billing from "./pages/Billing";
import NotFound from "./pages/NotFound";

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          {/* V2 public landing — the final ship (replaces the under-construction gate). */}
          <Route path="/" element={<Landing />} />
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
          <Route path="/billing" element={<RequireAuth><Billing /></RequireAuth>} />
          <Route path="/admin" element={<RequireAdmin><Admin /></RequireAdmin>} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
