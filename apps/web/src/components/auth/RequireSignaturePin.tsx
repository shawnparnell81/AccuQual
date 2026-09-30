import { Navigate, Outlet } from "react-router-dom";
import { useAuthStore } from "../../store/authStore";

/** After a password is set, a missing signature PIN has to be chosen before the rest of the app opens. */
export function RequireSignaturePin() {
  const pinSet = useAuthStore((s) => s.user?.pinSet);
  if (pinSet === false) return <Navigate to="/set-signature-pin" replace />;
  return <Outlet />;
}
