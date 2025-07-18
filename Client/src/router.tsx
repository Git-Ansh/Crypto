import React from "react";
import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import Dashboard from "@/components/dashboard";
import { LoginForm } from "@/components/login-form";
import { SignupForm } from "@/components/signup-form";
import { useAuth } from "@/contexts/AuthContext";
import { Loading } from "@/components/ui/loading";
import TestPage from "./components/TestPage";
import FreqTradeTestPage from "./pages/freqtrade-test";

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
    return <Loading message="Checking authentication..." />;
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
    return <Loading message="Checking authentication..." />;
  }

  // Redirect to dashboard if user is authenticated
  if (user) {
    console.log("User is authenticated, redirecting to dashboard");
    return <Navigate to="/dashboard" replace />;
  }

  console.log("User not authenticated, showing public content");
  return <>{children}</>;
};

export const AppRoutes: React.FC<{ authDebugPage: React.ComponentType }> = ({
  authDebugPage,
}) => {
  return (
    <Routes>
      {/* Test route - unprotected */}
      <Route path="/test" element={<TestPage />} />

      {/* FreqTrade Test route - protected */}
      <Route
        path="/freqtrade"
        element={
          <ProtectedRoute>
            <FreqTradeTestPage />
          </ProtectedRoute>
        }
      />

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

      {/* Add the auth debug route */}
      <Route path="/auth-debug" element={React.createElement(authDebugPage)} />
    </Routes>
  );
};

// If you still need the original AppRouter for some reason, you can keep it
// but don't use it in App.tsx
export const AppRouter = () => {
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
};
