import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "./lib/auth";
import { RequireAuth, RequireAdmin } from "./components/Guards";
import Landing from "./pages/Landing";
import SignIn from "./pages/SignIn";
import Verify from "./pages/Verify";
import Chat from "./pages/Chat";
import Account from "./pages/Account";
import Admin from "./pages/Admin";
import NotFound from "./pages/NotFound";

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/sign-in" element={<SignIn />} />
          <Route path="/auth/verify" element={<Verify />} />
          <Route path="/chat" element={<RequireAuth><Chat /></RequireAuth>} />
          <Route path="/account" element={<RequireAuth><Account /></RequireAuth>} />
          <Route path="/admin" element={<RequireAdmin><Admin /></RequireAdmin>} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
