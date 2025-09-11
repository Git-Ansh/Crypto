/**
 * FreqTrade SSE Integration Hook
 * Replaces WebSocket-based integration with Server-Sent Events
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { freqTradeSSEService, PortfolioData, BotData, ChartResponse, TradeData, ChartDataPoint } from '@/lib/freqtrade-sse-service';
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

  // Trade data
  trades: TradeData[];
  tradesLoading: boolean;
  tradesError: string | null;

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

  // Trade state
  const [trades, setTrades] = useState<TradeData[]>([]);
  const [tradesLoading, setTradesLoading] = useState(true);
  const [tradesError, setTradesError] = useState<string | null>(null);

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
      console.log('💰 Portfolio bots data:', data.bots?.length || 0, 'bots');

      setPortfolioData(data);
      setPortfolioLoading(false);
      setPortfolioError(null);
      setLastUpdate(new Date(data.timestamp));

      // Create chart data point for time bucketing
      const liveChartPoint = {
        timestamp: data.timestamp,
        portfolioValue: data.portfolioValue,
        totalPnL: data.totalPnL,
        activeBots: data.activeBots,
        botCount: data.botCount,
      };

      // Time-based aggregation with always-live latest point
      setChartData(prev => {
        const updated = { ...prev };
        const currentTime = new Date(data.timestamp);
        
        console.log('📊 [SSE] Processing portfolio update with live latest point');
        console.log('📊 [SSE] Current portfolio value:', data.portfolioValue);
        
        // Define aggregation intervals and time windows
        const intervals = {
          '1h': { bucketMinutes: 5, totalMinutes: 60, maxPoints: 11 },     // 11 historical + 1 live = 12 total
          '24h': { bucketMinutes: 30, totalMinutes: 1440, maxPoints: 47 }, // 47 historical + 1 live = 48 total  
          '7d': { bucketMinutes: 60, totalMinutes: 10080, maxPoints: 167 }, // 167 historical + 1 live = 168 total
          '30d': { bucketMinutes: 720, totalMinutes: 43200, maxPoints: 59 } // 59 historical + 1 live = 60 total
        };
        
        (['1h', '24h', '7d', '30d'] as const).forEach(interval => {
          const config = intervals[interval];
          const bucketMs = config.bucketMinutes * 60 * 1000;
          const totalMs = config.totalMinutes * 60 * 1000;
          
          // Create the live point (always at current timestamp, not bucketed)
          const livePoint = {
            ...liveChartPoint,
            timestamp: currentTime.toISOString(),
            isLive: true // Mark as live point for identification
          };
          
          // Initialize if no data exists
          if (!updated[interval] || !updated[interval].data) {
            console.log(`📊 [SSE] Initializing chart data for ${interval} with live point`);
            updated[interval] = {
              success: true,
              interval,
              data: [livePoint], // Start with just the live point
              metadata: {
                totalPoints: 1,
                timeRange: { start: currentTime.toISOString(), end: currentTime.toISOString() },
                aggregationWindow: `${config.bucketMinutes}m`
              }
            };
            return;
          }
          
          const existingData = [...updated[interval].data];
          
          // Remove any existing live points (there should only be one at the end)
          const historicalData = existingData.filter(point => (point as any).isLive !== true);
          
          // Check if we need to create a new historical bucket from the previous live point
          const lastBucketTime = Math.floor((currentTime.getTime() - config.bucketMinutes * 60 * 1000) / bucketMs) * bucketMs;
          const lastBucketTimeStr = new Date(lastBucketTime).toISOString();
          
          // If enough time has passed since the last bucket, create a historical point
          if (historicalData.length === 0 || 
              new Date(historicalData[historicalData.length - 1].timestamp).getTime() < lastBucketTime) {
            
            // Add the previous state as a historical bucket point
            const historicalPoint = {
              ...liveChartPoint,
              timestamp: lastBucketTimeStr,
              isLive: false
            };
            
            historicalData.push(historicalPoint);
            console.log(`📊 [SSE] Added historical bucket for ${interval} at ${lastBucketTimeStr}`);
          }
          
          // Sort historical data by timestamp
          historicalData.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
          
          // Remove historical data points older than the time window
          const cutoffTime = currentTime.getTime() - totalMs;
          const filteredHistoricalData = historicalData.filter(point => 
            new Date(point.timestamp).getTime() >= cutoffTime
          );
          
          // Limit historical points to prevent memory issues (save 1 spot for live point)
          while (filteredHistoricalData.length > config.maxPoints) {
            filteredHistoricalData.shift(); // Remove oldest historical point
          }
          
          // Combine historical data with the live point at the end
          const finalData = [...filteredHistoricalData, livePoint];
          
          updated[interval].data = finalData;
          console.log(`📊 [SSE] Updated ${interval}: ${filteredHistoricalData.length} historical + 1 live = ${finalData.length} total points`);
          
          // Update metadata
          const allTimes = finalData.map(p => new Date(p.timestamp).getTime());
          updated[interval].metadata = {
            totalPoints: finalData.length,
            timeRange: {
              start: new Date(Math.min(...allTimes)).toISOString(),
              end: new Date(Math.max(...allTimes)).toISOString()
            },
            aggregationWindow: `${config.bucketMinutes}m`
          };
        });        return updated;
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

      // Try to fetch recent trades if available
      try {
        const tradeList = await freqTradeSSEService.fetchTrades();
        if (Array.isArray(tradeList)) {
          console.log('💼 Initial trade list loaded:', tradeList.length, 'trades');
          setTrades(tradeList);
          setTradesLoading(false);
          setTradesError(null);
        }
      } catch (error) {
        console.warn('⚠️ Could not fetch initial trade list:', error);
        setTradesLoading(false);
        setTradesError(error instanceof Error ? error.message : 'Failed to load trades');
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

  // Helper function to bucket historical data into time intervals (excluding live point space)
  const bucketHistoricalData = useCallback((rawData: ChartDataPoint[], config: { bucketMinutes: number; totalMinutes: number; maxPoints: number }) => {
    if (!rawData || rawData.length === 0) return [];
    
    const bucketMs = config.bucketMinutes * 60 * 1000;
    const totalMs = config.totalMinutes * 60 * 1000;
    const now = Date.now();
    const cutoffTime = now - totalMs;
    
    // Group data by time buckets, but exclude the most recent bucket (reserved for live data)
    const buckets = new Map<string, ChartDataPoint>();
    const currentBucketTime = Math.floor(now / bucketMs) * bucketMs;
    
    rawData.forEach(point => {
      const pointTime = new Date(point.timestamp).getTime();
      
      // Skip points outside the time window
      if (pointTime < cutoffTime) return;
      
      // Round down to bucket boundary
      const bucketTime = Math.floor(pointTime / bucketMs) * bucketMs;
      
      // Skip the current bucket time - this is reserved for live data
      if (bucketTime >= currentBucketTime) return;
      
      const bucketKey = new Date(bucketTime).toISOString();
      
      // Use the latest data point in each bucket
      if (!buckets.has(bucketKey) || pointTime > new Date(buckets.get(bucketKey)!.timestamp).getTime()) {
        buckets.set(bucketKey, {
          ...point,
          timestamp: bucketKey,
          isLive: false // Mark as historical
        });
      }
    });
    
    // Convert to array and sort by time
    const bucketedData = Array.from(buckets.values()).sort((a, b) => 
      new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );
    
    // Limit to max points (save 1 space for live point)
    while (bucketedData.length > config.maxPoints) {
      bucketedData.shift();
    }
    
    console.log(`🪣 Bucketed ${rawData.length} raw points into ${bucketedData.length} historical ${config.bucketMinutes}min buckets (live point space reserved)`);
    return bucketedData;
  }, []);  // Fetch all chart data intervals
  const fetchAllChartData = useCallback(async () => {
    try {
      setChartLoading(true);
      setChartError(null);

      console.log('📈 [HOOK] Fetching all chart data intervals with time-based aggregation...');

      // Define the same intervals as in live updates for consistency
      const intervalConfigs = {
        '1h': { bucketMinutes: 5, totalMinutes: 60, maxPoints: 12 },
        '24h': { bucketMinutes: 30, totalMinutes: 1440, maxPoints: 48 },
        '7d': { bucketMinutes: 60, totalMinutes: 10080, maxPoints: 168 },
        '30d': { bucketMinutes: 720, totalMinutes: 43200, maxPoints: 60 }
      };

      // Fetch all data from server
      const serverData = await freqTradeSSEService.fetchAllChartData();
      console.log('📈 [HOOK] Server data received:', serverData);

      // Process server data through our time bucketing system
      const processedData: { [key: string]: ChartResponse } = {};

      for (const [interval, config] of Object.entries(intervalConfigs)) {
        const serverInterval = serverData[interval];

        if (serverInterval && serverInterval.data && serverInterval.data.length > 0) {
          console.log(`📈 [HOOK] Processing ${serverInterval.data.length} points for ${interval}`);

          // Apply time bucketing to historical data
          const bucketedData = bucketHistoricalData(serverInterval.data, config);

          processedData[interval] = {
            success: true,
            interval,
            data: bucketedData,
            metadata: {
              totalPoints: bucketedData.length,
              timeRange: bucketedData.length > 0 ? {
                start: bucketedData[0].timestamp,
                end: bucketedData[bucketedData.length - 1].timestamp
              } : { start: '', end: '' },
              aggregationWindow: `${config.bucketMinutes}m`
            }
          };

          console.log(`📈 [HOOK] Processed ${interval}: ${bucketedData.length} buckets`);
        } else {
          console.log(`📈 [HOOK] No data available for ${interval}, creating empty response`);
          processedData[interval] = {
            success: true,
            interval,
            data: [],
            metadata: {
              totalPoints: 0,
              timeRange: { start: '', end: '' },
              aggregationWindow: `${config.bucketMinutes}m`
            }
          };
        }
      }

      setChartData(processedData);
      setChartError(null);
      console.log('📈 [HOOK] All chart data processed and stored');
    } catch (error) {
      console.error('❌ [HOOK] Failed to fetch all chart data:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to load chart data';
      setChartError(errorMessage);
    } finally {
      setChartLoading(false);
    }
  }, [bucketHistoricalData]);

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

    // Trade data
    trades,
    tradesLoading,
    tradesError,

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
