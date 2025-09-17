// Strategy API service for FreqTrade bot strategy management
import { getAuthToken } from './api';

const BASE_URL = 'https://freqtrade.crypto-pilot.dev';

export interface Strategy {
  name: string;
  className: string;
  description: string;
  fileName: string;
}

export interface BotStrategy {
  current: string;
  available: string[];
}

export interface StrategyUpdateResponse {
  success: boolean;
  message: string;
  strategy: {
    current: string;
    restarted: boolean;
  };
}

export const strategyAPI = {
  // Get all available strategies
  async getAvailableStrategies(): Promise<Strategy[]> {
    const token = getAuthToken();
    if (!token) {
      throw new Error('No authentication token available');
    }

    try {
      console.log('🎯 Fetching available strategies...');
      const response = await fetch(`${BASE_URL}/api/strategies`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });
      
      if (!response.ok) {
        throw new Error(`Failed to fetch strategies: ${response.statusText}`);
      }
      
      const data = await response.json();
      console.log('🎯 Available strategies received:', data);
      return data.strategies || [];
    } catch (error) {
      console.error('❌ Error fetching strategies:', error);
      throw error;
    }
  },

  // Get current strategy for a specific bot
  async getBotStrategy(instanceId: string): Promise<BotStrategy> {
    const token = getAuthToken();
    if (!token) {
      throw new Error('No authentication token available');
    }

    try {
      console.log(`🎯 Fetching strategy for bot: ${instanceId}`);
      const response = await fetch(`${BASE_URL}/api/bots/${instanceId}/strategy`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });
      
      if (!response.ok) {
        throw new Error(`Failed to fetch bot strategy: ${response.statusText}`);
      }
      
      const data = await response.json();
      console.log(`🎯 Bot strategy received for ${instanceId}:`, data);
      return data.strategy;
    } catch (error) {
      console.error(`❌ Error fetching bot strategy for ${instanceId}:`, error);
      throw error;
    }
  },

  // Update bot strategy and restart
  async updateBotStrategy(instanceId: string, newStrategy: string): Promise<StrategyUpdateResponse> {
    const token = getAuthToken();
    if (!token) {
      throw new Error('No authentication token available');
    }

    try {
      console.log(`🎯 Updating strategy for bot ${instanceId} to: ${newStrategy}`);
      const response = await fetch(`${BASE_URL}/api/bots/${instanceId}/strategy`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ strategy: newStrategy })
      });
      
      if (!response.ok) {
        throw new Error(`Failed to update strategy: ${response.statusText}`);
      }
      
      const data = await response.json();
      console.log(`🎯 Strategy update response for ${instanceId}:`, data);
      return data;
    } catch (error) {
      console.error(`❌ Error updating bot strategy for ${instanceId}:`, error);
      throw error;
    }
  }
};
