import React from "react";
import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import Dashboard from "@/components/dashboard";
import { LoginForm } from "@/components/login-form";
import { SignupForm } from "@/components/signup-form";
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

// Add a new component for public routes (routes that should only be accessible when logged out)
const PublicRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, loading } = useAuth();
  const location = useLocation();

  // Show loading state while checking authentication
  if (loading) {
    return <div>Loading authentication status...</div>;
  }

  // Redirect to dashboard if user is authenticated
  if (user) {
    console.log("User is authenticated, redirecting to dashboard");
    return <Navigate to="/dashboard" replace />;
  }

  console.log("User not authenticated, showing public content");
  return <>{children}</>;
};

export function AppRouter() {
  console.log("AppRouter rendering - all routes");
  return (
    <Routes>
      {/* Test route - unprotected */}
      <Route path="/test" element={<TestPage />} />

      {/* Login route - only accessible when logged out */}
      <Route
        path="/login"
        element={
          <PublicRoute>
            <LoginForm />
          </PublicRoute>
        }
      />

      {/* Signup route - only accessible when logged out */}
      <Route
        path="/register"
        element={
          <PublicRoute>
            <SignupForm />
          </PublicRoute>
        }
      />

      {/* Protected Dashboard route */}
      <Route
        path="/dashboard"
        element={
          <ProtectedRoute>
            <Dashboard />
          </ProtectedRoute>
        }
      />

      {/* Redirect root based on auth status */}
      <Route
        path="/"
        element={
          <PublicRoute>
            <Navigate to="/login" replace />
          </PublicRoute>
        }
      />

      {/* Catch all route - redirect to login or dashboard based on auth status */}
      <Route
        path="*"
        element={
          <PublicRoute>
            <Navigate to="/login" replace />
          </PublicRoute>
        }
      />
    </Routes>
  );
}
