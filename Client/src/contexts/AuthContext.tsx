import React, { createContext, useContext, useState, useEffect, useRef } from "react";
import { config } from "@/lib/config";
import { auth } from "@/lib/firebase";
import { onAuthStateChanged, User as FirebaseUser } from "firebase/auth";

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
// Token refresh interval (13 minutes - before 15min expiry)
const TOKEN_REFRESH_INTERVAL = 13 * 60 * 1000; // 13 minutes in milliseconds
const TOKEN_CHECK_INTERVAL = 60 * 1000; // Check every minute

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUserState] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const refreshIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const checkIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const firebaseUserRef = useRef<FirebaseUser | null>(null);

  // Function to refresh the Firebase token
  const refreshFirebaseToken = async (): Promise<string | null> => {
    try {
      const currentUser = firebaseUserRef.current || auth.currentUser;
      if (!currentUser) {
        console.log("No current Firebase user for token refresh");
        return null;
      }

      console.log("Refreshing Firebase token...");
      // Force refresh the token
      const newToken = await currentUser.getIdToken(true);
      
      // Update localStorage
      localStorage.setItem("auth_token", newToken);
      console.log("Firebase token refreshed and stored");
      
      return newToken;
    } catch (error) {
      console.error("Failed to refresh Firebase token:", error);
      return null;
    }
  };

  // Function to check if token needs refresh
  const checkTokenExpiry = async () => {
    try {
      const currentUser = firebaseUserRef.current || auth.currentUser;
      if (!currentUser) return;

      // Get the current token without forcing refresh
      const token = await currentUser.getIdToken(false);
      
      // Decode the token to check expiry
      const payload = JSON.parse(atob(token.split('.')[1]));
      const currentTime = Math.floor(Date.now() / 1000);
      const timeToExpiry = payload.exp - currentTime;
      
      // If token expires in less than 2 minutes, refresh it
      if (timeToExpiry < 120) {
        console.log(`Token expires in ${timeToExpiry} seconds, refreshing...`);
        await refreshFirebaseToken();
      }
    } catch (error) {
      console.error("Error checking token expiry:", error);
    }
  };

  // Start automatic token refresh
  const startTokenRefresh = () => {
    // Clear any existing intervals
    if (refreshIntervalRef.current) {
      clearInterval(refreshIntervalRef.current);
    }
    if (checkIntervalRef.current) {
      clearInterval(checkIntervalRef.current);
    }

    // Set up regular token refresh (every 13 minutes)
    refreshIntervalRef.current = setInterval(async () => {
      if (firebaseUserRef.current || auth.currentUser) {
        await refreshFirebaseToken();
      }
    }, TOKEN_REFRESH_INTERVAL);

    // Set up token expiry checking (every minute)
    checkIntervalRef.current = setInterval(checkTokenExpiry, TOKEN_CHECK_INTERVAL);

    console.log("Automatic token refresh started");
  };

  // Stop automatic token refresh
  const stopTokenRefresh = () => {
    if (refreshIntervalRef.current) {
      clearInterval(refreshIntervalRef.current);
      refreshIntervalRef.current = null;
    }
    if (checkIntervalRef.current) {
      clearInterval(checkIntervalRef.current);
      checkIntervalRef.current = null;
    }
    console.log("Automatic token refresh stopped");
  };

  // Set up Firebase auth state listener
  useEffect(() => {
    console.log("Setting up Firebase auth listener");
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      console.log("Firebase auth state changed:", firebaseUser ? "logged in" : "logged out");
      firebaseUserRef.current = firebaseUser;
      
      if (firebaseUser) {
        // User is logged in with Firebase
        try {
          const token = await firebaseUser.getIdToken();
          localStorage.setItem("auth_token", token);
          console.log("Firebase token stored");
          
          // Start automatic token refresh
          startTokenRefresh();
          
          // Try to get user data from server
          await checkAuthStatus();
        } catch (error) {
          console.error("Error getting Firebase token:", error);
        }
      } else {
        // User is logged out from Firebase
        firebaseUserRef.current = null;
        stopTokenRefresh();
        
        // Check if we still have a valid JWT token (for email/password login)
        const token = localStorage.getItem("auth_token");
        if (token) {
          await checkAuthStatus();
        } else {
          setUserState(null);
          setLoading(false);
        }
      }
    }, (error) => {
      console.error("Firebase auth state error:", error);
      setLoading(false);
      stopTokenRefresh();
    });

    // Cleanup subscription on unmount
    return () => {
      unsubscribe();
      stopTokenRefresh();
    };
  }, []);

  // Initialize by checking stored user data
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
    
    // Don't set loading to false here, let Firebase auth state handle it
  }, []);

  const setUser = (newUser: User | null) => {
    console.log("Setting user:", newUser ? newUser.email : "null");
    setUserState(newUser);

    // Store user data for quick access, but don't rely on it for auth
    if (newUser) {
      localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(newUser));
    } else {
      localStorage.removeItem(AUTH_STORAGE_KEY);
    }
  };

  const checkAuthStatus = async () => {
    try {
      setLoading(true);
      setError(null);
      console.log("Checking authentication status...");

      // Check if we have a token
      const token = localStorage.getItem("auth_token");
      if (!token) {
        console.log("No auth token found");
        setUser(null);
        return;
      }

      console.log("Found auth token, verifying with server...");

      // For Firebase tokens, try to refresh if needed
      if (firebaseUserRef.current || auth.currentUser) {
        try {
          await refreshFirebaseToken();
        } catch (error) {
          console.warn("Could not refresh Firebase token:", error);
        }
      }

      // Verify token with server
      const apiUrl = config.api.baseUrl;
      const response = await fetch(`${apiUrl}/api/auth/verify-token`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${localStorage.getItem("auth_token")}`,
          "Content-Type": "application/json",
        },
        credentials: "include",
      });

      if (response.ok) {
        const data = await response.json();
        console.log("Token verification successful:", data);

        if (data.valid && data.user) {
          console.log("Setting user from token verification:", data.user);
          setUser(data.user);
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
      setError(err instanceof Error ? err.message : "Authentication check failed");
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

      // Stop token refresh
      stopTokenRefresh();

      // Clear user state immediately
      setUserState(null);

      // Clear ALL auth-related tokens from localStorage
      localStorage.removeItem("auth_token");
      localStorage.removeItem(AUTH_STORAGE_KEY);

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

      // Sign out from Firebase if signed in
      if (firebaseUserRef.current || auth.currentUser) {
        try {
          const { signOut: firebaseSignOut } = await import("firebase/auth");
          await firebaseSignOut(auth);
          console.log("Firebase sign out successful");
        } catch (error) {
          console.warn("Firebase sign out failed:", error);
        }
      }

      // Call server logout endpoint to clear HTTP-only cookies
      const apiUrl = config.api.baseUrl;
      try {
        const response = await fetch(`${apiUrl}/api/auth/logout`, {
          method: "POST",
          credentials: "include",
        });

        if (!response.ok) {
          console.warn("Server logout failed, but local session was cleared");
        } else {
          console.log("Server logout successful");
        }
      } catch (error) {
        console.warn("Could not contact server for logout:", error);
      }

      firebaseUserRef.current = null;
    } catch (err) {
      console.error("Logout failed:", err);
      setError(err instanceof Error ? err.message : "Logout failed");
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
