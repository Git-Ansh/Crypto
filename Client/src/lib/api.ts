import { config } from "./config";

const API_BASE_URL = config.api.baseUrl;

/**
 * Helper function to make API requests with proper error handling
 */
async function apiRequest(endpoint: string, options: RequestInit = {}) {
  const url = `${API_BASE_URL}${endpoint}`;

  console.log(`Making API request to: ${url}`);

  // Default headers
  const headers = {
    "Content-Type": "application/json",
    ...options.headers,
  };

  // Include credentials for cookies
  const requestOptions = {
    ...options,
    headers,
    credentials: 'include' as RequestCredentials
  };

  try {
    const response = await fetch(url, requestOptions);

    // Log response status for debugging
    console.log(`API response status: ${response.status}`);

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
  return apiRequest("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

/**
 * Verify Google Authentication
 */
export async function verifyGoogleAuth(idToken: string) {
  // Use the full path with /api prefix to match your server routes
  return apiRequest("/api/auth/google-verify", {
    method: "POST",
    body: JSON.stringify({ idToken }),
    credentials: "include", // Important for cookies
  });
}

/**
 * User registration
 */
export async function registerUser(username: string, email: string, password: string) {
  return apiRequest("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({ username, email, password }),
  });
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
