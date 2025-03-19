import { config } from './config';
import axios from 'axios';

/**
 * Auth debug utility to help diagnose authentication issues
 */
export class AuthDebug {
    static async testEndpoint(endpoint: string): Promise<{
        success: boolean;
        data?: any;
        error?: string;
        statusCode?: number;
    }> {
        try {
            console.log(`Testing endpoint: ${endpoint}`);

            // Get token from localStorage
            const token = localStorage.getItem('auth_token');
            console.log(`Token available: ${!!token}`);
            if (token) {
                console.log(`Token preview: ${token.substring(0, 15)}...`);
            }

            const headers: Record<string, string> = {};
            if (token) {
                headers['Authorization'] = `Bearer ${token}`;
            }

            console.log(`Making request to ${config.api.baseUrl}${endpoint}`);
            const response = await axios.get(`${config.api.baseUrl}${endpoint}`, {
                headers,
                validateStatus: () => true // Don't throw on any status code
            });

            console.log(`Response status: ${response.status}`);
            console.log(`Response data:`, response.data);

            return {
                success: response.status >= 200 && response.status < 300,
                statusCode: response.status,
                data: response.data
            };
        } catch (error: any) {
            console.error(`Error testing endpoint ${endpoint}:`, error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    static async runFullDiagnostics() {
        console.log('=== STARTING AUTH DIAGNOSTICS ===');

        // 1. Check the no-auth endpoint to make sure routing works
        const noAuthResult = await this.testEndpoint('/api/users/debug-no-auth');
        console.log('No-auth test result:', noAuthResult.success ? 'SUCCESS' : 'FAILED');

        // 2. Check auth-specific debug endpoint
        const authDebugResult = await this.testEndpoint('/api/auth/debug-auth');
        console.log('Auth debug result:', authDebugResult.success ? 'SUCCESS' : 'FAILED');

        // 3. Try the regular profile endpoint
        const profileResult = await this.testEndpoint('/api/users/profile');
        console.log('Profile endpoint result:', profileResult.success ? 'SUCCESS' : 'FAILED');

        // 4. Try the alt profile endpoint
        const profileAltResult = await this.testEndpoint('/api/users/profile-alt');
        console.log('Profile-alt endpoint result:', profileAltResult.success ? 'SUCCESS' : 'FAILED');

        return {
            noAuthResult,
            authDebugResult,
            profileResult,
            profileAltResult
        };
    }
}

// Export a simple function to run diagnostics
export async function runAuthDiagnostics() {
    return await AuthDebug.runFullDiagnostics();
}
