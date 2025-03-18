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
} from "react";
import { verifyGoogleAuth } from "./api";

// Define a proper type for the user
type AuthUser = User | null;

const AuthContext = createContext<{
  user: AuthUser;
  setUser: (u: AuthUser) => void;
  loading: boolean;
}>({
  user: null,
  setUser: () => { },
  loading: true,
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser>(null);
  const [loading, setLoading] = useState<boolean>(true);

  // Listen to Firebase auth state changes
  useEffect(() => {
    console.log("Setting up auth listener");
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      console.log("Auth state changed:", firebaseUser ? "logged in" : "logged out");
      setUser(firebaseUser);
      setLoading(false);
    }, (error) => {
      console.error("Auth state error:", error);
      setLoading(false);
    });

    // Cleanup subscription on unmount
    return () => unsubscribe();
  }, []);

  // Use createElement for non-JSX .ts file
  return React.createElement(
    AuthContext.Provider,
    { value: { user, setUser, loading } },
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
