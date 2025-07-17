// FreqTrade Bot Manager API Integration
import { useAuth } from '@/contexts/AuthContext';

// API Configuration
const API_CONFIG = {
  production: {
    baseUrl: 'https://freqtrade.crypto-pilot.dev',
    wsUrl: 'wss://freqtrade.crypto-pilot.dev/ws'
  },
  development: {
    baseUrl: 'http://localhost:3001',
    wsUrl: 'ws://localhost:3001/ws'
  }
};

const getCurrentConfig = () => {
  return process.env.NODE_ENV === 'production' 
    ? API_CONFIG.production 
    : API_CONFIG.development;
};

// API Client for FreqTrade Bot Manager
class FreqTradeAPI {
  private baseUrl: string;
  private wsUrl: string;
  private websocket: WebSocket | null = null;
  private subscribers: Map<string, Set<Function>> = new Map();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000;

  constructor() {
    const config = getCurrentConfig();
    this.baseUrl = config.baseUrl;
    this.wsUrl = config.wsUrl;
  }

  // Get auth token from Firebase/Auth context
  private async getAuthToken(): Promise<string> {
    try {
      const { auth } = await import('@/lib/firebase');
      const currentUser = auth.currentUser;
      if (currentUser) {
        return await currentUser.getIdToken();
      }
    } catch (error) {
      console.error('Failed to get Firebase token:', error);
    }
    return '';
  }

