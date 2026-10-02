import { Routes, Route } from "react-router-dom";
import { AppLayout } from "./components/layout/AppLayout";
import { ProtectedRoute } from "./components/layout/ProtectedRoute";
import { RequireFreshPassword } from "./components/auth/RequireFreshPassword";
import { RequireSignaturePin } from "./components/auth/RequireSignaturePin";
import { LoginPage } from "./routes/Auth/LoginPage";
import { ForgotPasswordPage } from "./routes/Auth/ForgotPasswordPage";
import { ResetPasswordPage } from "./routes/Auth/ResetPasswordPage";
import { ForcePasswordChangePage } from "./routes/Auth/ForcePasswordChangePage";
import { SetSignaturePinPage } from "./routes/Auth/SetSignaturePinPage";
import { useAuthBootstrap } from "./hooks/useAuth";
import { workspaceRouteElements } from "./routes/workspaceRoutes";

export function App() {
  useAuthBootstrap();
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />

      <Route element={<ProtectedRoute />}>
        <Route path="/change-password" element={<ForcePasswordChangePage />} />
        <Route element={<RequireFreshPassword />}>
        <Route path="/set-signature-pin" element={<SetSignaturePinPage />} />
        <Route element={<RequireSignaturePin />}>
        <Route element={<AppLayout />}>
          {workspaceRouteElements()}
        </Route>
        </Route>
        </Route>
      </Route>
    </Routes>
  );
}
