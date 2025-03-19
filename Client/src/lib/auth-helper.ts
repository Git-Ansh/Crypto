import { auth } from './firebase';
import { debugAuthToken, testTokenValidity } from './api';

// Auth state event emitter
type AuthListener = (isAuthenticated: boolean) => void;
const authListeners: AuthListener[] = [];

// Authentication state
let isAuthInitialized = false;
let isAuthenticated = false;

// Register for auth state notifications
export function onAuthStateChange(listener: AuthListener): () => void {
    authListeners.push(listener);
    // Return unsubscribe function
    return () => {
        const index = authListeners.indexOf(listener);
        if (index >= 0) {
            authListeners.splice(index, 1);
        }
    };
}

// Notify listeners of auth state change
function notifyAuthStateChange(newState: boolean) {
    isAuthenticated = newState;
    authListeners.forEach(listener => listener(newState));
}

// Initialize auth state monitoring
export function initializeAuth(): Promise<boolean> {
    return new Promise((resolve) => {
        if (isAuthInitialized) {
            resolve(isAuthenticated);
            return;
        }

        console.log("Initializing auth state monitoring...");

        // Listen for Firebase auth state changes
        const unsubscribe = auth.onAuthStateChanged(async (user) => {
            if (user) {
                console.log("Firebase auth: User detected");
                // User is signed in - ensure token is in localStorage
                try {
                    // Force token refresh to ensure we have the latest
                    const token = await user.getIdToken(true);
                    localStorage.setItem("auth_token", token);
                    console.log("Firebase token stored in localStorage");

                    // Debug the token for troubleshooting
                    debugAuthToken();

                    // Test if the token works with the server
                    const testResult = await testTokenValidity();
                    if (testResult.valid) {
                        console.log("Server accepted the token!");
                    } else {
                        console.warn("Server rejected the token!");
                    }

                    notifyAuthStateChange(true);
                } catch (error) {
                    console.error("Error getting auth token:", error);
                    notifyAuthStateChange(false);
                }
            } else {
                console.log("Firebase auth: No user detected");
                // Check if we have a token in localStorage anyway
                const token = localStorage.getItem("auth_token");
                if (token) {
                    console.log("No Firebase user but localStorage token exists");
                    notifyAuthStateChange(true);
                } else {
                    console.log("No authentication found");
                    notifyAuthStateChange(false);
                }
            }

            isAuthInitialized = true;
            resolve(isAuthenticated);
        }, (error) => {
            console.error("Firebase auth observer error:", error);
            isAuthInitialized = true;
            notifyAuthStateChange(false);
            resolve(false);
        });

        // Add cleanup for component unmount
        window.addEventListener('beforeunload', unsubscribe);
    });
}

// Check if authentication is ready and user is authenticated
export function getAuthStatus(): { ready: boolean, authenticated: boolean } {
    return {
        ready: isAuthInitialized,
        authenticated: isAuthenticated
    };
}

// Ensure user is authenticated
export async function ensureAuthenticated(): Promise<boolean> {
    if (isAuthInitialized) {
        return isAuthenticated;
    }
    return initializeAuth();
}

// Add this function to check if the user is authenticated
export function checkIsAuthenticated(): boolean {
    return isAuthenticated || !!localStorage.getItem("auth_token") || !!auth.currentUser;
}

// Initialize auth on module load
initializeAuth().catch(error => {
    console.error("Error during auth initialization:", error);
});

// Force an immediate authentication check
export function forceAuthCheck() {
    return initializeAuth();
}