  // REST API Methods
  async makeRequest(endpoint: string, options: RequestInit = {}) {
    const token = await this.getAuthToken();
    
    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        ...options.headers,
      },
    });

    if (!response.ok) {
      throw new Error(`FreqTrade API Error: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }

  // Bot Management APIs
  async getBots() {
    return this.makeRequest('/api/bots');
  }

  async getBotDetails(instanceId: string) {
    return this.makeRequest(`/api/bot/${instanceId}`);
  }

  async startBot(instanceId: string) {
    return this.makeRequest(`/api/bot/${instanceId}/start`, { method: 'POST' });
  }

  async stopBot(instanceId: string) {
    return this.makeRequest(`/api/bot/${instanceId}/stop`, { method: 'POST' });
  }

  async updateBotConfig(instanceId: string, config: any) {
    return this.makeRequest(`/api/bot/${instanceId}/config`, {
      method: 'PUT',
      body: JSON.stringify(config),
    });
  }

  // Portfolio APIs
  async getPortfolioSummary() {
    return this.makeRequest('/api/portfolio/summary');
  }

  async getPortfolioHistory(params?: { startDate?: string; endDate?: string; limit?: number }) {
    const queryParams = new URLSearchParams();
    if (params?.startDate) queryParams.append('startDate', params.startDate);
    if (params?.endDate) queryParams.append('endDate', params.endDate);
    if (params?.limit) queryParams.append('limit', params.limit.toString());
    
    const query = queryParams.toString();
    return this.makeRequest(`/api/portfolio/history${query ? `?${query}` : ''}`);
  }

  async getChartData(timeframe: '1H' | '24H' | '7D' | '30D') {
    return this.makeRequest(`/api/portfolio/chart/${timeframe}`);
  }

  // Health Check
  async getHealth() {
    return this.makeRequest('/health');
  }

  // WebSocket Methods
  connectWebSocket(token: string) {
    if (this.websocket?.readyState === WebSocket.OPEN) {
      return; // Already connected
    }

    try {
      const wsUrl = `${this.wsUrl}?token=${encodeURIComponent(token)}`;
      this.websocket = new WebSocket(wsUrl);

      this.websocket.onopen = () => {
        console.log('🎯 FreqTrade WebSocket connected');
        this.reconnectAttempts = 0;
        this.emit('connected', true);
        
        // Subscribe to all available channels
        this.subscribeToUpdates([
          'portfolio',
          'bot_metrics', 
          'timeseries',
          'trade_alerts',
          'bot_status',
          'system_health'
        ]);
      };

      this.websocket.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          this.handleMessage(message);
        } catch (error) {
          console.error('Failed to parse WebSocket message:', error);
        }
      };

      this.websocket.onclose = () => {
        console.log('❌ FreqTrade WebSocket disconnected');
        this.emit('connected', false);
        this.attemptReconnect(token);
      };

      this.websocket.onerror = (error) => {
        console.error('❌ FreqTrade WebSocket error:', error);
        this.emit('error', error);
      };

    } catch (error) {
      console.error('Failed to connect WebSocket:', error);
      this.emit('error', error);
    }
  }

  private attemptReconnect(token: string) {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      console.log(`🔄 Attempting reconnect ${this.reconnectAttempts}/${this.maxReconnectAttempts}`);
      
      setTimeout(() => {
        this.connectWebSocket(token);
      }, this.reconnectDelay * this.reconnectAttempts);
    }
  }

  private handleMessage(message: any) {
    console.log('📨 FreqTrade Message:', message.type);
    
    switch (message.type) {
      case 'portfolio_stream_update':
        this.emit('portfolio_update', message.data);
        break;
      case 'bot_metrics_update':
        this.emit('bot_metrics', message.data);
        break;
      case 'timeseries_stream_update':
        this.emit('timeseries_update', message.data);
        break;
      case 'trade_alert':
        this.emit('trade_alert', message.data);
        break;
      case 'bot_status_update':
        this.emit('bot_status', message.data);
        break;
      case 'system_health_update':
        this.emit('system_health', message.data);
        break;
      case 'subscription_confirmed':
        console.log('✅ Subscriptions confirmed:', message.data.subscribedChannels);
        this.emit('subscriptions_confirmed', message.data);
        break;
      case 'error':
        console.error('❌ FreqTrade API Error:', message.data);
        this.emit('api_error', message.data);
        break;
      default:
        console.log('📝 Unknown message type:', message.type);
    }
  }

  private subscribeToUpdates(channels: string[]) {
    if (this.websocket?.readyState === WebSocket.OPEN) {
      this.websocket.send(JSON.stringify({
        type: 'subscribe_updates',
        data: { channels }
      }));
    }
  }

  // Request specific data
  requestPortfolioSummary() {
    if (this.websocket?.readyState === WebSocket.OPEN) {
      this.websocket.send(JSON.stringify({
        type: 'get_portfolio_summary',
        data: { includeTimeSeries: true }
      }));
    }
  }

  requestChartData(chartType = 'portfolio_value') {
    if (this.websocket?.readyState === WebSocket.OPEN) {
      this.websocket.send(JSON.stringify({
        type: 'get_chart_data',
        data: { chartType }
      }));
    }
  }

  // Bot actions via WebSocket
  sendBotAction(action: 'start' | 'stop' | 'restart', botId: string) {
    if (this.websocket?.readyState === WebSocket.OPEN) {
      this.websocket.send(JSON.stringify({
        type: 'bot_action',
        data: { action, botId }
      }));
    }
  }

  // Event system for subscribers
  subscribe(event: string, callback: Function) {
    if (!this.subscribers.has(event)) {
      this.subscribers.set(event, new Set());
    }
    this.subscribers.get(event)!.add(callback);

    // Return unsubscribe function
    return () => {
      this.subscribers.get(event)?.delete(callback);
    };
  }

  private emit(event: string, data: any) {
    this.subscribers.get(event)?.forEach(callback => {
      try {
        callback(data);
      } catch (error) {
        console.error(`Error in ${event} callback:`, error);
      }
    });
  }

  // Cleanup
  disconnect() {
    if (this.websocket) {
      this.websocket.close();
      this.websocket = null;
    }
    this.subscribers.clear();
  }

  // Connection status
  isConnected(): boolean {
    return this.websocket?.readyState === WebSocket.OPEN;
  }
}

// Create singleton instance
export const freqTradeAPI = new FreqTradeAPI();

// React Hook for FreqTrade integration
export const useFreqTrade = () => {
  const { user } = useAuth();

  // Override the getAuthToken method with actual Firebase token getter
  React.useEffect(() => {
    if (user) {
      // @ts-ignore - We're dynamically setting the private method
      freqTradeAPI.getAuthToken = async () => {
        const { auth } = await import('@/lib/firebase');
        const currentUser = auth.currentUser;
        if (currentUser) {
          return await currentUser.getIdToken();
        }
        return '';
      };
    }
  }, [user]);

  // Auto-connect when user is authenticated
  React.useEffect(() => {
    const connectToWebSocket = async () => {
      if (user) {
        try {
          const { auth } = await import('@/lib/firebase');
          const currentUser = auth.currentUser;
          if (currentUser) {
            const token = await currentUser.getIdToken();
            freqTradeAPI.connectWebSocket(token);
          }
        } catch (error) {
          console.error('Failed to get Firebase token:', error);
        }
      }
    };

    connectToWebSocket();

    return () => {
      freqTradeAPI.disconnect();
    };
  }, [user]);

  return freqTradeAPI;
};

// Data Types
export interface BotData {
  instanceId: string;
  status: 'running' | 'stopped' | 'error' | 'starting' | 'stopping';
  config: any;
  balance: number;
  totalPnL: number;
  openTrades: number;
  closedTrades: number;
  performance: any;
  lastUpdate: number;
}

export interface PortfolioData {
  totalBalance: number;
  totalPnL: number;
  portfolioValue: number;
  botCount: number;
  activeBots: number;
  dailyPnL: number;
  weeklyPnL: number;
  monthlyPnL: number;
  riskMetrics: any;
  lastUpdate: number;
  performanceMetrics: any;
}

export interface TradeAlert {
  tradeId: number;
  pair: string;
  side: 'buy' | 'sell';
  amount: number;
  price: number;
  fee: number;
  profit: number;
  isOpen: boolean;
  openDate: number;
  closeDate?: number;
  strategy: string;
  botId: string;
  timestamp: string;
}

import React from 'react';
