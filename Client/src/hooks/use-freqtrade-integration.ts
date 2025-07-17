import { useState, useEffect, useCallback } from 'react';
import { freqTradeService, BotData, PortfolioData, TradeAlert } from '@/lib/freqtrade-service';
import { useAuth } from '@/contexts/AuthContext';

export const useFreqTradeIntegration = () => {
  // Connection state
  const [isConnected, setIsConnected] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  // Portfolio state
  const [portfolioData, setPortfolioData] = useState<PortfolioData | null>(null);
  const [portfolioLoading, setPortfolioLoading] = useState(true);
  const [portfolioError, setPortfolioError] = useState<string | null>(null);

  // Bot state
  const [bots, setBots] = useState<BotData[]>([]);
  const [botsLoading, setBotsLoading] = useState(true);
  const [botsError, setBotsError] = useState<string | null>(null);

  // Trades state
  const [recentTrades, setRecentTrades] = useState<TradeAlert[]>([]);
  const [tradesLoading, setTradesLoading] = useState(true);

  // Chart data state
  const [chartData, setChartData] = useState<any[]>([]);
  const [portfolioHistory, setPortfolioHistory] = useState<any[]>([]);

  const { user } = useAuth();

  // Initialize connection when user is available
  useEffect(() => {
    if (user) {
      initializeConnection();
    }

    return () => {
      freqTradeService.disconnect();
    };
  }, [user]);

  // Setup WebSocket event listeners
  useEffect(() => {
    const unsubscribeConnected = freqTradeService.on('connected', (connected: boolean) => {
      setIsConnected(connected);
      setConnectionError(connected ? null : 'WebSocket disconnected');
      
      if (connected) {
        // Request initial data when connected
        loadInitialData();
      }
    });

    const unsubscribePortfolio = freqTradeService.on('portfolio_update', (data: PortfolioData) => {
      console.log('📊 Portfolio Update received:', data);
      console.log('📊 Full portfolio data structure:', JSON.stringify(data, null, 2));
      setPortfolioData(data);
      setPortfolioLoading(false);
      setPortfolioError(null);
      setLastUpdate(new Date());
    });

    const unsubscribeBots = freqTradeService.on('bot_metrics', (data: any) => {
      console.log('🤖 Bot Metrics Update received:', data);
      console.log('🤖 Full bot data structure:', JSON.stringify(data, null, 2));
      if (data.bots) {
        setBots(data.bots);
        setBotsLoading(false);
        setBotsError(null);
      }
    });

    const unsubscribeTrades = freqTradeService.on('trade_alert', (trade: TradeAlert) => {
      console.log('💰 Trade Alert received:', trade);
      setRecentTrades(prev => [trade, ...prev.slice(0, 9)]); // Keep last 10 trades
      setTradesLoading(false);
    });

    const unsubscribeTimeSeries = freqTradeService.on('timeseries_update', (data: any) => {
      console.log('📈 TimeSeries Update received (IGNORING to prevent race condition):', data);
      // DISABLED: This was causing race conditions by overriding timeframe-specific data
      // The dashboard now manages its own isolated timeframe data
      // if (data.newDataPoint) {
      //   setChartData(prev => [...prev, data.newDataPoint]);
      // }
    });

    const unsubscribePortfolioHistory = freqTradeService.on('portfolio_history', (message: any) => {
      console.log('📈 Portfolio History received - checking timeframe relevance:', message);
      
      // CRITICAL: Only process this data if it's requested for a specific timeframe
      // Extract timeframe from request params or data
      const requestedTimeframe = message.requestParams?.timeframe || message.data?.timeframe || message.timeframe;
      console.log(`📈 Portfolio History timeframe: ${requestedTimeframe || 'UNKNOWN'}`);
      
      // Get the actual data from the message
      const data = message.data || message;
      
      // If no timeframe is specified, we'll be conservative and only update chart data
      // but not portfolio history to avoid overriding timeframe-specific data
      if (!requestedTimeframe) {
        console.log('📈 ⚠️ No timeframe specified in portfolio history - using for chart data only');
        // Handle for chart data updates but don't set portfolio history
        let historyData = [];
        if (data && typeof data === 'object') {
          if (data.history && Array.isArray(data.history.snapshots)) {
            historyData = data.history.snapshots;
          } else if (Array.isArray(data.history)) {
            historyData = data.history;
          } else if (Array.isArray(data)) {
            historyData = data;
          }
        }
        
        if (historyData.length > 0) {
          setChartData(historyData);
        }
        return;
      }
      
      // Handle the nested structure: data.history.snapshots or data directly if it's an array
      let historyData = [];
      if (data && typeof data === 'object') {
        if (data.history && Array.isArray(data.history.snapshots)) {
          // New format: {history: {snapshots: [...], metadata: {...}}, requestParams: {...}}
          historyData = data.history.snapshots;
          console.log('📈 Using nested snapshots format:', historyData.length, 'points');
        } else if (Array.isArray(data.history)) {
          // Alternative format: {history: [...]}
          historyData = data.history;
          console.log('📈 Using direct history array format:', historyData.length, 'points');
        } else if (Array.isArray(data)) {
          // Direct array format: [...]
          historyData = data;
          console.log('📈 Using direct array format:', historyData.length, 'points');
        }
      }

      if (historyData.length > 0) {
        // Add timeframe tracking and timestamp to force React to recognize this as new data
        const dataWithTimestamp = historyData.map((point: any) => ({
          ...point,
          _receivedAt: new Date().toISOString(),
          _requestedTimeframe: requestedTimeframe // Track which timeframe this data is for
        }));
        setPortfolioHistory(dataWithTimestamp);
        console.log(`📈 Portfolio History updated for timeframe: ${requestedTimeframe}, ${dataWithTimestamp.length} points`);
      }
    });

    const unsubscribeTimeseriesData = freqTradeService.on('timeseries_data', (data: any) => {
      console.log('📊 Timeseries Data received:', data);
      if (Array.isArray(data)) {
        setChartData(data);
      }
    });

    const unsubscribeChartData = freqTradeService.on('chart_data', (message: any) => {
      console.log('📈 Chart Data received - checking timeframe relevance:', message);
      
      // CRITICAL: Only process this data if it's for a specific timeframe
      const requestedTimeframe = message.requestParams?.timeframe || message.data?.timeframe || message.timeframe;
      console.log(`📈 Chart Data timeframe: ${requestedTimeframe || 'UNKNOWN'}`);
      
      // Get the actual data from the message
      const data = message.data || message;
      
      if (data?.data && Array.isArray(data.data)) {
        // Add timeframe tracking and timestamp to force React to recognize this as new data
        const dataWithTimestamp = data.data.map((point: any) => ({
          ...point,
          _receivedAt: new Date().toISOString(),
          _requestedTimeframe: requestedTimeframe // Track which timeframe this data is for
        }));
        
        if (requestedTimeframe) {
          setPortfolioHistory(dataWithTimestamp);
          console.log(`📈 Chart Data updated for timeframe: ${requestedTimeframe}, ${dataWithTimestamp.length} points`);
        } else {
          console.log('📈 ⚠️ No timeframe specified in chart data - updating generic chart data only');
          setChartData(dataWithTimestamp);
        }
      }
    });

    const unsubscribeBotStatus = freqTradeService.on('bot_status', (data: any) => {
      console.log('🔄 Bot Status Update received:', data);
      setBots(prev => prev.map(bot => 
        bot.instanceId === data.botId 
          ? { ...bot, status: data.status, lastUpdate: Date.now() }
          : bot
      ));
    });

    const unsubscribeError = freqTradeService.on('api_error', (error: any) => {
      console.error('❌ FreqTrade API Error:', error);
      const errorMessage = error?.message || error?.code || 'API error occurred';
      setConnectionError(errorMessage);
    });

    const unsubscribeSystemError = freqTradeService.on('error', (error: any) => {
      console.error('❌ FreqTrade System Error:', error);
      setConnectionError('Connection error occurred');
    });

    const unsubscribeFallback = freqTradeService.on('fallback_mode', (enabled: boolean) => {
      if (enabled) {
        console.log('🔄 FreqTrade fallback mode activated - using mock data');
        setConnectionError('FreqTrade server unavailable - using demo data (refresh to retry)');
        // Load mock data immediately
        loadMockData();
      }
    });

    return () => {
      unsubscribeConnected();
      unsubscribePortfolio();
      unsubscribeBots();
      unsubscribeTrades();
      unsubscribeTimeSeries();
      unsubscribePortfolioHistory();
      unsubscribeTimeseriesData();
      unsubscribeChartData();
      unsubscribeBotStatus();
      unsubscribeError();
      unsubscribeSystemError();
      unsubscribeFallback();
    };
  }, []);

  const initializeConnection = async () => {
    try {
      setConnectionError(null);
      console.log('🔄 Initializing FreqTrade connection...');
      
      // Connect WebSocket for real-time data
      await freqTradeService.connectWebSocket();
      
    } catch (error) {
      console.error('Failed to initialize FreqTrade connection:', error);
      setConnectionError('Failed to connect to FreqTrade service');
      setPortfolioLoading(false);
      setBotsLoading(false);
      setTradesLoading(false);
    }
  };

  const loadInitialData = async () => {
    try {
      console.log('📥 Loading initial FreqTrade data...');
      
      // Request real-time data via WebSocket ONLY
      // The FreqTrade API is WebSocket-first and HTTP endpoints return 500 errors
      freqTradeService.requestPortfolioSummary();
      freqTradeService.requestChartData();
      freqTradeService.requestBotData();
      
      // Subscribe to portfolio updates for live streaming
      const channels = ['portfolio', 'bot_metrics', 'timeseries', 'trade_alerts', 'bot_status'];
      console.log('📡 Subscribing to channels:', channels);

      // All data will come through WebSocket subscriptions
      console.log('🔄 Waiting for WebSocket data for portfolio, charts, and bots...');

    } catch (error) {
      console.error('Failed to request initial data:', error);
      setBotsError('Failed to request FreqTrade data');
      setBotsLoading(false);
    }
  };

  // New method to request portfolio history for specific timeframes
  const requestPortfolioHistory = useCallback((timeframe: '1H' | '24H' | '7D' | '30D') => {
    console.log(`📊 Requesting portfolio history for ${timeframe}...`);
    
    // Clear existing portfolio history to ensure fresh data for the new timeframe
    setPortfolioHistory([]);
    
    if (freqTradeService.requestPortfolioHistory) {
      freqTradeService.requestPortfolioHistory(timeframe);
    } else {
      // Fallback to general chart data request
      freqTradeService.requestChartData(timeframe);
    }
  }, []);

  // Load mock data when server is unavailable
  const loadMockData = () => {
    console.log('📝 Loading mock FreqTrade data...');
    
    // Mock portfolio data
    setPortfolioData({
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
    });
    setPortfolioLoading(false);
    setPortfolioError(null);

    // Mock bots data
    setBots([
      {
        instanceId: 'demo-bot-1',
        status: 'stopped',
        config: { strategy: 'DemoStrategy' },
        balance: 1000,
        totalPnL: 50.25,
        openTrades: 0,
        closedTrades: 25,
        performance: { winRate: 0.65 },
        lastUpdate: Date.now()
      },
      {
        instanceId: 'demo-bot-2',
        status: 'stopped',
        config: { strategy: 'DemoStrategy2' },
        balance: 1500,
        totalPnL: -25.50,
        openTrades: 0,
        closedTrades: 15,
        performance: { winRate: 0.45 },
        lastUpdate: Date.now()
      }
    ]);
    setBotsLoading(false);
    setBotsError(null);

    // Mock trades data
    setRecentTrades([
      {
        tradeId: 999,
        pair: 'BTC/USDT',
        side: 'buy',
        amount: 0.001,
        price: 45000,
        fee: 1.25,
        profit: 12.50,
        isOpen: false,
        openDate: Date.now() - 3600000, // 1 hour ago
        closeDate: Date.now(),
        strategy: 'DemoStrategy',
        botId: 'demo-bot-1',
        timestamp: new Date().toISOString()
      }
    ]);
    setTradesLoading(false);

    setLastUpdate(new Date());
  };

  // Manual refresh function
  const refreshData = useCallback(async () => {
    if (!isConnected && !freqTradeService.isConnected()) {
      console.log('🔄 Reconnecting to FreqTrade...');
      await initializeConnection();
      return;
    }

    console.log('🔄 Refreshing FreqTrade data...');
    await loadInitialData();
  }, [isConnected]);

  // Bot control functions
  const startBot = useCallback(async (botId: string) => {
    try {
      console.log('▶️ Starting bot:', botId);
      await freqTradeService.startBot(botId);
      // Also send via WebSocket for real-time update
      freqTradeService.sendBotAction('start', botId);
    } catch (error) {
      console.error('Failed to start bot:', error);
      throw error;
    }
  }, []);

  const stopBot = useCallback(async (botId: string) => {
    try {
      console.log('⏹️ Stopping bot:', botId);
      await freqTradeService.stopBot(botId);
      // Also send via WebSocket for real-time update
      freqTradeService.sendBotAction('stop', botId);
    } catch (error) {
      console.error('Failed to stop bot:', error);
      throw error;
    }
  }, []);

  const updateBotConfig = useCallback(async (botId: string, config: any) => {
    try {
      console.log('⚙️ Updating bot config:', botId);
      await freqTradeService.updateBotConfig(botId, config);
    } catch (error) {
      console.error('Failed to update bot config:', error);
      throw error;
    }
  }, []);

  // Helper functions to check if FreqTrade data is available
  const hasPortfolioData = portfolioData !== null;
  const hasBotsData = bots.length > 0;
  const isFreqTradeAvailable = isConnected || hasPortfolioData || hasBotsData;

  return {
    // Connection state
    isConnected,
    connectionError,
    lastUpdate,
    isFreqTradeAvailable,

    // Portfolio data
    portfolioData,
    portfolioLoading,
    portfolioError,

    // Bot data
    bots,
    botsLoading,
    botsError,

    // Trades data
    recentTrades,
    tradesLoading,

    // Chart data
    chartData,
    portfolioHistory,

    // Actions
    refreshData,
    requestPortfolioHistory,
    startBot,
    stopBot,
    updateBotConfig,

    // Helper functions
    hasPortfolioData,
    hasBotsData,
  };
};
