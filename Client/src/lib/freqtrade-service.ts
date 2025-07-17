import { auth } from '@/lib/firebase';

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
  // Check if we should use production or fallback to mock data
  // Since the production server might not be available, we'll implement graceful degradation
  return API_CONFIG.production;
};

// Types from the API documentation
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

// FreqTrade Service Class
export class FreqTradeService {
  private websocket: WebSocket | null = null;
  private config = getCurrentConfig();
  private listeners: Map<string, Set<Function>> = new Map();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000;

  // Get Firebase token
  private async getAuthToken(): Promise<string | null> {
    try {
      const currentUser = auth.currentUser;
      if (currentUser) {
        return await currentUser.getIdToken();
      }
    } catch (error) {
      console.error('Failed to get Firebase token:', error);
    }
    return null;
  }

  // HTTP Request helper
  private async makeRequest(endpoint: string, options: RequestInit = {}): Promise<any> {
    const token = await this.getAuthToken();
    if (!token) {
      throw new Error('No authentication token available');
    }

    try {
      const response = await fetch(`${this.config.baseUrl}${endpoint}`, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          ...options.headers,
        },
      });

      if (!response.ok) {
        if (response.status === 404) {
          console.log('❌ FreqTrade server endpoint not found. Server may be unavailable.');
          this.emit('fallback_mode', true);
          return this.getMockData(endpoint);
        }
        throw new Error(`API Error: ${response.status} ${response.statusText}`);
      }

