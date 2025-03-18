import { Navigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { isAuthenticated } from "@/lib/api";

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();

  console.log("Protected Route - Auth state:", {
    user,
    loading,
    isAuthenticated: isAuthenticated(),
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (!user || !isAuthenticated()) {
    console.log("No user or token found, redirecting to login");
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}
