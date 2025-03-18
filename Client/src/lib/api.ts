import { config } from "./config";
import axios, { AxiosRequestConfig, InternalAxiosRequestConfig, AxiosError } from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

// Create an authenticated axios instance
export const authAxios = axios.create({
  baseURL: API_BASE_URL
});

// Add request interceptor to add auth token to every request
authAxios.interceptors.request.use(
  (axiosConfig) => {
    // Get token from localStorage using the correct key
    const token = localStorage.getItem("auth_token");

    console.log("Auth interceptor - token:", token ? "Found token" : "No token");

    if (token) {
      axiosConfig.headers.Authorization = `Bearer ${token}`;
    } else {
      console.warn("No auth token found in localStorage");
    }

    axiosConfig.withCredentials = true;
    return axiosConfig;
  },
  (error) => Promise.reject(error)
);

// Helper functions for API requests using authAxios
export async function fetchPortfolioData() {
  if (!isAuthenticated()) {
    console.warn("Attempting to fetch portfolio without authentication");
    return Promise.reject(new Error("Authentication required"));
  }
  return authAxios.get('/api/portfolio');
}

// Add a simple in-memory cache
const apiCache: Record<string, { data: any, timestamp: number }> = {};
const CACHE_TTL = 60000; // 1 minute cache

// Modify retryRequest to use exponential backoff with jitter
async function retryRequest<T>(
  requestFn: () => Promise<T>,
  maxRetries = 3,
  initialDelay = 1000
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await requestFn();
    } catch (error: unknown) {
      lastError = error;
      if (axios.isAxiosError(error) && error.response?.status === 429) {
        // Add jitter to prevent synchronized retries
        const jitter = Math.random() * 0.3 + 0.85; // 0.85-1.15 multiplier
        const delay = initialDelay * Math.pow(2, attempt) * jitter;
        console.log(`Rate limited. Retrying in ${Math.round(delay)}ms (attempt ${attempt + 1}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        throw error;
      }
    }
  }
  throw lastError;
}

// Add caching to frequently called endpoints
export async function fetchTrades() {
  const cacheKey = '/api/trades';
  const cached = apiCache[cacheKey];

  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    console.log("Using cached trades data");
    return cached.data;
  }

  return retryRequest(async () => {
    if (!isAuthenticated()) {
      console.warn("Attempting to fetch trades without authentication");
      return Promise.reject(new Error("Authentication required"));
    }

    const response = await authAxios.get('/api/trades');

    // Cache the result
    apiCache[cacheKey] = {
      data: response.data,
      timestamp: Date.now()
    };

    return response.data;
  });
}

export async function fetchPositions() {
  if (!isAuthenticated()) {
    console.warn("Attempting to fetch positions without authentication");
    return Promise.reject(new Error("Authentication required"));
  }
  return authAxios.get('/api/positions');
}

export async function fetchBotConfig() {
  if (!isAuthenticated()) {
    console.warn("Attempting to fetch bot config without authentication");
    return Promise.reject(new Error("Authentication required"));
  }
  return authAxios.get('/api/bot/config');
}

// Basic API request function
export async function apiRequest(endpoint: string, options: RequestInit = {}) {
  const token = getAuthToken();
  console.log(`API Request to ${endpoint} - Auth token exists:`, !!token);

  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
    ...options.headers,
  };

  try {
    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      ...options,
      headers,
      credentials: 'include',
    });

    // Check if the response is JSON
    const contentType = response.headers.get("content-type");
    const isJson = contentType && contentType.includes("application/json");

    if (!response.ok) {
      if (response.status === 401) {
        console.error("Authentication failed - token may be invalid or expired");
        // Optionally clear the token and redirect to login
        // localStorage.removeItem("auth_token");
        // window.location.href = "/login";
      }

      if (isJson) {
        const errorData = await response.json();
        console.error(`API error (${response.status}):`, errorData);
        throw new Error(errorData.message || `Server error: ${response.status}`);
      } else {
        throw new Error(`Server error: ${response.status}`);
      }
    }

    return isJson ? await response.json() : { success: true };
  } catch (error) {
    console.error(`API request failed for ${endpoint}:`, error);
    throw error;
  }
}

/**
 * User authentication
 */
export async function loginUser(email: string, password: string) {
  try {
    const response = await apiRequest("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });

    // Store the token if it's in the response
    if (response.token) {
      console.log("Login successful, storing auth token");
      localStorage.setItem("auth_token", response.token);

      // Debug the token after storing
      debugAuthToken();

      return { success: true, data: response };
    } else if (response.success) {
      // If no token in response but login was successful
      console.log("Login successful (using HTTP-only cookies)");
      return { success: true, data: response };
    } else {
      console.error("Login response missing token:", response);
      return { success: false, error: "No token in response" };
    }
  } catch (error) {
    console.error("Login failed:", error);
    return { success: false, error };
  }
}

/**
 * Verify Google Authentication
 */
export async function verifyGoogleAuth(idToken: string) {
  try {
    console.log("Verifying Google auth with token:", idToken.substring(0, 10) + "...");

    // First verify with Google
    const response = await fetch(`${API_BASE_URL}/api/auth/google-verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ idToken }),
      credentials: 'include',
    });

    const data = await response.json();
    console.log("Google auth response:", data);

    if (!response.ok) {
      return {
        success: false,
        error: data.message || `Server error: ${response.status}`
      };
    }

    // If verification successful, exchange the token
    if (data.success) {
      const exchangeResult = await exchangeToken(idToken);

      if (!exchangeResult.success) {
        console.warn("Token exchange failed, using original token");
        localStorage.setItem("auth_token", idToken);
      }

      return { success: true, data: data.data };
    } else {
      console.warn("Google verification failed");
      return { success: false, error: "Google verification failed" };
    }
  } catch (error) {
    console.error("Google auth verification failed:", error);
    return { success: false, error };
  }
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

