import { Navigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { isAuthenticated } from "@/lib/api";
import { Loading } from "@/components/ui/loading";

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();

  console.log("Protected Route - Auth state:", {
    user,
    loading,
    isAuthenticated: isAuthenticated(),
  });

  if (loading) {
    return <Loading />;
  }

  if (!user || !isAuthenticated()) {
    console.log("No user or token found, redirecting to login");
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}
