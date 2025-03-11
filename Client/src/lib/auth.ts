import { 
  GoogleAuthProvider, 
  OAuthProvider, 
  signInWithPopup, 
  signOut as firebaseSignOut,
  AuthError,
  getAuth
} from "firebase/auth";
import { auth } from "./firebase";

// Google sign-in handler
export const signInWithGoogle = async () => {
  try {
    const provider = new GoogleAuthProvider();
    provider.addScope('profile');
    provider.addScope('email');
    
    // Use the existing auth instance imported from "./firebase" instead of calling getAuth()
    // const auth = getAuth();  // remove this line
    
    const result = await signInWithPopup(auth, provider);
    
    return { 
      success: true, 
      user: result.user 
    };
  } catch (error) {
    console.error("Google sign-in error:", error);
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Google sign-in failed',
    };
  }
};

// Apple sign-in handler
export const signInWithApple = async () => {
  try {
    const provider = new OAuthProvider('apple.com');
    provider.addScope('email');
    provider.addScope('name');
    const result = await signInWithPopup(auth, provider);
    return { success: true, user: result.user };
  } catch (error) {
    const authError = error as AuthError;
    console.error("Apple sign-in error:", authError.code, authError.message);
    return { 
      success: false, 
      error: { 
        code: authError.code, 
        message: authError.message 
      } 
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
        message: authError.message 
      } 
    };
  }
};