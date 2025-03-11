import { Navigate } from "react-router-dom";
import { useAuth } from "@/lib/auth"; // Make sure this is the correct import
import Dashboard from "@/components/dashboard"; // Make sure this is the correct import
export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();

  // Add debugging
  console.log("Protected Route - Auth state:", { user, loading });

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary"></div>
        <Dashboard />
      </div>
    );
  }

  if (!user) {
    console.log("No user found, redirecting to login");
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}
