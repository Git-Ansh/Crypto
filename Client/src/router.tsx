import React from "react";
import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import Dashboard from "@/components/dashboard";
import { LoginForm } from "@/components/login-form";
import { useAuth } from "@/contexts/AuthContext";
import TestPage from "./components/TestPage";

// Protected route component that uses our existing AuthContext
const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const { user, loading } = useAuth();
  const location = useLocation();

  // Add debugging
  console.log("ProtectedRoute: Auth state", {
    user,
    loading,
    path: location.pathname,
  });

  // Show loading state while checking authentication
  if (loading) {
    console.log("Auth still loading, showing loading state");
    return <div>Loading authentication status...</div>;
  }

  // Restore original authentication check - remove bypass
  // Redirect to login if not authenticated
  if (!user) {
    console.log("No user found, redirecting to login");
    // Redirect to /login but save the location they were trying to access
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  console.log("User authenticated, rendering protected content");
  return <>{children}</>;
};

export function AppRouter() {
  console.log("AppRouter rendering - all routes");
  return (
    <Routes>
      {/* Test route - unprotected and moved to the top for priority */}
      <Route path="/test" element={<TestPage />} />

      {/* Login route */}
      <Route path="/login" element={<LoginForm />} />

      {/* Protected Dashboard route */}
      <Route
        path="/dashboard"
        element={
          <ProtectedRoute>
            <Dashboard />
          </ProtectedRoute>
        }
      />

      {/* Redirect root to login page instead of dashboard */}
      <Route path="/" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}
