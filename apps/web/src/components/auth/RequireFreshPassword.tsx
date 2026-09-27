import { Navigate, Outlet } from "react-router-dom";
import { useAuthStore } from "../../store/authStore";

/** Keeps a temporary password from reaching any other page. The API refuses those calls too. */
export function RequireFreshPassword() {
  const mustChange = useAuthStore((s) => s.user?.mustChangePassword);
  if (mustChange) return <Navigate to="/change-password" replace />;
  return <Outlet />;
}