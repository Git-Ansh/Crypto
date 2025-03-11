import { config } from "./config";

// Fix the API base URL - make sure there's no undefined in the path
const API_BASE_URL = import.meta.env.VITE_API_URL || 'https://api.crypto-pilot.dev'; // Use your actual backend URL

/**
 * Helper function to make API requests with proper error handling
 */
async function apiRequest(endpoint: string, options: RequestInit = {}) {
  const url = `${API_BASE_URL}${endpoint}`;
  
  // Default headers
  const headers = {
    "Content-Type": "application/json",
    ...options.headers,
  };
  
  try {
    const response = await fetch(url, { ...options, headers });
    
    // Parse response as JSON
    const data = await response.json();
    
    // Handle API errors
    if (!response.ok) {
      throw new Error(data.message || "An error occurred");
    }
    
    return data;
  } catch (error) {
    console.error("API request failed:", error);
    throw error;
  }
}

/**
 * User authentication
 */
export async function loginUser(email: string, password: string) {
  return apiRequest("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

/**
 * Verify Google authentication token
 */
export async function verifyGoogleAuth(idToken: string) {
  try {
    const response = await fetch(`${API_BASE_URL}/api/auth/google-verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ idToken }),
    });

    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Error verifying Google auth:', error);
    return { success: false, message: 'Failed to verify authentication with server' };
  }
}

// Add other API functions as needed
export async function getUserProfile() {
  // Get auth token from storage
  const token = localStorage.getItem(config.auth.tokenStorageKey);
  
  return apiRequest("/user/profile", {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
}