/**
 * Check if user is authenticated
 */
export function isAuthenticated() {
  const token = localStorage.getItem("auth_token");
  console.log("isAuthenticated check - token exists:", !!token);
  return !!token;
}

/**
 * Handle authenticated API requests
 * Redirects to login if no token is found
 */
export function requireAuth() {
  if (!isAuthenticated()) {
    console.log("User not authenticated, redirecting to login");
    // Redirect to login page
    window.location.href = "/login";
    return false;
  }
  return true;
}

// Add this helper function to get the auth token
export function getAuthToken() {
  return localStorage.getItem("auth_token");
}

// If you're using axios for some requests, add an axios interceptor
export function setupAxiosInterceptors() {
  axios.interceptors.request.use(
    (config: InternalAxiosRequestConfig) => {
      const token = getAuthToken();
      if (token) {
        console.log("Auth interceptor - token: Found token");
        config.headers = config.headers || {};
        config.headers['Authorization'] = `Bearer ${token}`;
      } else {
        console.log("Auth interceptor - token: No token found");
      }
      config.withCredentials = true; // Add this line to ensure cookies are sent
      return config;
    },
    (error) => {
      return Promise.reject(error);
    }
  );

  return axios;
}

// Add a function to verify the token with the backend
export async function verifyToken() {
  const token = getAuthToken();
  if (!token) {
    return { valid: false, message: "No token found" };
  }

  try {
    const response = await fetch(`${API_BASE_URL}/api/auth/verify-token`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`
      },
      credentials: 'include'
    });

    if (response.ok) {
      const data = await response.json();
      return { valid: true, data };
    } else {
      // Token is invalid or expired
      return { valid: false, message: "Invalid or expired token" };
    }
  } catch (error) {
    console.error("Token verification failed:", error);
    return { valid: false, message: "Token verification failed" };
  }
}

// Add this function to debug token issues
export async function debugToken() {
  const token = getAuthToken();
  if (!token) {
    console.error("No token found");
    return { success: false, message: "No token found" };
  }

  try {
    console.log("Testing token:", token.substring(0, 10) + "...");
    const response = await fetch(`${API_BASE_URL}/api/auth/debug-token`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`
      },
      credentials: 'include'
    });

    const data = await response.json();
    console.log("Token debug response:", data);
    return data;
  } catch (error) {
    console.error("Token debug failed:", error);
    return { success: false, error };
  }
}

// Add this function to debug the token format and algorithm
export function debugAuthToken() {
  const token = localStorage.getItem("auth_token");
  if (!token) {
    console.error("No auth token found in localStorage");
    return null;
  }

  try {
    // Split the token to see its parts
    const parts = token.split('.');
    if (parts.length !== 3) {
      console.error("Token does not appear to be a valid JWT (should have 3 parts)");
      return null;
    }

    // Decode the header (first part)
    const header = JSON.parse(atob(parts[0]));
    console.log("Token header:", header);
    console.log("Token algorithm:", header.alg);

    // Decode the payload (middle part)
    const payload = JSON.parse(atob(parts[1]));
    console.log("Token payload:", payload);

    // Check expiration
    if (payload.exp) {
      const expiryDate = new Date(payload.exp * 1000);
      const now = new Date();
      console.log("Token expires:", expiryDate);
      console.log("Is expired:", expiryDate < now);
    }

    return { header, payload };
  } catch (e) {
    console.error("Error parsing token:", e);
    return null;
  }
}

// Add this function to convert Firebase/Google token to a custom token
export async function exchangeToken(googleToken: string) {
  try {
    console.log("Exchanging Google token for custom token");
    const response = await fetch(`${API_BASE_URL}/api/auth/exchange-google-token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
      body: JSON.stringify({ idToken: googleToken }),
    });

    if (!response.ok) {
      throw new Error(`Token exchange failed: ${response.statusText}`);
    }

    return await response.json();
  } catch (error) {
    console.error('Error exchanging token:', error);
    throw error;
  }
}

// Call this function on login success
// export async function loginUser(email: string, password: string) {
//   try {
//     const response = await apiRequest("/api/auth/login", {
//       method: "POST",
//       body: JSON.stringify({ email, password }),
//     });

//     // Store the token if it's in the response
//     if (response.token) {
//       console.log("Login successful, storing auth token");
//       localStorage.setItem("auth_token", response.token);

//       // Debug the token after storing
//       debugAuthToken();

//       return { success: true, data: response };
//     } else if (response.success) {
//       // If no token in response but login was successful
//       console.log("Login successful (using HTTP-only cookies)");
//       return { success: true, data: response };
//     } else {
//       console.error("Login response missing token:", response);
//       return { success: false, error: "No token in response" };
//     }
//   } catch (error) {
//     console.error("Login failed:", error);
//     return { success: false, error };
//   }
// }

// Call this function on app initialization
debugAuthToken();
