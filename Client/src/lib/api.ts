import { config } from './config';
import axios, {
  AxiosRequestConfig,
  InternalAxiosRequestConfig,
  AxiosError,
  AxiosInstance // Add this import
} from 'axios';
import { refreshFirebaseToken, auth } from './auth';
import { checkIsAuthenticated } from './auth-helper'; // Import the function from auth-helper

const API_BASE_URL = config.api.baseUrl;
console.log('API_BASE_URL:', API_BASE_URL);
// Create an authenticated axios instance
export const authAxios = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true
});

// Create a more advanced instance with token refresh capabilities
export const axiosInstance = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true
});

// Initialize token refresh interceptors on both axios instances
function setupTokenRefreshInterceptor(axiosInstance: AxiosInstance) {
  // Request interceptor
  axiosInstance.interceptors.request.use(
    async (config: InternalAxiosRequestConfig) => {
      console.log(`Request to ${config.url}: Preparing auth token...`);

      // Always prioritize getting a fresh Firebase token if available
      if (auth.currentUser) {
        try {
          const token = await auth.currentUser.getIdToken(false);
          config.headers.Authorization = `Bearer ${token}`;
          console.log(`Request to ${config.url}: Using Firebase token`);

          // Always keep localStorage token in sync
          localStorage.setItem("auth_token", token);
        } catch (error) {
          console.warn(`Request to ${config.url}: Unable to get Firebase token:`, error);
        }
      }

      // Fallback to localStorage token if needed
      if (!config.headers.Authorization) {
        const token = localStorage.getItem("auth_token");
        if (token) {
          config.headers.Authorization = `Bearer ${token}`;
          console.log(`Request to ${config.url}: Using localStorage token`);
        } else {
          console.warn(`Request to ${config.url}: No token available`);
        }
      }

      return config;
    },
    (error) => Promise.reject(error)
  );

  // Response interceptor with enhanced debugging
  axiosInstance.interceptors.response.use(
    (response) => response,
    async (error) => {
      const originalRequest = error.config;
      const url = originalRequest?.url || 'unknown';

      console.log(`Response error for ${url}: ${error.response?.status}`);

      // If error is 401 and we can refresh, try again with fresh token
      if (error.response?.status === 401 && auth.currentUser && !originalRequest._retry) {
        originalRequest._retry = true;

        try {
          console.log(`Token rejected for ${url}, forcing refresh...`);
          // Force refresh the token
          const newToken = await auth.currentUser.getIdToken(true);
          console.log('Token refreshed successfully');

          // Update authorization header
          originalRequest.headers.Authorization = `Bearer ${newToken}`;
          localStorage.setItem("auth_token", newToken);

          // Retry with fresh token
          return axiosInstance(originalRequest);
        } catch (refreshError) {
          console.error('Failed to refresh token:', refreshError);
        }
      }

      return Promise.reject(error);
    }
  );
}

// Apply interceptors to both instances
setupTokenRefreshInterceptor(authAxios);
setupTokenRefreshInterceptor(axiosInstance);

// Helper functions for API requests using axiosInstance (with token refresh)
export async function fetchPortfolioData() {
  if (!isAuthenticated()) {
    console.warn("Attempting to fetch portfolio without authentication");
    return Promise.reject(new Error("Authentication required"));
  }
  return axiosInstance.get('/api/portfolio');
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

    // Use axiosInstance instead of authAxios for token refresh ability
    const response = await axiosInstance.get('/api/trades');

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
  // Use axiosInstance instead of authAxios for token refresh ability
  return axiosInstance.get('/api/positions');
}

