/**
 * Application configuration
 */

// Determine if we're in production based on NODE_ENV
const isProduction = import.meta.env.NODE_ENV === 'production';

// Get the appropriate URLs based on environment
const API_URL = isProduction
  ? import.meta.env.VITE_PROD_API_URL || 'https://api.crypto-pilot.dev'
  : import.meta.env.VITE_DEV_API_URL || 'http://localhost:5000';

const CLIENT_URL = isProduction
  ? import.meta.env.VITE_PROD_CLIENT_URL || 'https://crypto-pilot.dev'
  : import.meta.env.VITE_DEV_CLIENT_URL || 'http://localhost:5173';

export const config = {
  api: {
    baseUrl: API_URL,
  },
  client: {
    baseUrl: CLIENT_URL,
  },
  auth: {
    // Auth related configuration can go here
    tokenStorageKey: "auth_token",
  }
};

// Export environment information for use throughout the app
export const env = {
  isProduction,
  apiUrl: API_URL,
  clientUrl: CLIENT_URL
};
