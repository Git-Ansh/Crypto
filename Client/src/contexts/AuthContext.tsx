import React, { createContext, useContext, useState, useEffect } from "react";
import { config } from "@/lib/config";

interface User {
  id: string;
  name: string;
  email: string;
  avatar?: string;
  paperBalance?: number;
  role?: string;
  createdAt?: string;
  lastLogin?: string;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  error: string | null;
  checkAuthStatus: () => Promise<void>;
  logout: () => Promise<void>;
  setUser: (user: User | null) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const AUTH_STORAGE_KEY = "auth_user";

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUserState] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const storedUser = localStorage.getItem(AUTH_STORAGE_KEY);
    if (storedUser) {
      try {
        const parsedUser = JSON.parse(storedUser);
        setUserState(parsedUser);
      } catch (err) {
        console.error("Failed to parse stored user:", err);
        localStorage.removeItem(AUTH_STORAGE_KEY);
      }
    }
    setLoading(false);
  }, []);

  const setUser = (newUser: User | null) => {
    console.log("Setting user:", newUser ? newUser.email : "null");
    setUserState(newUser);

    // We don't store user data in localStorage anymore
    // User data is fetched fresh from the server using the token
  };

  const checkAuthStatus = async () => {
    try {
      setLoading(true);
      console.log("Checking authentication status...");

      // Check if we have a token
      const token = localStorage.getItem("auth_token");
      if (!token) {
        console.log("No auth token found");
        setUser(null);
        return;
      }

      console.log("Found auth token, verifying with server...");

      // Verify token with server
      const apiUrl = config.api.baseUrl;
      const response = await fetch(`${apiUrl}/api/auth/verify-token`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        credentials: "include",
      });

      if (response.ok) {
        const data = await response.json();
        console.log("Token verification successful:", data);

        if (data.valid && data.user) {
          console.log("Setting user from token verification:", data.user);
          setUserState(data.user);

          // Don't store user data in localStorage - we'll fetch it fresh each time
          // This ensures user data is always up-to-date from the server
        } else {
          console.log("Token verification failed or no user data");
          setUser(null);
        }
      } else {
        console.log("Token verification failed with status:", response.status);
        // Token is invalid, clear it
        localStorage.removeItem("auth_token");
        setUser(null);
      }
    } catch (err) {
      console.error("Auth check failed:", err);
      // Clear invalid tokens
      localStorage.removeItem("auth_token");
      setUser(null);
    } finally {
      setLoading(false);
    }
  };

  const logout = async () => {
    try {
      console.log("Logging out user...");

      // Clear user state immediately
      setUserState(null);

      // Clear ALL auth-related tokens from localStorage
      localStorage.removeItem("auth_token");

      // Clear avatar from localStorage and sessionStorage
      localStorage.removeItem("userAvatar");
      sessionStorage.removeItem("userAvatar");
      localStorage.removeItem("avatarUrl");
      sessionStorage.removeItem("avatarUrl");

      // Clear any other auth-related items
      const keysToRemove = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (
          key &&
          (key.includes("firebase") ||
            key.includes("google") ||
            key.includes("token"))
        ) {
          keysToRemove.push(key);
        }
      }
      keysToRemove.forEach((key) => {
        console.log(`Removing auth key: ${key}`);
        localStorage.removeItem(key);
      });

      // Clear any cookies that might store auth data
      document.cookie =
        "userAvatar=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
      document.cookie =
        "avatarUrl=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
      document.cookie =
        "token=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
      document.cookie =
        "refreshToken=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";

      console.log("All auth tokens and data cleared from localStorage");

      // Call server logout endpoint to clear HTTP-only cookies
      const apiUrl = config.api.baseUrl;
      const response = await fetch(`${apiUrl}/api/auth/logout`, {
        method: "POST",
        credentials: "include",
      });

      if (!response.ok) {
        console.warn("Server logout failed, but local session was cleared");
      } else {
        console.log("Server logout successful");
      }
    } catch (err) {
      console.error("Logout failed:", err);
    }
  };

  useEffect(() => {
    console.log("Auth state updated:", { user, loading });
  }, [user, loading]);

  // Check auth status on app load
  useEffect(() => {
    checkAuthStatus();
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        error,
        checkAuthStatus,
        logout,
        setUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}

// Add this function to synchronize authentication state
export const syncAuthState = (userData: any, token?: string) => {
  // If a token is provided, store it
  if (token) {
    localStorage.setItem("auth_token", token);
  }

  // Store user data in localStorage
  if (userData) {
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(userData));
  } else {
    localStorage.removeItem(AUTH_STORAGE_KEY);
    localStorage.removeItem("auth_token");
  }
};