export async function fetchBotConfig() {
  if (!isAuthenticated()) {
    console.warn("Attempting to fetch bot config without authentication");
    return Promise.reject(new Error("Authentication required"));
  }
  // Use axiosInstance instead of authAxios for token refresh ability
  return axiosInstance.get('/api/bot/config');
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
    const response = await fetch(`${config.api.baseUrl}${endpoint}`, {
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
    const response = await fetch(`${config.api.baseUrl}/api/auth/google-verify`, {
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

      if (exchangeResult.success) {
        if (exchangeResult.token) {
          localStorage.setItem("auth_token", exchangeResult.token);
        } else {
          localStorage.setItem("auth_token", idToken);
        }
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
// Enhanced getUserProfile function - simplified to use only the main profile endpoint
export async function getUserProfile() {
  try {
    // First check if we have a current Firebase user and ensure a fresh token
    if (auth.currentUser) {
      try {
        console.log("Refreshing Firebase token");
        const freshToken = await auth.currentUser.getIdToken(true);
        localStorage.setItem("auth_token", freshToken);
        console.log("Using fresh Firebase token (RS256)");
      } catch (e) {
        console.error("Failed to refresh Firebase token:", e);
      }
    }

    // Get token (might be Firebase RS256 or custom HS256)
    const token = localStorage.getItem("auth_token");
    if (!token) {
      throw new Error("No authentication token available");
    }

    // Use only the main profile endpoint
    console.log("Fetching user profile");
    const response = await axios({
      method: 'get',
      url: `${config.api.baseUrl}/api/users/profile`,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      }
    });

    if (response.status >= 200 && response.status < 300) {
      console.log("Profile fetch successful");
      return response.data;
    }

    // If endpoint fails, create a fallback user
    console.log("Profile endpoint failed, returning fallback user");
    return {
      username: "Demo User",
      email: "demo@example.com",
      paperBalance: 10000,
      createdAt: new Date().toISOString()
    };
  } catch (error) {
    console.error('Error in getUserProfile:', error);
    return {
      username: "Demo User",
      email: "demo@example.com",
      paperBalance: 10000,
      createdAt: new Date().toISOString()
    };
  }
}

// Add a function to test token validity
export async function testTokenValidity() {
  const token = localStorage.getItem("auth_token");
  if (!token) {
    console.error("No auth token to test");
    return { valid: false };
  }

  try {
    console.log("Testing token validity...");

    // Try multiple authorization header formats
    const headerFormats = [
      { name: "Bearer format", header: `Bearer ${token}` },
      { name: "Raw token", header: token },
      { name: "Firebase format", header: `Firebase ${token}` }
    ];

    for (const format of headerFormats) {
      try {
        console.log(`Testing with ${format.name}`);
        const response = await fetch(`${config.api.baseUrl}/api/auth/verify-token`, {
          method: 'GET',
          headers: {
            'Authorization': format.header,
            'Content-Type': 'application/json'
          },
          credentials: 'include'
        });

        if (response.ok) {
          console.log(`✅ ${format.name} ACCEPTED`);
          // Update all axios instances to use this format
          if (format.name !== "Bearer format") {
            console.log(`Switching to ${format.name} for all requests`);
            axiosInstance.interceptors.request.clear();
            authAxios.interceptors.request.clear();

            setupCustomTokenFormat(axiosInstance, format.name === "Raw token");
            setupCustomTokenFormat(authAxios, format.name === "Raw token");
          }
          return { valid: true, format: format.name };
        } else {
          console.log(`❌ ${format.name} REJECTED (${response.status})`);
        }
      } catch (e: any) { // Type the error as any
        console.error(`Error testing ${format.name}:`, e);
      }
    }

    return { valid: false };
  } catch (error: any) { // Type the error as any
    console.error("Token test failed:", error);
    return { valid: false, error };
  }
}

// Custom token format setup
function setupCustomTokenFormat(axiosInstance: AxiosInstance, useRawToken: boolean) {
  axiosInstance.interceptors.request.use((config: InternalAxiosRequestConfig) => {
    const token = localStorage.getItem("auth_token");
    if (token) {
      config.headers.Authorization = useRawToken ? token : `Bearer ${token}`;
    }
    return config;
  });
}

// Add this helper function to get the auth token
export function getAuthToken() {
  return localStorage.getItem("auth_token");
}

// Add a function to verify the token with the backend
export async function verifyToken() {
  const token = getAuthToken();
  if (!token) {
    return { valid: false, message: "No token found" };
  }

  try {
    const response = await fetch(`${config.api.baseUrl}/api/auth/verify-token`, {
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
  } catch (e: any) { // Type the error as any
    console.error("Error parsing token:", e);
    return null;
  }
}

// Add this function to convert Firebase/Google token to a custom token
export async function exchangeToken(googleToken: string) {
  try {
    console.log("Exchanging Google token for custom token");
    const response = await fetch(`${config.api.baseUrl}/api/auth/exchange-google-token`, {
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

// Force token refresh on application load
(async function initializeAuth() {
  try {
    console.log("Checking authentication status on application start");

    if (auth.currentUser) {
      console.log("User is logged in, refreshing token");
      const newToken = await auth.currentUser.getIdToken(true);
      localStorage.setItem("auth_token", newToken);
      console.log("Token refreshed and stored in localStorage");

      // Debug the token to verify it's valid
      debugAuthToken();
    } else {
      const storedToken = localStorage.getItem("auth_token");
      console.log(storedToken
        ? "No user logged in but found token in localStorage"
        : "No user logged in and no token in localStorage");
    }
  } catch (err) {
    console.error("Error initializing authentication:", err);
  }
})();

/**
 * Check if user is authenticated
 */
export function isAuthenticated() {
  // Use the imported checkIsAuthenticated function
  return checkIsAuthenticated();
}

// Call this function on app initialization
debugAuthToken();

// Add these functions to help with debugging

/**
 * Function to check API health and auth endpoints
 */
export async function checkApiHealth() {
  try {
    // First check API health
    console.log("Checking API health...");
    const healthResult = await axios.get(`${API_BASE_URL}/api/health`);
    console.log("API health check result:", healthResult.status, healthResult.data);

    // Then try the no-auth debug endpoint
    console.log("Checking no-auth debug endpoint...");
    const debugResult = await axios.get(`${API_BASE_URL}/api/users/debug-no-auth`);
    console.log("No-auth debug result:", debugResult.status, debugResult.data);

    // Get the auth token
    const token = localStorage.getItem('auth_token');

    if (token) {
      // Try auth-required endpoints
      console.log("Trying auth debug endpoint with token...");
      try {
        const authDebugResult = await axios.get(`${API_BASE_URL}/api/auth/debug-auth`, {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });
        console.log("Auth debug result:", authDebugResult.status, authDebugResult.data);
      } catch (e: any) {
        console.error("Auth debug error:", e.message);
      }

      // Try profile endpoint
      console.log("Trying profile endpoint with token...");
      try {
        const profileResult = await axios.get(`${API_BASE_URL}/api/users/profile`, {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });
        console.log("Profile result:", profileResult.status, profileResult.data);
      } catch (e: any) {
        console.error("Profile error:", e.message);
      }
    } else {
      console.log("No auth token available for auth tests");
    }

    return { success: true };
  } catch (error: any) {
    console.error("API health check error:", error);
    return {
      success: false,
      error: error.message
    };
  }
}
