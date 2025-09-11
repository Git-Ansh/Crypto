/**
 * FreqTrade SSE Service - Server-Sent Events Integration
 * Based on the FreqTrade Bot Manager API Documentation
 */

import { getAuthToken } from '@/lib/api';

// API Configuration
const FREQTRADE_API_BASE = 'https://freqtrade.crypto-pilot.dev';

// Types based on API documentation
export interface PortfolioData {
  timestamp: string;
  portfolioValue: number;
  totalPnL: number;
  pnlPercentage: number;
  activeBots: number;
  botCount: number;
  totalBalance: number;
  startingBalance: number;
  bots: BotData[];
}

export interface BotData {
  instanceId: string;
  status: string;
  balance: number;
  pnl: number;
  strategy: string;
  lastUpdate: string;
}

export interface TradeData {
  tradeId: string;
  pair: string;
  side: 'buy' | 'sell';
  amount: number;
  price: number;
  timestamp: string;
  openDate: string;
  profit?: number;
}

export interface PositionData {
  botId: string;
  pair: string;
  side: 'buy' | 'sell';
  amount: number;
  entryPrice: number;
  currentPrice: number;
  pnl: number;
  pnlPercent: number;
  mode: string;
  lastUpdate: string;
}

export interface ChartDataPoint {
  timestamp: string;
  portfolioValue: number;
  totalPnL: number;
  activeBots: number;
  botCount: number;
  isLive?: boolean; // Optional flag to mark live vs historical data points
}

export interface ChartResponse {
  success: boolean;
  interval: string;
  data: ChartDataPoint[];
  metadata: {
    totalPoints: number;
    timeRange: {
      start: string;
      end: string;
    };
    aggregationWindow: string;
  };
}

export interface HealthResponse {
  ok: boolean;
  status: string;
  service: string;
  uptime: number;
  timestamp: string;
}

export class FreqTradeSSEService {
  private eventSource: EventSource | null = null;
  private listeners: Map<string, Set<Function>> = new Map();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000;
  private isConnected = false;
  private lastConnectionAttempt = 0;
  private connectionCooldown = 3000; // Minimum 3 seconds between connection attempts

  constructor() {
    console.log('🚀 FreqTrade SSE Service initialized');
  }