      return response.json();
    } catch (error) {
      console.error('❌ FreqTrade API request failed:', error);
      console.log('🔄 Using fallback mock data...');
      this.emit('fallback_mode', true);
      return this.getMockData(endpoint);
    }
  }

  // WebSocket connection
  async connectWebSocket(): Promise<void> {
    const token = await this.getAuthToken();
    if (!token) {
      throw new Error('No authentication token for WebSocket connection');
    }

    if (this.websocket?.readyState === WebSocket.OPEN) {
      return; // Already connected
    }

    try {
      const wsUrl = `${this.config.wsUrl}?token=${encodeURIComponent(token)}`;
      this.websocket = new WebSocket(wsUrl);

      this.websocket.onopen = () => {
        console.log('🎯 FreqTrade WebSocket connected');
        this.reconnectAttempts = 0;
        this.emit('connected', true);
        
        // Subscribe to all channels
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
        this.attemptReconnect();
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

  private attemptReconnect() {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      console.log(`🔄 Attempting reconnect ${this.reconnectAttempts}/${this.maxReconnectAttempts}`);
      
      setTimeout(() => {
        this.connectWebSocket();
      }, this.reconnectDelay * this.reconnectAttempts);
    } else {
      console.log('❌ Max reconnection attempts reached. FreqTrade server may be unavailable.');
      console.log('🔄 Switching to fallback mode with simulated data...');
      this.emit('fallback_mode', true);
    }
  }

  private handleMessage(message: any) {
    console.log('📨 FreqTrade Message:', message.type, message.data ? '(with data)' : '(no data)');
    
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
      case 'connection_established':
        console.log('🔗 Connection established to FreqTrade service');
        this.emit('connection_established', message.data);
        break;
      case 'portfolio_summary':
        // Handle portfolio summary response from WebSocket
        console.log('📊 Portfolio Summary received via WebSocket');
        this.emit('portfolio_update', message.data);
        break;
      case 'portfolio_history':
        // Handle portfolio history response with timeframe data
        console.log('📈 Portfolio History received via WebSocket:', message.data?.length || 0, 'data points');
        console.log('📈 Portfolio History full message:', message);
        // Pass the entire message to preserve request context (timeframe, etc.)
        this.emit('portfolio_history', message);
        break;
      case 'timeseries_data':
        // Handle timeseries data response
        console.log('📊 Timeseries Data received via WebSocket:', message.data?.length || 0, 'data points');
        this.emit('timeseries_data', message.data);
        break;
      case 'chart_data':
        // Handle chart data response
        console.log('📈 Chart Data received via WebSocket:', message.data?.data?.length || 0, 'data points');
        console.log('📈 Chart Data full message:', message);
        // Pass the entire message to preserve request context (timeframe, etc.)
        this.emit('chart_data', message);
        break;
      case 'bots':
        // Handle bot list response from WebSocket
        console.log('🤖 Bot list received via WebSocket');
        this.emit('bot_metrics', message.data);
        break;
      case 'error':
        console.error('❌ FreqTrade API Error:', message.data);
        this.emit('api_error', message.data || message);
        break;
      default:
        console.log('📝 Unknown message type:', message.type, '- Data:', message.data);
        // Emit unknown messages in case they contain useful data
        this.emit('unknown_message', message);
        break;
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

  // HTTP API Methods
  async getBots(): Promise<{ success: boolean; bots: BotData[] }> {
    return this.makeRequest('/api/bots');
  }

  async getBotDetails(instanceId: string): Promise<{ success: boolean; bot: BotData }> {
    return this.makeRequest(`/api/bot/${instanceId}`);
  }

  async startBot(instanceId: string): Promise<any> {
    return this.makeRequest(`/api/bot/${instanceId}/start`, { method: 'POST' });
  }

  async stopBot(instanceId: string): Promise<any> {
    return this.makeRequest(`/api/bot/${instanceId}/stop`, { method: 'POST' });
  }

  async updateBotConfig(instanceId: string, config: any): Promise<any> {
    return this.makeRequest(`/api/bot/${instanceId}/config`, {
      method: 'PUT',
      body: JSON.stringify(config),
    });
  }

  async getPortfolioSummary(): Promise<{ success: boolean; portfolio: PortfolioData }> {
    return this.makeRequest('/api/portfolio/summary');
  }

  async getPortfolioHistory(params?: { startDate?: string; endDate?: string; limit?: number }): Promise<any> {
    const queryParams = new URLSearchParams();
    if (params?.startDate) queryParams.append('startDate', params.startDate);
    if (params?.endDate) queryParams.append('endDate', params.endDate);
    if (params?.limit) queryParams.append('limit', params.limit.toString());
    
    const query = queryParams.toString();
    return this.makeRequest(`/api/portfolio/history${query ? `?${query}` : ''}`);
  }

  async getChartData(timeframe: '1H' | '24H' | '7D' | '30D'): Promise<any> {
    // Use the correct endpoint structure from the documentation
    return this.makeRequest(`/api/portfolio/chart/${timeframe}`);
  }

  async getHealth(): Promise<any> {
    return this.makeRequest('/health');
  }

  // WebSocket request methods
  requestPortfolioSummary() {
    if (this.websocket?.readyState === WebSocket.OPEN) {
      this.websocket.send(JSON.stringify({
        type: 'get_portfolio_summary',
        data: { includeTimeSeries: true }
      }));
    }
  }

  requestChartData(timeframe = '24H') {
    if (this.websocket?.readyState === WebSocket.OPEN) {
      console.log(`📊 Requesting chart data for timeframe: ${timeframe}`);
      // Request timeseries data for the specific timeframe
      this.websocket.send(JSON.stringify({
        type: 'get_timeseries_data',
        data: { timeframe }
      }));
      // Also request portfolio history for historical data
      this.websocket.send(JSON.stringify({
        type: 'get_portfolio_history',
        data: { 
          timeframe,
          includeMetadata: true 
        }
      }));
    }
  }

  // New method to request portfolio history specifically
  requestPortfolioHistory(timeframe: '1H' | '24H' | '7D' | '30D') {
    if (this.websocket?.readyState === WebSocket.OPEN) {
      console.log(`📈 Requesting portfolio history for timeframe: ${timeframe}`);
      this.websocket.send(JSON.stringify({
        type: 'get_portfolio_history',
        data: { 
          timeframe,
          includeMetadata: true,
          startDate: this.getStartDateForTimeframe(timeframe)
        }
      }));
    }
  }

  // Helper to calculate start date based on timeframe
  private getStartDateForTimeframe(timeframe: string): string {
    const now = new Date();
    const startDate = new Date();
    
    switch (timeframe) {
      case '1H':
        startDate.setHours(now.getHours() - 1);
        break;
      case '24H':
        startDate.setDate(now.getDate() - 1);
        break;
      case '7D':
        startDate.setDate(now.getDate() - 7);
        break;
      case '30D':
        startDate.setDate(now.getDate() - 30);
        break;
      default:
        startDate.setDate(now.getDate() - 1);
    }
    
    return startDate.toISOString().split('T')[0]; // Return YYYY-MM-DD format
  }

  sendBotAction(action: 'start' | 'stop' | 'restart', botId: string) {
    if (this.websocket?.readyState === WebSocket.OPEN) {
      this.websocket.send(JSON.stringify({
        type: 'bot_action',
        data: { action, botId }
      }));
    }
  }

  requestBotData() {
    if (this.websocket?.readyState === WebSocket.OPEN) {
      console.log('🤖 Requesting bot data via WebSocket');
      this.websocket.send(JSON.stringify({
        type: 'get_bots',
        data: {}
      }));
    }
  }

  // Event system
  on(event: string, callback: Function): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback);

    return () => {
      this.listeners.get(event)?.delete(callback);
    };
  }

  private emit(event: string, data: any) {
    this.listeners.get(event)?.forEach(callback => {
      try {
        callback(data);
      } catch (error) {
        console.error(`Error in ${event} callback:`, error);
      }
    });
  }

  // Mock data fallback when server is unavailable
  private getMockData(endpoint: string): any {
    console.log('📝 Returning mock data for endpoint:', endpoint);
    
    if (endpoint.includes('/bots')) {
      return {
        bots: [
          {
            instanceId: 'mock-bot-1',
            status: 'stopped',
            config: { strategy: 'MockStrategy' },
            balance: 1000,
            totalPnL: 50.25,
            openTrades: 0,
            closedTrades: 25,
            performance: { winRate: 0.65 },
            lastUpdate: Date.now()
          },
          {
            instanceId: 'mock-bot-2', 
            status: 'stopped',
            config: { strategy: 'MockStrategy2' },
            balance: 1500,
            totalPnL: -25.50,
            openTrades: 0,
            closedTrades: 15,
            performance: { winRate: 0.45 },
            lastUpdate: Date.now()
          }
        ]
      };
    }
    
    if (endpoint.includes('/portfolio/summary')) {
      return {
        success: true,
        portfolio: {
          totalBalance: 2500,
          totalPnL: 24.75,
          portfolioValue: 2524.75,
          botCount: 2,
          activeBots: 0,
          dailyPnL: 5.25,
          weeklyPnL: 24.75,
          monthlyPnL: 127.50,
          riskMetrics: {},
          lastUpdate: Date.now(),
          performanceMetrics: {}
        }
      };
    }
    
    if (endpoint.includes('/portfolio/chart')) {
      return {
        success: true,
        timeframe: endpoint.split('/').pop(),
        data: [
          {
            timestamp: Date.now() - 3600000,
            portfolioValue: 2480.25,
            totalPnL: 20.50,
            totalBalance: 2459.75
          },
          {
            timestamp: Date.now() - 1800000,
            portfolioValue: 2510.75,
            totalPnL: 30.25,
            totalBalance: 2480.50
          },
          {
            timestamp: Date.now(),
            portfolioValue: 2524.75,
            totalPnL: 24.75,
            totalBalance: 2500.00
          }
        ]
      };
    }
    
    if (endpoint.includes('/trades')) {
      return {
        trades: [
          {
            id: 'mock-trade-1',
            pair: 'BTC/USDT',
            side: 'buy',
            amount: 0.001,
            price: 45000,
            timestamp: new Date().toISOString(),
            date: new Date().toISOString()
          }
        ]
      };
    }
    
    return { message: 'Mock data', endpoint };
  }

  disconnect() {
    if (this.websocket) {
      this.websocket.close();
      this.websocket = null;
    }
    this.listeners.clear();
  }

  isConnected(): boolean {
    return this.websocket?.readyState === WebSocket.OPEN;
  }
}

// Create singleton instance
export const freqTradeService = new FreqTradeService();
