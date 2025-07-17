// Custom hook for dashboard FreqTrade integration
import { useState, useEffect, useRef } from 'react';
import { useFreqTrade, BotData, PortfolioData, TradeAlert } from '@/lib/freqtrade-api';

export const useDashboardFreqTrade = () => {
  // Portfolio state
  const [portfolioData, setPortfolioData] = useState<PortfolioData | null>(null);
  const [portfolioLoading, setPortfolioLoading] = useState(true);
  const [portfolioError, setPortfolioError] = useState<string | null>(null);

  // Bot state
  const [bots, setBots] = useState<BotData[]>([]);
  const [botsLoading, setBotsLoading] = useState(true);
  const [selectedBot, setSelectedBot] = useState<BotData | null>(null);

  // Trades state
  const [recentTrades, setRecentTrades] = useState<TradeAlert[]>([]);
  const [tradesLoading, setTradesLoading] = useState(true);

  // Connection state
  const [isConnected, setIsConnected] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  // Chart data for portfolio
  const [chartData, setChartData] = useState<any[]>([]);

  const freqTradeAPI = useFreqTrade();
  const isInitialized = useRef(false);

  // Subscribe to WebSocket events
  useEffect(() => {
    if (!freqTradeAPI) return;

    // Connection status
    const unsubscribeConnection = freqTradeAPI.subscribe('connected', (connected: boolean) => {
      setIsConnected(connected);
      if (connected && !isInitialized.current) {
        // Initial data fetch when connected
        loadInitialData();
        isInitialized.current = true;
      }
    });

    // Portfolio updates
    const unsubscribePortfolio = freqTradeAPI.subscribe('portfolio_update', (data: PortfolioData) => {
      console.log('📊 Portfolio Update:', data);
      setPortfolioData(data);
      setPortfolioLoading(false);
      setLastUpdate(new Date());
    });

    // Bot metrics updates
    const unsubscribeBots = freqTradeAPI.subscribe('bot_metrics', (data: any) => {
      console.log('🤖 Bot Metrics Update:', data);
      if (data.bots) {
        setBots(data.bots);
        setBotsLoading(false);
        
        // Update selected bot if it exists in the new data
        if (selectedBot) {
          const updatedBot = data.bots.find((bot: BotData) => bot.instanceId === selectedBot.instanceId);
          if (updatedBot) {
            setSelectedBot(updatedBot);
          }
        } else if (data.bots.length > 0) {
          // Auto-select first bot if none selected
          setSelectedBot(data.bots[0]);
        }
      }
    });

    // Trade alerts
    const unsubscribeTrades = freqTradeAPI.subscribe('trade_alert', (trade: TradeAlert) => {
      console.log('💰 Trade Alert:', trade);
      setRecentTrades(prev => [trade, ...prev.slice(0, 9)]); // Keep last 10 trades
      setTradesLoading(false);
    });

    // Time-series data for charts
    const unsubscribeTimeSeries = freqTradeAPI.subscribe('timeseries_update', (data: any) => {
      console.log('📈 TimeSeries Update:', data);
      if (data.newDataPoint) {
        setChartData(prev => [...prev, data.newDataPoint]);
      }
    });

    // Bot status changes
    const unsubscribeBotStatus = freqTradeAPI.subscribe('bot_status', (data: any) => {
      console.log('🔄 Bot Status Update:', data);
      // Update specific bot status
      setBots(prev => prev.map(bot => 
        bot.instanceId === data.botId 
          ? { ...bot, status: data.status, lastUpdate: Date.now() }
          : bot
      ));
    });

    // Error handling
    const unsubscribeError = freqTradeAPI.subscribe('api_error', (error: any) => {
      console.error('❌ FreqTrade API Error:', error);
      const errorMessage = error?.message || (typeof error === 'string' ? error : 'FreqTrade API error occurred');
      setPortfolioError(errorMessage);
    });

    return () => {
      unsubscribeConnection();
      unsubscribePortfolio();
      unsubscribeBots();
      unsubscribeTrades();
      unsubscribeTimeSeries();
      unsubscribeBotStatus();
      unsubscribeError();
    };
  }, [freqTradeAPI, selectedBot]);

  // Load initial data
  const loadInitialData = async () => {
    try {
      setPortfolioLoading(true);
      setBotsLoading(true);
      setTradesLoading(true);

      // Request initial data via WebSocket only
      // The FreqTrade API only supports WebSocket communication
      freqTradeAPI.requestPortfolioSummary();
      freqTradeAPI.requestChartData();

      // No HTTP fallback - all data comes through WebSocket subscriptions
      console.log('📡 Requested initial data via WebSocket');

    } catch (error) {
      console.error('Failed to request initial FreqTrade data:', error);
      setPortfolioError('Failed to request FreqTrade data');
      setPortfolioLoading(false);
      setBotsLoading(false);
      setTradesLoading(false);
    }
  };

  // Manual refresh function
  const refreshData = async () => {
    if (!isConnected) {
      setPortfolioError('Not connected to FreqTrade service');
      return;
    }

    await loadInitialData();
  };

  // Bot control functions
  const startBot = async (botId: string) => {
    try {
      await freqTradeAPI.startBot(botId);
      // Status will be updated via WebSocket
    } catch (error) {
      console.error('Failed to start bot:', error);
      throw error;
    }
  };

  const stopBot = async (botId: string) => {
    try {
      await freqTradeAPI.stopBot(botId);
      // Status will be updated via WebSocket
    } catch (error) {
      console.error('Failed to stop bot:', error);
      throw error;
    }
  };

  const updateBotConfig = async (botId: string, config: any) => {
    try {
      await freqTradeAPI.updateBotConfig(botId, config);
      // Updated config will be reflected in next bot metrics update
    } catch (error) {
      console.error('Failed to update bot config:', error);
      throw error;
    }
  };

  // Format data for dashboard compatibility
  const formatPortfolioForDashboard = () => {
    if (!portfolioData) return null;

    return {
      totalValue: portfolioData.portfolioValue,
      totalBalance: portfolioData.totalBalance,
      totalPnL: portfolioData.totalPnL,
      dailyPnL: portfolioData.dailyPnL,
      weeklyPnL: portfolioData.weeklyPnL,
      monthlyPnL: portfolioData.monthlyPnL,
      botCount: portfolioData.botCount,
      activeBots: portfolioData.activeBots,
      lastUpdate: portfolioData.lastUpdate,
      performance: portfolioData.performanceMetrics
    };
  };

  const formatBotsForDashboard = () => {
    return bots.map(bot => ({
      id: bot.instanceId,
      name: bot.instanceId.replace(/^.*-/, '').replace(/-\d+$/, ''), // Extract bot name
      status: bot.status,
      active: bot.status === 'running',
      balance: bot.balance,
      totalPnL: bot.totalPnL,
      openTrades: bot.openTrades,
      closedTrades: bot.closedTrades,
      performance: bot.performance,
      config: bot.config,
      lastUpdate: bot.lastUpdate
    }));
  };

  const formatTradesForDashboard = () => {
    return recentTrades.map(trade => ({
      id: trade.tradeId,
      type: trade.side.toUpperCase(),
      symbol: trade.pair,
      amount: trade.amount,
      price: trade.price,
      timestamp: new Date(trade.openDate).toLocaleTimeString(),
      botId: trade.botId
    }));
  };

  return {
    // Connection state
    isConnected,
    lastUpdate,

    // Portfolio data
    portfolio: formatPortfolioForDashboard(),
    portfolioLoading,
    portfolioError,

    // Bot data
    bots: formatBotsForDashboard(),
    botsLoading,
    selectedBot,
    setSelectedBot: (bot: any) => {
      const freqBot = bots.find(b => b.instanceId === bot.id);
      setSelectedBot(freqBot || null);
    },

    // Trades data
    recentTrades: formatTradesForDashboard(),
    tradesLoading,

    // Chart data
    chartData,

    // Actions
    refreshData,
    startBot,
    stopBot,
    updateBotConfig,

    // Raw data access
    rawPortfolioData: portfolioData,
    rawBotsData: bots,
    rawTradesData: recentTrades
  };
};
