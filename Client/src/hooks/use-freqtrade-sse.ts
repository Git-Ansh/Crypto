/**
 * FreqTrade SSE Integration Hook
 * Replaces WebSocket-based integration with Server-Sent Events
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { freqTradeSSEService, PortfolioData, BotData, ChartResponse } from '@/lib/freqtrade-sse-service';
import { useAuth } from '@/contexts/AuthContext';

interface FreqTradeSSEState {
  // Connection state
  isConnected: boolean;
  connectionError: string | null;
  lastUpdate: Date | null;

  // Portfolio data
  portfolioData: PortfolioData | null;
  portfolioLoading: boolean;
  portfolioError: string | null;

  // Bot data
  bots: BotData[];
  botsLoading: boolean;
  botsError: string | null;

  // Chart data by interval
  chartData: { [interval: string]: ChartResponse };
  chartLoading: boolean;
  chartError: string | null;

  // Actions
  refreshData: () => Promise<void>;
  fetchChartData: (interval: '1h' | '24h' | '7d' | '30d') => Promise<void>;
  fetchAllChartData: () => Promise<void>;
}

export const useFreqTradeSSE = (): FreqTradeSSEState => {
  // Connection state
  const [isConnected, setIsConnected] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  
  // React Strict Mode guard to prevent double initialization
  const initializedRef = useRef(false);

  // Portfolio state
  const [portfolioData, setPortfolioData] = useState<PortfolioData | null>(null);
  const [portfolioLoading, setPortfolioLoading] = useState(true);
  const [portfolioError, setPortfolioError] = useState<string | null>(null);

  // Bot state
  const [bots, setBots] = useState<BotData[]>([]);
  const [botsLoading, setBotsLoading] = useState(true);
  const [botsError, setBotsError] = useState<string | null>(null);

  // Chart data state
  const [chartData, setChartData] = useState<{ [interval: string]: ChartResponse }>({});
  const [chartLoading, setChartLoading] = useState(false);
  const [chartError, setChartError] = useState<string | null>(null);

  const { user } = useAuth();
  const unsubscribersRef = useRef<Array<() => void>>([]);

  // Initialize SSE connection when user is authenticated
  useEffect(() => {
    if (!user) return;
    
    // Prevent double initialization in React Strict Mode (development)
    if (initializedRef.current) {
      console.log('🔄 SSE already initialized, skipping (React Strict Mode)');
      return;
    }
    initializedRef.current = true;

    console.log('🚀 Initializing FreqTrade SSE connection for', user?.email);
    
    const initializeSSE = async () => {
      try {
        console.log('🚀 [HOOK] Starting SSE connection...');
        setConnectionError(null);
        
        await freqTradeSSEService.connect();
        console.log('🚀 [HOOK] SSE connection attempt completed');
      } catch (error) {
        console.error('❌ [HOOK] Failed to initialize SSE connection:', error);
        setConnectionError(error instanceof Error ? error.message : 'Connection failed');
        setPortfolioLoading(false);
        setBotsLoading(false);
      }
    };

    initializeSSE();
    
    // Add a timeout to check connection status (but don't force reconnect to avoid rate limits)
    setTimeout(() => {
      console.log('🔍 [HOOK] Checking SSE connection after 5 seconds...');
      console.log('🔍 [HOOK] Service connection status:', freqTradeSSEService.getConnectionStatus());
      console.log('🔍 [HOOK] Hook isConnected state:', isConnected);
      
      // Check if service is connected but hook state is not synced
      if (freqTradeSSEService.getConnectionStatus() && !isConnected) {
        console.log('🔄 [HOOK] Service connected but hook state not synced, fixing...');
        setIsConnected(true);
        setConnectionError(null);
      }
      
      // Only log status, don't force reconnect to avoid rate limits
      if (!freqTradeSSEService.getConnectionStatus() && !isConnected) {
        console.log('⚠️ [HOOK] SSE not connected - will retry automatically with backoff');
      }
    }, 5000);

    // Setup event listeners
    const unsubscribeConnected = freqTradeSSEService.on('connected', (connected: boolean) => {
      console.log('🔌 FreqTrade SSE connection:', connected ? 'Connected' : 'Disconnected');
      setIsConnected(connected);
      
      if (connected) {
        setConnectionError(null);
        loadInitialData();
      } else {
        setConnectionError('Disconnected from FreqTrade service');
      }
    });

    const unsubscribePortfolio = freqTradeSSEService.on('portfolio_update', (data: PortfolioData) => {
      console.log('💰 Portfolio Update:', data.portfolioValue.toFixed(2), '| P&L:', data.totalPnL.toFixed(2), '| Bots:', data.activeBots);
      
      setPortfolioData(data);
      setPortfolioLoading(false);
      setPortfolioError(null);
      setLastUpdate(new Date(data.timestamp));

      // Create chart data point in the format expected by PortfolioChart component
      const liveChartPoint = {
        timestamp: data.timestamp,
        date: data.timestamp, // Chart expects 'date' field
        portfolioValue: data.portfolioValue,
        totalPnL: data.totalPnL,
        activeBots: data.activeBots,
        botCount: data.botCount,
        // Chart component expects these specific fields:
        totalValue: data.portfolioValue || 0, // Chart looks for 'totalValue' or 'value'
        value: data.portfolioValue || 0, // Fallback field
        paperBalance: 0, // Not used in FreqTrade but expected by chart
        total: data.portfolioValue || 0, // This is what actually gets displayed in the chart
      };
      
      // Chart data point created with proper values
      
      // Add this live data point to all timeframes for immediate display
      const liveChartData = {
        '1h': { success: true, interval: '1h', data: [liveChartPoint], metadata: { totalPoints: 1, timeRange: { start: data.timestamp, end: data.timestamp }, aggregationWindow: '1h' } },
        '24h': { success: true, interval: '24h', data: [liveChartPoint], metadata: { totalPoints: 1, timeRange: { start: data.timestamp, end: data.timestamp }, aggregationWindow: '24h' } },
        '7d': { success: true, interval: '7d', data: [liveChartPoint], metadata: { totalPoints: 1, timeRange: { start: data.timestamp, end: data.timestamp }, aggregationWindow: '7d' } },
        '30d': { success: true, interval: '30d', data: [liveChartPoint], metadata: { totalPoints: 1, timeRange: { start: data.timestamp, end: data.timestamp }, aggregationWindow: '30d' } },
      };
      
      // Update chart data with live data
      setChartData(prev => {
        const updated = { ...prev };
        (['1h', '24h', '7d', '30d'] as const).forEach(interval => {
          // If we don't have historical data for this interval, use the live data
          if (!updated[interval] || !updated[interval].data || updated[interval].data.length === 0) {
            updated[interval] = liveChartData[interval];
          } else {
            // If we have historical data, append the live data point
            const existingData = [...updated[interval].data];
            // Replace or add the latest data point
            const existingIndex = existingData.findIndex((point: any) => point.timestamp === data.timestamp);
            if (existingIndex >= 0) {
              existingData[existingIndex] = liveChartPoint;
            } else {
              existingData.push(liveChartPoint);
            }
            updated[interval] = {
              ...updated[interval],
              data: existingData
            };
          }
        });
        return updated;
      });
    });

    const unsubscribeBots = freqTradeSSEService.on('bot_update', (botData: BotData[]) => {
      console.log('🎯 [HOOK] Bot update received via SSE:', botData);
      console.log('🎯 [HOOK] Setting bot data and loading to false');
      setBots(botData);
      setBotsLoading(false);
      setBotsError(null);
      console.log('🎯 [HOOK] Bot state updated successfully');
    });

    const unsubscribeLastUpdate = freqTradeSSEService.on('last_update', (date: Date) => {
      setLastUpdate(date);
    });

    const unsubscribeError = freqTradeSSEService.on('error', (error: any) => {
      console.error('❌ FreqTrade SSE error:', error);
      const errorMessage = error?.message || 'SSE connection error';
      setConnectionError(errorMessage);
    });

    const unsubscribeConnectionFailed = freqTradeSSEService.on('connection_failed', (message: string) => {
      console.error('❌ FreqTrade SSE connection failed:', message);
      setConnectionError(message);
      setPortfolioLoading(false);
      setBotsLoading(false);
    });

    // Store unsubscribers
    unsubscribersRef.current = [
      unsubscribeConnected,
      unsubscribePortfolio,
      unsubscribeBots,
      unsubscribeLastUpdate,
      unsubscribeError,
      unsubscribeConnectionFailed,
    ];

    // Cleanup on unmount
    return () => {
      console.log('🧹 Cleaning up FreqTrade SSE connection...');
      unsubscribersRef.current.forEach(unsubscribe => unsubscribe());
      unsubscribersRef.current = [];
      initializedRef.current = false; // Reset guard for potential remount
      // Add a small delay before disconnecting to avoid rapid reconnections
      setTimeout(() => {
        freqTradeSSEService.disconnect();
      }, 100);
    };
  }, [user]);

  // Load initial data (chart data since portfolio comes via SSE)
  const loadInitialData = async () => {
    try {
      console.log('📥 Loading initial FreqTrade data...');
      
      // Fetch initial chart data for all intervals
      await fetchAllChartData();
      
      // Set initial portfolio loading to false since we have chart data
      // Portfolio data will come via SSE if available
      setPortfolioLoading(false);
      
      // Don't set default portfolio data here - let it remain null until real SSE data arrives
      // This prevents overriding actual SSE data with zeros
      
      // Try to fetch bot list if available
      try {
        const botList = await freqTradeSSEService.fetchBots();
        if (Array.isArray(botList) && botList.length > 0) {
          console.log('🤖 Initial bot list loaded:', botList);
          // Bot data will be updated via SSE, but we can set initial state
          setBotsLoading(false);
        }
      } catch (error) {
        console.warn('⚠️ Could not fetch initial bot list:', error);
        setBotsLoading(false);
      }
      
    } catch (error) {
      console.error('❌ Failed to load initial data:', error);
    }
  };

  // Fetch chart data for specific interval
  const fetchChartData = useCallback(async (interval: '1h' | '24h' | '7d' | '30d') => {
    try {
      setChartLoading(true);
      setChartError(null);
      
      console.log(`📈 Fetching chart data for ${interval}...`);
      const data = await freqTradeSSEService.fetchChartData(interval);
      
      setChartData(prev => ({
        ...prev,
        [interval]: data
      }));
      
      console.log(`📈 Chart data for ${interval} loaded successfully`);
    } catch (error) {
      console.error(`❌ Failed to fetch chart data for ${interval}:`, error);
      const errorMessage = error instanceof Error ? error.message : `Failed to load ${interval} data`;
      setChartError(errorMessage);
    } finally {
      setChartLoading(false);
    }
  }, []);

  // Fetch all chart data intervals
  const fetchAllChartData = useCallback(async () => {
    try {
      setChartLoading(true);
      setChartError(null);
      
      console.log('📈 Fetching all chart data intervals...');
      const allData = await freqTradeSSEService.fetchAllChartData();
      
      setChartData(allData || {});
      console.log('📈 All chart data loaded successfully:', Object.keys(allData || {}));
    } catch (error) {
      console.error('❌ Failed to fetch all chart data:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to load chart data';
      setChartError(errorMessage);
    } finally {
      setChartLoading(false);
    }
  }, []);

  // Manual refresh function
  const refreshData = useCallback(async () => {
    console.log('🔄 Refreshing FreqTrade data...');
    
    try {
      // Reconnect if disconnected
      if (!isConnected) {
        console.log('🔄 Reconnecting to FreqTrade SSE...');
        await freqTradeSSEService.connect();
      }
      
      // Refresh chart data
      await fetchAllChartData();
      
      // Skip health check to avoid rate limiting
      console.log('🔄 FreqTrade data refreshed (health check skipped to avoid rate limits)');
      
    } catch (error) {
      console.error('❌ Failed to refresh data:', error);
      setConnectionError(error instanceof Error ? error.message : 'Refresh failed');
    }
  }, [isConnected, fetchAllChartData]);

  return {
    // Connection state
    isConnected,
    connectionError,
    lastUpdate,

    // Portfolio data
    portfolioData,
    portfolioLoading,
    portfolioError,

    // Bot data
    bots,
    botsLoading,
    botsError,

    // Chart data
    chartData,
    chartLoading,
    chartError,

    // Actions
    refreshData,
    fetchChartData,
    fetchAllChartData,
  };
};

export default useFreqTradeSSE;
