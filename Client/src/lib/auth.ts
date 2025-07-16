import { config } from "./config";
import {
  GoogleAuthProvider,
  OAuthProvider,
  signInWithPopup,
  signOut as firebaseSignOut,
  AuthError,
  getAuth,
  onAuthStateChanged,
  User,
} from "firebase/auth";
import { auth } from "./firebase";
import React, {
  createContext,
  useContext,
  useState,
  ReactNode,
  useEffect,
  useRef,
} from "react";
import { verifyGoogleAuth } from "./api";

// Re-export the auth instance from firebase
export { auth };

// Define a proper type for the user
type AuthUser = User | null;

// Token refresh interval (13 minutes - before 15min expiry)
const TOKEN_REFRESH_INTERVAL = 13 * 60 * 1000; // 13 minutes in milliseconds
const TOKEN_CHECK_INTERVAL = 60 * 1000; // Check every minute

const AuthContext = createContext<{
  user: AuthUser;
  setUser: (u: AuthUser) => void;
  loading: boolean;
  logout: () => Promise<void>;
}>({
  user: null,
  setUser: () => { },
  loading: true,
  logout: async () => { },
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const refreshIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const checkIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Function to refresh the Firebase token
  const refreshFirebaseToken = async (): Promise<string | null> => {
    try {
      const currentUser = auth.currentUser;
      if (!currentUser) {
        console.log("No current user for token refresh");
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
      const currentUser = auth.currentUser;
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
      if (auth.currentUser) {
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

  // Logout function
  const logout = async () => {
    try {
      stopTokenRefresh();
      localStorage.removeItem("auth_token");
      await firebaseSignOut(auth);
      setUser(null);
      console.log("User logged out successfully");
    } catch (error) {
      console.error("Logout error:", error);
    }
  };

  // Listen to Firebase auth state changes
  useEffect(() => {
    console.log("Setting up auth listener");
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      console.log("Auth state changed:", firebaseUser ? "logged in" : "logged out");
      
      if (firebaseUser) {
        // User is logged in
        setUser(firebaseUser);
        
        // Get and store the initial token
        try {
          const token = await firebaseUser.getIdToken();
          localStorage.setItem("auth_token", token);
          console.log("Initial token stored");
        } catch (error) {
          console.error("Error getting initial token:", error);
        }
        
        // Start automatic token refresh
        startTokenRefresh();
      } else {
        // User is logged out
        setUser(null);
        localStorage.removeItem("auth_token");
        stopTokenRefresh();
      }
      
      setLoading(false);
    }, (error) => {
      console.error("Auth state error:", error);
      setLoading(false);
      stopTokenRefresh();
    });

    // Cleanup subscription on unmount
    return () => {
      unsubscribe();
      stopTokenRefresh();
    };
  }, []);

  // Use createElement for non-JSX .ts file
  return React.createElement(
    AuthContext.Provider,
    { value: { user, setUser, loading, logout } },
    children
  );
}

export function useAuth() {
  return useContext(AuthContext);
}

// Google sign-in handler
export const signInWithGoogle = async () => {
  try {
    const provider = new GoogleAuthProvider();
    provider.addScope("profile");
    provider.addScope("email");

    const result = await signInWithPopup(auth, provider);

    // Get the ID token
    const idToken = await result.user.getIdToken();

    // Verify with backend and get JWT token
    const backendResult = await verifyGoogleAuth(idToken);

    if (!backendResult.success) {
      console.error("Backend verification failed:", backendResult.error);
      return {
        success: false,
        message: typeof backendResult.error === 'string'
          ? backendResult.error
          : "Server verification failed",
      };
    }

    return {
      success: true,
      user: result.user,
      backendData: backendResult.data
    };
  } catch (error) {
    console.error("Google sign-in error:", error);
    return {
      success: false,
      message: error instanceof Error ? error.message : "Google sign-in failed",
    };
  }
};

// Apple sign-in handler
export const signInWithApple = async () => {
  try {
    const provider = new OAuthProvider("apple.com");
    provider.addScope("email");
    provider.addScope("name");
    const result = await signInWithPopup(auth, provider);
    return { success: true, user: result.user };
  } catch (error) {
    const authError = error as AuthError;
    console.error("Apple sign-in error:", authError.code, authError.message);
    return {
      success: false,
      error: {
        code: authError.code,
        message: authError.message,
      },
    };
  }
};

// Sign out function
export const signOut = async () => {
  try {
    await firebaseSignOut(auth);
    return { success: true };
  } catch (error) {
    const authError = error as AuthError;
    console.error("Sign out error:", authError.code, authError.message);
    return {
      success: false,
      error: {
        code: authError.code,
        message: authError.message,
      },
    };
  }
};

// Add this function to handle token refresh
export const refreshFirebaseToken = async () => {
  const currentUser = auth.currentUser;
  if (!currentUser) {
    throw new Error("No user is signed in");
  }

  // Force token refresh
  const newToken = await currentUser.getIdToken(true);
  return newToken;
};

// Modify your API calls to handle token expiration
export const callAuthenticatedEndpoint = async (
  url: string,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH',
  data?: Record<string, any>
) => {
  try {
    // First attempt with current token
    const response = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${await auth.currentUser?.getIdToken()}`
      },
      credentials: 'include',
      body: data ? JSON.stringify(data) : undefined
    });

    if (response.status === 401) {
      const responseData = await response.json();
      if (
        responseData.message?.includes('expired') ||
        responseData.message?.includes('Firebase ID token has expired') ||
        responseData.errorInfo?.code === 'auth/id-token-expired'
      ) {
        const newToken = await refreshFirebaseToken();
        // Retry with new token
        return fetch(url, {
          method,
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${newToken}`
          },
          credentials: 'include',
          body: data ? JSON.stringify(data) : undefined
        });
      }
    }

    return response;
  } catch (error) {
    console.error("API call failed:", error);
    throw error;
  }
};

// Update the loginUser function to properly handle error responses
export async function loginUser(email: string, password: string) {
  try {
    console.log(`Attempting login for ${email}`);

    const response = await fetch(`${config.api.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email, password }),
      credentials: 'include',
    });

    // Always parse the response body
    const data = await response.json();
    console.log("Login response:", response.status, data);

    if (!response.ok) {
      return {
        success: false,
        error: data.message || `Server error (${response.status})`
      };
    }

    // Store token if available
    if (data.token) {
      localStorage.setItem("auth_token", data.token);
      console.log("Token stored in localStorage");
    }

    return {
      success: true,
      data
    };
  } catch (error: any) {
    console.error("Login error:", error);
    return {
      success: false,
      error: error.message || "Network error during login"
    };
  }
}
