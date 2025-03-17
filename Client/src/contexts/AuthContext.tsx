import React, { createContext, useContext, useState, useEffect } from "react";
import { config } from "@/lib/config";

interface User {
  id: string;
  name: string;
  email: string;
  avatar?: string;
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
    console.log("Setting auth user:", newUser);
    setUserState(newUser);

    if (newUser) {
      localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(newUser));
    } else {
      localStorage.removeItem(AUTH_STORAGE_KEY);
    }
  };

  const checkAuthStatus = async () => {
    try {
      setLoading(true);

      const storedUser = localStorage.getItem(AUTH_STORAGE_KEY);
      if (storedUser) {
        try {
          const parsedUser = JSON.parse(storedUser);
          setUserState(parsedUser);
          setLoading(false);
          return;
        } catch (err) {
          console.error("Invalid stored user data:", err);
          localStorage.removeItem(AUTH_STORAGE_KEY);
        }
      }

      const apiUrl = config.api.baseUrl;
      const response = await fetch(`${apiUrl}/api/auth/verify`, {
        credentials: "include",
      });

      if (response.ok) {
        const data = await response.json();
        setUser(data.user);
      } else {
        setUser(null);
      }
    } catch (err) {
      console.error("Auth check failed:", err);
      setUser(null);
    } finally {
      setLoading(false);
    }
  };

  const logout = async () => {
    try {
      // Clear user data from localStorage
      localStorage.removeItem(AUTH_STORAGE_KEY);

      // Clear avatar from localStorage and sessionStorage
      localStorage.removeItem("userAvatar");
      sessionStorage.removeItem("userAvatar");
      localStorage.removeItem("avatarUrl");
      sessionStorage.removeItem("avatarUrl");

      // Clear any cookies that might store avatar data
      document.cookie =
        "userAvatar=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
      document.cookie =
        "avatarUrl=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";

      // Clear user state
      setUserState(null);

      // Call server logout endpoint
      const apiUrl = config.api.baseUrl;
      const response = await fetch(`${apiUrl}/api/auth/logout`, {
        method: "POST",
        credentials: "include",
      });

      if (!response.ok) {
        console.warn("Server logout failed, but local session was cleared");
      }
    } catch (err) {
      console.error("Logout failed:", err);
    }
  };

  useEffect(() => {
    console.log("Auth state updated:", { user, loading });
  }, [user, loading]);

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