  // Event listener management
  on(event: string, callback: Function): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback);

    // Return unsubscribe function
    return () => {
      this.listeners.get(event)?.delete(callback);
    };
  }

  private emit(event: string, data: any) {
    this.listeners.get(event)?.forEach(callback => {
      try {
        callback(data);
      } catch (error) {
        console.error(`Error in event listener for ${event}:`, error);
      }
    });
  }

  // Connect to SSE stream
  async connect(): Promise<void> {
    console.log('🔌 ===== SSE CONNECT METHOD CALLED =====');
    console.log('🔌 Connect method started');

    // Check connection cooldown to prevent rapid successive attempts
    const now = Date.now();
    const timeSinceLastAttempt = now - this.lastConnectionAttempt;
    if (timeSinceLastAttempt < this.connectionCooldown) {
      const waitTime = this.connectionCooldown - timeSinceLastAttempt;
      console.log(`🕐 Connection cooldown active, waiting ${waitTime}ms before attempting connection`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }

    this.lastConnectionAttempt = Date.now();

    const token = getAuthToken();
    console.log('🔌 Token available:', !!token);

    if (!token) {
      console.error('🔌 No authentication token available for SSE connection');
      throw new Error('No authentication token available for SSE connection');
    }

    if (this.eventSource && this.eventSource.readyState === EventSource.OPEN) {
      console.log('🔄 SSE already connected');
      return;
    }

    // Prevent multiple simultaneous connection attempts
    if (this.eventSource && this.eventSource.readyState === EventSource.CONNECTING) {
      console.log('🔄 SSE connection already in progress, waiting...');
      return;
    }

    // Close any existing connection before creating new one
    if (this.eventSource) {
      console.log('🔄 Closing existing SSE connection before reconnecting...');
      this.eventSource.close();
      this.eventSource = null;
    }

    try {
      // Skip health check to avoid rate limiting issues
      console.log('� Connecting directly to FreqTrade SSE stream (skipping health check)...');
      console.log('🔌 FreqTrade API base URL:', FREQTRADE_API_BASE);              // Removed duplicate log line

      // Try both authentication methods
      // Method 1: Query parameter (current)
      const sseUrlWithQuery = `${FREQTRADE_API_BASE}/api/stream?token=${encodeURIComponent(token)}`;

      // Method 2: Authorization header (alternative - but EventSource doesn't support custom headers directly)
      // For now, let's stick with query parameter but add better error handling

      console.log('🔌 SSE URL (token redacted):', sseUrlWithQuery.replace(/token=[^&]+/, 'token=[REDACTED]'));

      this.eventSource = new EventSource(sseUrlWithQuery);
      console.log('🔌 EventSource created, readyState:', this.eventSource.readyState);

      // Listen for specific SSE event types
      this.eventSource?.addEventListener('portfolio', (event: any) => {
        console.log(`🎯 SSE 'portfolio' event received:`, event.data);
        try {
          const data = JSON.parse(event.data);
          console.log('📊 Processing portfolio event data:', data);
          this.handlePortfolioUpdate(data);
        } catch (error) {
          console.error('❌ Failed to parse portfolio event:', error);
        }
      });

      this.eventSource?.addEventListener('bot_update', (event: any) => {
        console.log(`🎯 SSE 'bot_update' event received:`, event.data);
        try {
          const data = JSON.parse(event.data);
          this.emit('bot_update', data);
        } catch (error) {
          console.error('❌ Failed to parse bot_update event:', error);
        }
      });

      this.eventSource?.addEventListener('positions', (event: any) => {
        console.log(`🎯 SSE 'positions' event received:`, event.data);
        try {
          const data = JSON.parse(event.data);
          this.emit('positions_update', data.positions || []);
        } catch (error) {
          console.error('❌ Failed to parse positions event:', error);
        }
      }); this.eventSource.onopen = () => {
        console.log('✅ FreqTrade SSE connection established');
        console.log('✅ SSE URL was:', `${FREQTRADE_API_BASE}/api/stream?token=[REDACTED]`);
        console.log('✅ SSE readyState after open:', this.eventSource?.readyState);
        console.log('✅ Setting connection status to true and emitting connected event');
        this.isConnected = true;
        this.reconnectAttempts = 0;
        this.emit('connected', true);

        // Add a test to see if we receive any events at all
        setTimeout(() => {
          console.log('🕐 5 seconds after SSE connection - checking for messages...');
          console.log('🕐 SSE readyState:', this.eventSource?.readyState);
          console.log('🕐 Connection status:', this.isConnected);
          console.log('🕐 If no SSE messages appear above, the server may not be sending events');
        }, 5000);
      };

      this.eventSource.onmessage = (event) => {
        // Default message handler - most events should use specific event types
        console.log('📨 SSE default message received');

        try {
          const data = JSON.parse(event.data);
          console.log('📨 Default message data keys:', Object.keys(data || {}));

          // Handle as portfolio update if it has portfolio data
          if (data && typeof data === 'object' && data.portfolioValue) {
            console.log('📨 Processing default message as portfolio update');
            this.handlePortfolioUpdate(data);
          }
        } catch (error) {
          console.error('❌ Failed to parse default SSE message:', error);
        }
      };

      this.eventSource.onerror = (error) => {
        console.error('❌ SSE connection error:', error);
        console.error('❌ SSE readyState:', this.eventSource?.readyState);
        console.error('❌ SSE URL was:', `${FREQTRADE_API_BASE}/api/stream?token=[REDACTED]`);

        this.isConnected = false;
        this.emit('connected', false);

        // Check if this might be a rate limiting issue
        if (this.reconnectAttempts > 0) {
          console.warn('⚠️ Multiple connection failures detected - possible rate limiting');
        }

        if (this.eventSource?.readyState === EventSource.CLOSED) {
          console.log('🔄 SSE connection closed, attempting reconnect with backoff...');
          this.attemptReconnect();
        } else {
          console.log('🔄 SSE connection error, but not closed. ReadyState:', this.eventSource?.readyState);
          // Also try to reconnect for other error states after a delay
          setTimeout(() => {
            if (!this.isConnected) {
              this.attemptReconnect();
            }
          }, 2000);
        }
      };

    } catch (error) {
      console.error('❌ Failed to establish SSE connection:', error);
      this.emit('error', error);
      throw error;
    }
  }

  // Handle portfolio data updates from SSE
  private handlePortfolioUpdate(data: any) {
    console.log('📊 Portfolio update - Value:', data.portfolioValue, 'P&L:', data.totalPnL, 'Bots:', data.activeBots);

    // Convert timestamp from number to ISO string if needed
    const normalizedTimestamp = typeof data.timestamp === 'number'
      ? new Date(data.timestamp).toISOString()
      : data.timestamp || new Date().toISOString();

    // The server sends exact field names, so let's use them directly
    const normalizedData: PortfolioData = {
      timestamp: normalizedTimestamp,
      portfolioValue: data.portfolioValue || 0,
      totalPnL: data.totalPnL || 0,
      pnlPercentage: data.pnlPercentage || 0,
      activeBots: data.activeBots || 0,
      botCount: data.botCount || 0,
      totalBalance: data.totalBalance || data.portfolioValue || 0,
      startingBalance: data.startingBalance || data.starting_balance || 0,
      bots: data.bots || []
    };

    // Emit portfolio data update with normalized data
    this.emit('portfolio_update', normalizedData);

    // Emit bot data if present
    if (normalizedData.bots && normalizedData.bots.length > 0) {
      this.emit('bot_update', normalizedData.bots);
    }

    // Update last update timestamp
    const timestamp = normalizedData.timestamp ? new Date(normalizedData.timestamp) : new Date();
    this.emit('last_update', timestamp);
  }

  // Reconnection logic with exponential backoff
  private attemptReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('❌ Max SSE reconnection attempts reached');
      console.log('🔄 Falling back to periodic polling instead of SSE');
      this.emit('connection_failed', 'Max reconnection attempts reached - using HTTP polling fallback');

      // Start HTTP polling fallback every 30 seconds
      this.startHttpPollingFallback();
      return;
    }

    this.reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);

    console.log(`🔄 Attempting SSE reconnection ${this.reconnectAttempts}/${this.maxReconnectAttempts} in ${delay}ms...`);

    setTimeout(() => {
      this.connect().catch(error => {
        console.error('❌ SSE reconnection failed:', error);
      });
    }, delay);
  }

  // HTTP polling fallback when SSE fails
  private startHttpPollingFallback() {
    console.log('📡 Starting HTTP polling fallback - trying SSE reconnection periodically');

    const pollInterval = setInterval(async () => {
      try {
        // Try to reconnect via SSE instead of health checks to avoid rate limits
        if (!this.isConnected) {
          console.log('📡 Attempting SSE reconnection from polling fallback...');
          this.reconnectAttempts = 0; // Reset attempts for fresh try
          await this.connect();
        }
      } catch (error) {
        console.error('📡 Polling fallback reconnection failed:', error);
      }
    }, 60000); // Poll every 60 seconds (less frequent to avoid rate limits)

    // Store interval ID for cleanup
    (this as any).pollingInterval = pollInterval;
  }

  // Disconnect SSE
  disconnect() {
    if (this.eventSource) {
      console.log('🔌 Disconnecting from FreqTrade SSE stream...');
      this.eventSource.close();
      this.eventSource = null;
      this.isConnected = false;
      this.emit('connected', false);
    }

    // Clean up HTTP polling fallback if it exists
    if ((this as any).pollingInterval) {
      console.log('🔌 Cleaning up HTTP polling fallback...');
      clearInterval((this as any).pollingInterval);
      (this as any).pollingInterval = null;
    }
  }

  // Check connection status
  getConnectionStatus(): boolean {
    const status = this.isConnected && this.eventSource?.readyState === EventSource.OPEN;
    console.log('🔍 Connection status check:', {
      isConnected: this.isConnected,
      readyState: this.eventSource?.readyState,
      readyStateString: this.getReadyStateString(),
      finalStatus: status
    });
    return status;
  }

  // Helper to get readable EventSource ready state
  private getReadyStateString(): string {
    if (!this.eventSource) return 'No EventSource';
    switch (this.eventSource.readyState) {
      case EventSource.CONNECTING: return 'CONNECTING';
      case EventSource.OPEN: return 'OPEN';
      case EventSource.CLOSED: return 'CLOSED';
      default: return 'UNKNOWN';
    }
  }

  // Manual test method for debugging
  async testSSEConnection(): Promise<void> {
    const token = getAuthToken();
    console.log('🧪 Testing SSE connection manually...');
    console.log('🧪 Token available:', !!token);
    console.log('🧪 API Base:', FREQTRADE_API_BASE);
    console.log('🧪 Current connection state:', this.getConnectionStatus());

    if (!token) {
      console.error('🧪 No token available for testing');
      return;
    }

    // Test health first
    try {
      const health = await this.checkHealth();
      console.log('🧪 Health check passed:', health);
    } catch (error) {
      console.error('🧪 Health check failed:', error);
    }

    // Test if we can make a regular API call with the token
    try {
      console.log('🧪 Testing API call with Bearer token...');
      const response = await fetch(`${FREQTRADE_API_BASE}/api/bots`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });
      console.log('🧪 API call response status:', response.status);
      console.log('🧪 API call response headers:', Object.fromEntries(response.headers.entries()));
    } catch (error) {
      console.error('🧪 API call failed:', error);
    }

    // Force disconnect and reconnect
    console.log('🧪 Forcing reconnection...');
    this.disconnect();
    await new Promise(resolve => setTimeout(resolve, 1000));
    await this.connect();
  }

  // Fetch chart data for specific interval
  async fetchChartData(interval: '1h' | '24h' | '7d' | '30d'): Promise<ChartResponse> {
    const token = getAuthToken();
    if (!token) {
      throw new Error('No authentication token available');
    }

    try {
      console.log(`📈 Fetching chart data for interval: ${interval}`);
      const response = await fetch(
        `${FREQTRADE_API_BASE}/api/charts/portfolio/${interval}`,
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        }
      );

      if (!response.ok) {
        throw new Error(`Chart data request failed: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      console.log(`📈 Chart data received for ${interval}:`, data);
      console.log(`📈 Chart data structure for ${interval}:`, Object.keys(data));
      return data;
    } catch (error) {
      console.error(`❌ Failed to fetch chart data for ${interval}:`, error);
      throw error;
    }
  }  // Fetch all chart data intervals
  async fetchAllChartData(): Promise<{ [key: string]: ChartResponse }> {
    const token = getAuthToken();
    if (!token) {
      throw new Error('No authentication token available');
    }

    try {
      console.log('📈 Fetching all chart data intervals...');
      const response = await fetch(
        `${FREQTRADE_API_BASE}/api/charts/portfolio`,
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        }
      );

      if (!response.ok) {
        throw new Error(`All chart data request failed: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      console.log('📈 All chart data received:', data);
      console.log('📈 Chart data intervals:', data.intervals);
      console.log('📈 Chart data structure:', Object.keys(data));
      return data.intervals || {};
    } catch (error) {
      console.error('❌ Failed to fetch all chart data:', error);
      throw error;
    }
  }

  // Fetch raw portfolio history
  async fetchPortfolioHistory(): Promise<any[]> {
    const token = getAuthToken();
    if (!token) {
      throw new Error('No authentication token available');
    }

    try {
      console.log('📈 Fetching raw portfolio history...');
      const response = await fetch(
        `${FREQTRADE_API_BASE}/api/portfolio/history`,
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        }
      );

      if (!response.ok) {
        throw new Error(`Portfolio history request failed: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      console.log('📈 Raw portfolio history received:', data);
      return data;
    } catch (error) {
      console.error('❌ Failed to fetch portfolio history:', error);
      throw error;
    }
  }  // Fetch bot list
  async fetchBots(): Promise<any[]> {
    const token = getAuthToken();
    if (!token) {
      throw new Error('No authentication token available');
    }

    try {
      console.log('🤖 Fetching bot list...');
      const response = await fetch(
        `${FREQTRADE_API_BASE}/api/bots`,
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        }
      );

      if (!response.ok) {
        throw new Error(`Bot list request failed: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      console.log('🤖 Bot list received:', data);
      return data;
    } catch (error) {
      console.error('❌ Failed to fetch bot list:', error);
      throw error;
    }
  }  // Fetch specific bot status
  async fetchBotStatus(instanceId: string): Promise<any> {
    const token = getAuthToken();
    if (!token) {
      throw new Error('No authentication token available');
    }

    try {
      console.log(`🤖 Fetching status for bot: ${instanceId}`);
      const response = await fetch(
        `${FREQTRADE_API_BASE}/api/bots/${instanceId}/status`,
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        }
      );

      if (!response.ok) {
        throw new Error(`Bot status request failed: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      console.log(`🤖 Bot status received for ${instanceId}:`, data);
      return data;
    } catch (error) {
      console.error(`❌ Failed to fetch bot status for ${instanceId}:`, error);
      throw error;
    }
  }

  // Fetch bot balance
  async fetchBotBalance(instanceId: string): Promise<any> {
    const token = getAuthToken();
    if (!token) {
      throw new Error('No authentication token available');
    }

    try {
      console.log(`🤖 Fetching balance for bot: ${instanceId}`);
      const response = await fetch(
        `${FREQTRADE_API_BASE}/api/bots/${instanceId}/balance`,
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        }
      );

      if (!response.ok) {
        throw new Error(`Bot balance request failed: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      console.log(`🤖 Bot balance received for ${instanceId}:`, data);
      return data;
    } catch (error) {
      console.error(`❌ Failed to fetch bot balance for ${instanceId}:`, error);
      throw error;
    }
  }

  // Fetch bot profit
  async fetchBotProfit(instanceId: string): Promise<any> {
    const token = getAuthToken();
    if (!token) {
      throw new Error('No authentication token available');
    }

    try {
      console.log(`🤖 Fetching profit for bot: ${instanceId}`);
      const response = await fetch(
        `${FREQTRADE_API_BASE}/api/bots/${instanceId}/profit`,
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        }
      );

      if (!response.ok) {
        throw new Error(`Bot profit request failed: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      console.log(`🤖 Bot profit received for ${instanceId}:`, data);
      return data;
    } catch (error) {
      console.error(`❌ Failed to fetch bot profit for ${instanceId}:`, error);
      throw error;
    }
  }

  // Create new bot
  async createBot(botConfig: {
    instanceId: string;
    port: number;
    apiUsername: string;
    apiPassword: string;
  }): Promise<any> {
    const token = getAuthToken();
    if (!token) {
      throw new Error('No authentication token available');
    }

    try {
      console.log('🤖 Creating new bot:', botConfig.instanceId);
      const response = await fetch(`${FREQTRADE_API_BASE}/api/provision`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(botConfig),
      });

      if (!response.ok) {
        throw new Error(`Bot creation failed: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      console.log('🤖 Bot created successfully:', data);
      return data;
    } catch (error) {
      console.error('❌ Failed to create bot:', error);
      throw error;
    }
  }

  // Check API health
  async checkHealth(): Promise<HealthResponse> {
    try {
      console.log('🏥 Checking FreqTrade API health...');
      const response = await fetch(`${FREQTRADE_API_BASE}/api/health`);

      if (!response.ok) {
        throw new Error(`Health check failed: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      console.log('🏥 Health check result:', data);
      return data;
    } catch (error) {
      console.error('❌ Health check failed:', error);
      throw error;
    }
  }

  // Format currency values
  formatCurrency(value: number): string {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  }

  // Format percentage values
  formatPercentage(value: number): string {
    return new Intl.NumberFormat('en-US', {
      style: 'percent',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  }

  // Fetch recent trades
  async fetchTrades(): Promise<TradeData[]> {
    try {
      console.log('💼 Trade data is provided through portfolio SSE updates - returning empty array');
      // The /api/trades endpoint doesn't exist on the server (404 error)
      // Trade data is provided through portfolio.bots in SSE portfolio_update events
      return [];
    } catch (error) {
      console.error('❌ Failed to fetch trades:', error);
      return [];
    }
  }

  // Fetch live trading positions
  async fetchPositions(): Promise<any[]> {
    const token = getAuthToken();
    if (!token) {
      throw new Error('No authentication token available');
    }

    try {
      console.log('📈 Fetching live trading positions...');
      const response = await fetch(
        `${FREQTRADE_API_BASE}/api/positions`,
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        }
      );

      if (!response.ok) {
        throw new Error(`Positions request failed: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      console.log('📈 Positions data received:', data);
      return data.positions || [];
    } catch (error) {
      console.error('❌ Failed to fetch positions:', error);
      throw error;
    }
  }
}

// Create singleton instance
export const freqTradeSSEService = new FreqTradeSSEService();

// Make it available for debugging in browser console
if (typeof window !== 'undefined') {
  (window as any).freqTradeSSEService = freqTradeSSEService;
}

// Export default
export default freqTradeSSEService;
