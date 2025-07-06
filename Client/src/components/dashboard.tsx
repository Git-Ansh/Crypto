"use client";
import {
  ChevronDown,
  RefreshCw,
  ArrowUp,
  ArrowDown,
  Settings,
  AlertTriangle,
} from "lucide-react";
import { useState, useEffect, useRef, useCallback } from "react";
import {
  AreaChart,
  Area,
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";
import {
  fetchPortfolioData,
  fetchTrades,
  fetchPositions,
  fetchBotConfig,
  isAuthenticated,
  debugAuthStatus,
  axiosInstance,
} from "@/lib/api";
import axios from "axios";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardFooter,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ModeToggle } from "@/components/mode-toggle";
import { cn } from "@/lib/utils";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { config } from "@/lib/config";
import { AppSidebar } from "@/components/app-sidebar";
import {
  SidebarProvider,
  SidebarInset,
  SidebarRail,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { PortfolioChart } from "@/components/portfolio-chart";
import { TradeHistory } from "@/components/trade-history";
import { BotControl } from "@/components/bot-control";
import { QuickTrade } from "@/components/quick-trade";
import { Positions } from "@/components/positions";
import { BotRoadmap } from "@/components/bot-roadmap";
import { AxiosError } from "axios";
import { LoadingSpinner, InlineLoading } from "@/components/ui/loading";
import { useIsMobile } from "@/hooks/use-mobile";

// ================== CONFIG ENDPOINTS ==================
// Replace the Coindesk/CC endpoints with Binance endpoints
const HISTORICAL_ENDPOINT = "https://api.binance.com/api/v3/klines"; // for OHLCV data (e.g. 1h candles)
const MINUTE_DATA_ENDPOINT = "https://api.binance.com/api/v3/klines"; // for 1m candles
const TOP_CURRENCIES_ENDPOINT = "https://api.binance.com/api/v3/ticker/24hr"; // 24hr ticker for multiple symbols
const WS_ENDPOINT = "wss://stream.binance.com:9443/ws";
const COIN_GECKO_ENDPOINT =
  "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=bitcoin,ethereum,ripple,binancecoin,cardano,solana,dogecoin,polkadot,avalanche-2,matic-network,chainlink,shiba-inu&per_page=100";

// Define the symbols you want to track – note these are in the Binance pair format.
const TOP_SYMBOLS = [
  "BTCUSDT",
  "ETHUSDT",
  "XRPUSDT",
  "BNBUSDT",
  "ADAUSDT",
  "SOLUSDT",
  "DOGEUSDT",
  "DOTUSDT",
  "AVAXUSDT",
  "MATICUSDT",
  "LINKUSDT",
  "SHIBUSDT",
];

const BATCH_THRESHOLD = 5;
const BATCH_WINDOW = 2000;
const MAX_CHART_POINTS = 1000;
const HOUR_IN_MS = 60 * 60 * 1000;

interface HistoricalResponse {
  Data: any[];
  Err?: Record<string, any>;
}

interface CryptoInfo {
  price: number;
}

interface KlineData {
  time: string;
  close: number;
  timestamp: number;
  open?: number;
  high?: number;
  low?: number;
  volume?: number;
  isMinuteData?: boolean;
}

interface WSMessage {
  TYPE: string;
  INSTRUMENT?: string;
  VALUE?: number;
}

interface CurrencyData {
  symbol: string;
  name: string;
  price: number;
  volume: number;
  marketCap: number;
  change24h: number;
  lastUpdated: number;
}

interface PortfolioData {
  totalValue: number;
  paperBalance: number;
  profitLossPercentage?: number;
  dailySnapshots: PortfolioSnapshot[];
  weeklySnapshots: PortfolioSnapshot[];
  monthlySnapshots: PortfolioSnapshot[];
  yearlySnapshots: PortfolioSnapshot[];
}

interface PortfolioSnapshot {
  timestamp: string;
  totalValue: number;
  paperBalance: number;
}

interface Trade {
  _id: string;
  type: "buy" | "sell";
  amount: number;
  symbol: string;
  price: number;
  total: number;
  executedBy: "user" | "bot";
  status: "pending" | "completed" | "failed" | "canceled";
  timestamp: string;
}

// Full Position type (if needed elsewhere)
interface Position {
  _id: string;
  symbol: string;
  amount: number;
  averageEntryPrice: number;
  currentPrice: number;
  profitLoss: number;
  profitLossPercentage: number;
  lastUpdated: string;
}

// For open positions in the Portfolio Overview we only need symbol and amount.
interface SimplePosition {
  symbol: string;
  amount: number;
}

export default function Dashboard() {
  const navigate = useNavigate();
  const { user, logout, loading: authLoading } = useAuth();
  const isMobile = useIsMobile();

  const [cryptoData, setCryptoData] = useState<CryptoInfo | null>(null);
  const [chartData, setChartData] = useState<KlineData[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [wsConnected, setWsConnected] = useState<boolean>(false);
  const [connectionStatus, setConnectionStatus] = useState<
    "connected" | "disconnected" | "connecting"
  >("disconnected");
  const [lastUpdated, setLastUpdated] = useState<string>("");
  const [forceUpdate, setForceUpdate] = useState<number>(0);

  const [portfolioHistory, setPortfolioHistory] = useState<any[]>([]);
  const [portfolioDateRange, setPortfolioDateRange] = useState<
    "24h" | "1w" | "1m" | "1y" | "all"
  >("1m");
  const [portfolioChartLoading, setPortfolioChartLoading] =
    useState<boolean>(false);

  const isNewUser = !portfolioHistory || portfolioHistory.length === 0;

  // Refs for WebSocket and batching updates
  const wsRef = useRef<WebSocket | null>(null);
  const messageCountRef = useRef<number>(0);
  const batchTimerRef = useRef<number | null>(null);
  const priceBufferRef = useRef<number | null>(null);
  const lastChartUpdateRef = useRef<number>(Date.now());

  // Ref for latest prices for all currencies (to batch table updates)
  const latestPricesRef = useRef<
    Record<string, { price: number; lastUpdated: number }>
  >({});

  // Use a ref for the currently selected currency so that the WS handler always sees the latest value
  const selectedCurrencyRef = useRef<string>("BTC");
  useEffect(
    () => {
      selectedCurrencyRef.current = selectedCurrency;
    },
    [
      /* selectedCurrency will be defined below */
    ]
  );

  // Zoom/Pan states
  const [zoomState, setZoomState] = useState<{
    xDomain?: [number, number];
    yDomain?: [number, number];
    isZoomed: boolean;
  }>({ xDomain: undefined, yDomain: undefined, isZoomed: false });

  const [touchState, setTouchState] = useState<{
    initialDistance: number;
    initialDomains: {
      x: [number, number];
      y: [number, number];
      centerX: number;
      centerY: number;
    };
  }>({
    initialDistance: 0,
    initialDomains: { x: [0, 0], y: [0, 0], centerX: 0, centerY: 0 },
  });

  const [panState, setPanState] = useState<{
    isPanning: boolean;
    lastMouseX: number;
    lastMouseY: number;
  }>({ isPanning: false, lastMouseX: 0, lastMouseY: 0 });

  // Minute data
  const [minuteData, setMinuteData] = useState<KlineData[]>([]);
  const [isLoadingMinuteData, setIsLoadingMinuteData] =
    useState<boolean>(false);
  const [minuteDataRange, setMinuteDataRange] = useState<{
    start: number;
    end: number;
  } | null>(null);

  // Top currencies
  const [topCurrencies, setTopCurrencies] = useState<CurrencyData[]>([]);
  const [isLoadingCurrencies, setIsLoadingCurrencies] = useState<boolean>(true);

  // Selected currency
  const [selectedCurrency, setSelectedCurrency] = useState<string>("BTC");
  const [selectedCurrencyName, setSelectedCurrencyName] =
    useState<string>("Bitcoin");

  // --- New/Extended Feature States ---
  const [portfolioData, setPortfolioData] = useState<PortfolioData | null>(
    null
  );
  const [portfolioLoading, setPortfolioLoading] = useState<boolean>(true);
  const [positions, setPositions] = useState<any[]>([]);
  const [positionsLoading, setPositionsLoading] = useState<boolean>(true);
  const [botActive, setBotActive] = useState<boolean>(true);
  const [botStrategy, setBotStrategy] = useState<string>("Aggressive Growth");

  // Bot names state
  const [selectedBot, setSelectedBot] = useState<string>("Trading Bot Alpha");
  const [botNames] = useState<string[]>([
    "Trading Bot Alpha",
    "DCA Bot Beta",
    "Scalping Bot Gamma",
    "Hodl Bot Delta",
    "Momentum Bot Echo",
  ]);

  const [paperBalance, setPaperBalance] = useState<number>(0);
  const [tradesLoading, setTradesLoading] = useState<boolean>(true);
  const [botConfigLoading, setBotConfigLoading] = useState<boolean>(true);
  const [portfolioProfitLoss, setPortfolioProfitLoss] = useState<number>(0);

  // For open positions we use the simpler type
  const [openPositions, setOpenPositions] = useState<SimplePosition[]>([
    { symbol: "BTC", amount: 0.05 },
    { symbol: "ETH", amount: 0.8 },
  ]);

  // Sample recent trades
  const [recentTrades, setRecentTrades] = useState<any[]>([]);
  // Bot Roadmap / Upcoming Actions (placeholder)
  const [botRoadmap, setBotRoadmap] = useState<any[]>([
    {
      id: 1,
      date: "3/11/2025",
      plan: "Buy 0.01 BTC if price dips below $77,000",
    },
    {
      id: 2,
      date: "3/12/2025",
      plan: "Rebalance portfolio to maintain 60% BTC, 40% ETH ratio",
    },
  ]);

  // Timer to update the live time display every second
  useEffect(() => {
    const timer = setInterval(() => {
      setForceUpdate((prev) => prev + 1);
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  // On mount, fill in some placeholder trades and set initial lastUpdated
  useEffect(() => {
    setRecentTrades([
      {
        id: 1,
        type: "BUY",
        symbol: "BTC",
        amount: 0.02,
        price: 28000,
        timestamp: new Date().toLocaleString(),
      },
      {
        id: 2,
        type: "SELL",
        symbol: "ETH",
        amount: 0.3,
        price: 1800,
        timestamp: new Date().toLocaleString(),
      },
    ]);

    // Set initial lastUpdated to test seconds display
    const fiveSecondsAgo = new Date(Date.now() - 5000);
    setLastUpdated(fiveSecondsAgo.toLocaleTimeString());
  }, []);

  // News data state
  const [newsItems, setNewsItems] = useState<any[]>([]);
  const [loadingNews, setLoadingNews] = useState<boolean>(true);

  // Additional state variables
  const [trades, setTrades] = useState<Trade[]>([]);
  const [botConfig, setBotConfig] = useState<any>(null);
  const [timeframe, setTimeframe] = useState<
    "24h" | "1w" | "1m" | "1y" | "all"
  >("1m");
  const [accountCreationDate, setAccountCreationDate] = useState<string | null>(
    null
  );

  // Update portfolio balance and profit/loss from fetched portfolio data
  // (Assuming the API returns these values)
  // Fetch functions
  const fetchPortfolioDataHandler = useCallback(async () => {
    try {
      setPortfolioLoading(true);
      const authStatus = debugAuthStatus();
      console.log("Auth status before portfolio request:", authStatus);
      console.log(
        "Requesting portfolio data from:",
        `${config.api.baseUrl}/api/portfolio/summary`
      );
      const response = await axiosInstance.get(`/api/portfolio/summary`);
      console.log("Portfolio data received:", response.data);
      setPortfolioData(response.data);
      setPaperBalance(response.data.paperBalance || 0);
    } catch (error: unknown) {
      console.error("Error fetching portfolio data:", error);
      if (error && typeof error === "object" && "response" in error) {
        const axiosError = error as AxiosError;
        if (axiosError.response) {
          console.error("Response data:", axiosError.response.data);
          console.error("Response status:", axiosError.response.status);
          console.error("Response headers:", axiosError.response.headers);
        }
      }
    } finally {
      setPortfolioLoading(false);
    }
  }, []);

  const fetchTradesHandler = useCallback(async () => {
    try {
      setTradesLoading(true);
      const response = await fetchTrades();
      setTrades(response.data);
    } catch (error) {
      console.error("Error fetching trades:", error);
    } finally {
      setTradesLoading(false);
    }
  }, []);

  const fetchPositionsHandler = useCallback(async () => {
    try {
      setPositionsLoading(true);
      const authStatus = debugAuthStatus();
      console.log("Auth status before positions request:", authStatus);
      const response = await axiosInstance.get(`/api/positions`);
      console.log("Positions data received:", response.data);
      setPositions(response.data);
      setOpenPositions(
        response.data.map((pos: any) => ({
          symbol: pos.symbol,
          amount: pos.amount,
        }))
      );
    } catch (error: unknown) {
      console.error("Error fetching positions:", error);
      if (error && typeof error === "object" && "response" in error) {
        const axiosError = error as AxiosError;
        if (axiosError.response) {
          console.error("Positions response data:", axiosError.response.data);
          console.error(
            "Positions response status:",
            axiosError.response.status
          );
          console.error(
            "Positions response headers:",
            axiosError.response.headers
          );
        }
      }
    } finally {
      setPositionsLoading(false);
    }
  }, []);

  const fetchBotConfigHandler = useCallback(async () => {
    try {
      setBotConfigLoading(true);
      const response = await fetchBotConfig();
      setBotConfig(response.data);
    } catch (error) {
      console.error("Error fetching bot config:", error);
    } finally {
      setBotConfigLoading(false);
    }
  }, []);

  useEffect(() => {
    if (authLoading) {
      console.log("Auth state is still loading...");
      return;
    }
    if (isAuthenticated()) {
      console.log("User is authenticated, fetching data...");
      fetchPortfolioDataHandler();
      fetchTradesHandler();
      fetchPositionsHandler();
      fetchBotConfigHandler();
    } else {
      console.log("User not authenticated, skipping data fetching");
    }
  }, [
    authLoading,
    fetchPortfolioDataHandler,
    fetchTradesHandler,
    fetchPositionsHandler,
    fetchBotConfigHandler,
  ]);

  const handleAddFunds = async (amount: number) => {
    try {
      await axios.post(
        `${config.api.baseUrl}/api/portfolio/add-funds`,
        { amount },
        { withCredentials: true }
      );
      fetchPortfolioDataHandler();
    } catch (error) {
      console.error("Error adding funds:", error);
    }
  };

  // ============== Helpers ==============
  function formatCurrency(num: number, abbreviated: boolean = false): string {
    if (abbreviated && num > 1000000) {
      return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        notation: "compact",
        compactDisplay: "short",
        maximumFractionDigits: 2,
      }).format(num);
    }
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(num);
  }

  function formatTime(timestamp: number): string {
    return new Date(timestamp).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  // ============== Top Currencies ==============
  const fetchTopCurrencies = useCallback(async () => {
    try {
      setIsLoadingCurrencies(true);
      const binanceResp = await axios.get(TOP_CURRENCIES_ENDPOINT);
      if (!binanceResp.data || !Array.isArray(binanceResp.data)) {
        throw new Error("Invalid data format from Binance API");
      }
      const geckoResp = await axios.get(COIN_GECKO_ENDPOINT);
      const supplyMap: Record<string, number> = {};
      const idToSymbol: Record<string, string> = {
        bitcoin: "BTC",
        ethereum: "ETH",
        ripple: "XRP",
        binancecoin: "BNB",
        cardano: "ADA",
        solana: "SOL",
        dogecoin: "DOGE",
        polkadot: "DOT",
        "avalanche-2": "AVAX",
        "matic-network": "MATIC",
        chainlink: "LINK",
        "shiba-inu": "SHIB",
      };
      if (geckoResp.data && Array.isArray(geckoResp.data)) {
        geckoResp.data.forEach((coin: any) => {
          const symbol = idToSymbol[coin.id];
          if (symbol) {
            supplyMap[symbol] = coin.circulating_supply;
          }
        });
      }
      const topSymbols = TOP_SYMBOLS;
      const currencies: CurrencyData[] = binanceResp.data
        .filter((item: any) => topSymbols.includes(item.symbol))
        .map((item: any) => {
          const symbol = item.symbol.replace("USDT", "");
          const circSupply = supplyMap[symbol] || 0;
          return {
            symbol,
            name: symbol,
            price: Number(item.lastPrice),
            volume: Number(item.volume),
            marketCap: Number(item.lastPrice) * circSupply,
            change24h: Number(item.priceChangePercent),
            lastUpdated: Date.now(),
          };
        });
      const top10 = currencies
        .sort((a, b) => b.marketCap - a.marketCap)
        .slice(0, 10);
      setTopCurrencies(top10);
      setIsLoadingCurrencies(false);
      return true;
    } catch (err: any) {
      console.error("Error fetching top currencies:", err);
      setIsLoadingCurrencies(false);
      return false;
    }
  }, []);

  // ============== Historical & Ticker Data ==============
  const fetchHistoricalDataForCurrency = useCallback(
    async (symbol: string): Promise<KlineData[]> => {
      try {
        const params = {
          symbol: symbol.toUpperCase() + "USDT",
          interval: "1h",
          limit: 24,
        };
        const resp = await axios.get(HISTORICAL_ENDPOINT, { params });
        const dataArray = resp.data;
        return dataArray.map((item: any) => ({
          timestamp: item[0] / 1000,
          time: formatTime(item[0]),
          open: Number(item[1]),
          high: Number(item[2]),
          low: Number(item[3]),
          close: Number(item[4]),
          volume: Number(item[5]),
        }));
      } catch (err: any) {
        console.error(`Error fetching historical data for ${symbol}:`, err);
        throw new Error(`Failed to load historical data for ${symbol}`);
      }
    },
    []
  );

  const fetchTickerDataForCurrency = useCallback(
    async (symbol: string): Promise<CryptoInfo> => {
      try {
        const params = {
          symbol: symbol.toUpperCase() + "USDT",
        };
        const endpoint = "https://api.binance.com/api/v3/ticker/24hr";
        const resp = await axios.get(endpoint, { params });
        return { price: Number(resp.data.lastPrice) };
      } catch (err: any) {
        console.error(`Error fetching ticker data for ${symbol}:`, err);
        throw new Error(`Failed to load current price for ${symbol}`);
      }
    },
    []
  );

  // ============== Minute Data ==============
  const fetchMinuteDataForCurrency = useCallback(
    async (
      symbol: string,
      startTime: number,
      endTime: number
    ): Promise<KlineData[]> => {
      try {
        setIsLoadingMinuteData(true);
        const params = {
          symbol: symbol.toUpperCase() + "USDT",
          interval: "1m",
          startTime: startTime,
          endTime: endTime,
          limit: 1000,
        };
        const resp = await axios.get(MINUTE_DATA_ENDPOINT, { params });
        const dataArray = resp.data;
        if (!Array.isArray(dataArray) || dataArray.length === 0) {
          console.warn("No minute data points in response");
          setIsLoadingMinuteData(false);
          return [];
        }
        const sortedData = dataArray
          .map((item: any) => ({
            timestamp: item[0] / 1000,
            time: formatTime(item[0]),
            open: Number(item[1]),
            high: Number(item[2]),
            low: Number(item[3]),
            close: Number(item[4]),
            volume: Number(item[5]),
            isMinuteData: true,
          }))
          .sort((a, b) => a.timestamp - b.timestamp);
        setMinuteDataRange({ start: startTime, end: endTime });
        setIsLoadingMinuteData(false);
        return sortedData;
      } catch (err: any) {
        console.error(`Error fetching minute data for ${symbol}:`, err);
        setIsLoadingMinuteData(false);
        throw new Error(`Failed to load minute data for ${symbol}`);
      }
    },
    []
  );

  // ============== WebSocket & Initialization ==============
  // Process batch for selected currency chart updates
  const processBatch = useCallback(() => {
    if (priceBufferRef.current !== null) {
      const latestPrice = priceBufferRef.current;
      const now = Date.now();
      setCryptoData((prev) =>
        prev ? { ...prev, price: latestPrice } : { price: latestPrice }
      );
      const hourElapsed = now - lastChartUpdateRef.current >= HOUR_IN_MS;
      if (hourElapsed) {
        lastChartUpdateRef.current = now;
        setChartData((prev) => {
          const newPoint: KlineData = {
            time: formatTime(now),
            close: latestPrice,
            timestamp: now / 1000,
          };
          const historicalPoints = prev.slice(0, 24);
          const livePoints = prev.slice(24);
          const updatedLivePoints = [...livePoints, newPoint];
          if (updatedLivePoints.length > MAX_CHART_POINTS - 24) {
            updatedLivePoints.shift();
          }
          return [...historicalPoints, ...updatedLivePoints];
        });
      }
      setLastUpdated(new Date().toLocaleTimeString());
    }
    messageCountRef.current = 0;
    priceBufferRef.current = null;
    if (batchTimerRef.current) {
      clearTimeout(batchTimerRef.current);
      batchTimerRef.current = null;
    }
  }, []);

  // Global WebSocket connection that subscribes to all top tickers
  const connectWebSocketAll = useCallback(() => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) return;

    console.log("Setting connection status to connecting");
    setConnectionStatus("connecting");
    const ws = new WebSocket(WS_ENDPOINT);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log("WebSocket connected");
      setWsConnected(true);
      setConnectionStatus("connected");
      console.log("Connection status set to connected");
      const subscriptionMessage = {
        method: "SUBSCRIBE",
        params: TOP_SYMBOLS.map((symbol) => symbol.toLowerCase() + "@ticker"),
        id: 1,
      };
      ws.send(JSON.stringify(subscriptionMessage));
    };

    ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data);
        if (msg && msg.c && msg.s) {
          const instrument = msg.s; // e.g., "BTCUSDT"
          const price = Number(msg.c);
          const currencySymbol = instrument.replace("USDT", "");
          // Update the latest price in a ref (for table updates)
          latestPricesRef.current[currencySymbol] = {
            price,
            lastUpdated: Date.now(),
          };
          // If this update is for the currently selected currency, batch chart updates
          if (currencySymbol === selectedCurrencyRef.current) {
            priceBufferRef.current = price;
            messageCountRef.current += 1;
            if (messageCountRef.current >= BATCH_THRESHOLD) {
              processBatch();
            } else if (!batchTimerRef.current) {
              batchTimerRef.current = window.setTimeout(
                processBatch,
                BATCH_WINDOW
              );
            }
          }
        }
      } catch (err) {
        console.error("Error parsing WS message:", err);
      }
    };

    ws.onerror = (err) => {
      console.error("WebSocket error:", err);
      setWsConnected(false);
      setConnectionStatus("disconnected");
    };

    ws.onclose = (e) => {
      setWsConnected(false);
      setConnectionStatus("disconnected");
      if (e.code !== 1000 && e.code !== 1001) {
        console.log(
          "WebSocket disconnected, attempting to reconnect in 5 seconds..."
        );
        setTimeout(() => {
          setConnectionStatus("connecting");
          setTimeout(connectWebSocketAll, 100); // Small delay before actual connection attempt
        }, 5000);
      }
    };
  }, [processBatch]);

  // Update the table of top currencies every second using the latestPricesRef
  useEffect(() => {
    const intervalId = setInterval(() => {
      setTopCurrencies((prev) =>
        prev.map((currency) => {
          const latest = latestPricesRef.current[currency.symbol];
          return latest
            ? {
                ...currency,
                price: latest.price,
                lastUpdated: latest.lastUpdated,
              }
            : currency;
        })
      );
    }, 1000);
    return () => clearInterval(intervalId);
  }, []);

  // Initialization for selected currency – note we no longer reconnect WS here
  const initializeDashboardForCurrency = useCallback(
    async (symbol: string) => {
      try {
        setLoading(true);
        setError(null);
        const historical = await fetchHistoricalDataForCurrency(symbol);
        setChartData(historical);
        const ticker = await fetchTickerDataForCurrency(symbol);
        setCryptoData(ticker);
        setLastUpdated(new Date().toLocaleTimeString());
        // Add a small delay and then set a test value for seconds display
        setTimeout(() => {
          const tenSecondsAgo = new Date(Date.now() - 10000);
          setLastUpdated(tenSecondsAgo.toLocaleTimeString());
        }, 1000);
        setLoading(false);
      } catch (err: any) {
        console.error(`Error initializing for ${symbol}:`, err);
        setError(err?.message || `Failed to load data for ${symbol}`);
        setLoading(false);
      }
    },
    [fetchHistoricalDataForCurrency, fetchTickerDataForCurrency]
  );

  // 2. Fetch news from CryptoCompare
  const fetchLatestNews = useCallback(async () => {
    try {
      setLoadingNews(true);
      const resp = await axios.get(
        "https://min-api.cryptocompare.com/data/v2/news/?lang=EN&categories=BTC,ETH,Regulation,Mining&excludeCategories=Sponsored&items=5"
      );
      if (!resp.data || !resp.data.Data) {
        throw new Error("Invalid news data format from API");
      }
      const newsData = resp.data.Data.map((item: any) => ({
        id: item.id,
        title: item.title,
        url: item.url,
        source: item.source,
        imageUrl: item.imageurl,
        categories: item.categories,
        snippet:
          item.body.length > 120
            ? item.body.substring(0, 120) + "..."
            : item.body,
        publishedAt: new Date(item.published_on * 1000).toLocaleString(),
      }));
      setNewsItems(newsData);
      setLoadingNews(false);
      return true;
    } catch (err: any) {
      console.error("Error fetching news:", err);
      setLoadingNews(false);
      return false;
    }
  }, []);

  useEffect(() => {
    fetchTopCurrencies().then(() => {
      initializeDashboardForCurrency("BTC");
    });
    fetchLatestNews();
    // Establish the global WebSocket connection once.
    connectWebSocketAll();
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      if (batchTimerRef.current) {
        clearTimeout(batchTimerRef.current);
      }
    };
  }, [
    fetchTopCurrencies,
    initializeDashboardForCurrency,
    fetchLatestNews,
    connectWebSocketAll,
  ]);

  // Fetch user data including creation date
  const fetchUserData = useCallback(async () => {
    try {
      setLoading(true);
      const response = await axiosInstance.get("/api/users/profile");
      if (response.data && response.data.createdAt) {
        console.log("Account creation date:", response.data.createdAt);
        setAccountCreationDate(response.data.createdAt);
      }
      setLoading(false);
    } catch (error) {
      console.error("Error fetching user data:", error);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUserData();
  }, [fetchUserData]);

  // ============== Handlers ==============
  const chartContainerRef = useRef<HTMLDivElement>(null);

  const handleResetZoom = useCallback(() => {
    setZoomState({ xDomain: undefined, yDomain: undefined, isZoomed: false });
    setMinuteData([]);
    setMinuteDataRange(null);
  }, []);

  const handleCurrencySelect = useCallback(
    (symbol: string) => {
      // Do not close or reconnect the WS – it stays global.
      setZoomState({ xDomain: undefined, yDomain: undefined, isZoomed: false });
      setChartData([]);
      setMinuteData([]);
      setSelectedCurrency(symbol);
      const currencyData = topCurrencies.find((c) => c.symbol === symbol);
      if (currencyData) {
        setSelectedCurrencyName(currencyData.name || symbol);
      }
      initializeDashboardForCurrency(symbol);
    },
    [topCurrencies, initializeDashboardForCurrency]
  );

  const handleRefresh = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const ticker = await fetchTickerDataForCurrency(selectedCurrency);
      setCryptoData(ticker);
      setLastUpdated(new Date().toLocaleTimeString());
      setLoading(false);
    } catch (err: any) {
      setError(err?.message || "Failed to refresh price");
      setLoading(false);
    }
  }, [fetchTickerDataForCurrency, selectedCurrency]);

  // Zoom/Pan via Mouse & Touch
  const handleTouchStart = useCallback(
    (event: React.TouchEvent<HTMLDivElement>) => {
      if (event.touches.length === 2) {
        const t1 = event.touches[0];
        const t2 = event.touches[1];
        const distance = Math.hypot(
          t2.clientX - t1.clientX,
          t2.clientY - t1.clientY
        );
        const chartRect = event.currentTarget.getBoundingClientRect();
        const centerX = (t1.clientX + t2.clientX) / 2;
        const centerY = (t1.clientY + t2.clientY) / 2;
        const xPercent = (centerX - chartRect.left) / chartRect.width;
        const yPercent = (centerY - chartRect.top) / chartRect.height;
        setTouchState({
          initialDistance: distance,
          initialDomains: {
            x: zoomState.xDomain || [0, chartData.length - 1],
            y: zoomState.yDomain || [
              Math.min(...chartData.map((d) => d.close)) * 0.99,
              Math.max(...chartData.map((d) => d.close)) * 1.01,
            ],
            centerX: xPercent,
            centerY: yPercent,
          },
        });
      } else if (event.touches.length === 1 && zoomState.isZoomed) {
        const touch = event.touches[0];
        setPanState({
          isPanning: true,
          lastMouseX: touch.clientX,
          lastMouseY: touch.clientY,
        });
      }
    },
    [chartData, zoomState]
  );

  const handleTouchMove = useCallback(
    (event: React.TouchEvent<HTMLDivElement>) => {
      if (event.touches.length === 2) {
        const t1 = event.touches[0];
        const t2 = event.touches[1];
        const distance = Math.hypot(
          t2.clientX - t1.clientX,
          t2.clientY - t1.clientY
        );
        const zoomFactor = touchState.initialDistance / distance;
        const xPercent = touchState.initialDomains.centerX;
        const yPercent = touchState.initialDomains.centerY;
        const xRange =
          touchState.initialDomains.x[1] - touchState.initialDomains.x[0];
        const yRange =
          touchState.initialDomains.y[1] - touchState.initialDomains.y[0];
        const newXDomain: [number, number] = [
          touchState.initialDomains.x[0] - xRange * (1 - zoomFactor) * xPercent,
          touchState.initialDomains.x[1] +
            xRange * (1 - zoomFactor) * (1 - xPercent),
        ];
        const newYDomain: [number, number] = [
          touchState.initialDomains.y[0] -
            yRange * (1 - zoomFactor) * (1 - yPercent),
          touchState.initialDomains.y[1] + yRange * (1 - zoomFactor) * yPercent,
        ];
        if (zoomFactor > 1) {
          const fullXDomain = [0, chartData.length - 1];
          const fullYDomain = [
            Math.min(...chartData.map((d) => d.close)) * 0.99,
            Math.max(...chartData.map((d) => d.close)) * 1.01,
          ];
          if (
            newXDomain[0] < fullXDomain[0] &&
            newXDomain[1] > fullXDomain[1] &&
            newYDomain[0] < fullYDomain[0] &&
            newYDomain[1] > fullYDomain[1]
          ) {
            return handleResetZoom();
          }
        }
        setZoomState({
          xDomain: newXDomain,
          yDomain: newYDomain,
          isZoomed: true,
        });
      } else if (
        event.touches.length === 1 &&
        panState.isPanning &&
        zoomState.isZoomed
      ) {
        const touch = event.touches[0];
        const deltaX = touch.clientX - panState.lastMouseX;
        const deltaY = touch.clientY - panState.lastMouseY;
        const currentXDomain = zoomState.xDomain || [0, chartData.length - 1];
        const currentYDomain = zoomState.yDomain || [
          Math.min(...chartData.map((d) => d.close)) * 0.99,
          Math.max(...chartData.map((d) => d.close)) * 1.01,
        ];
        const xRange = currentXDomain[1] - currentXDomain[0];
        const yRange = currentYDomain[1] - currentYDomain[0];
        const chartRect = event.currentTarget.getBoundingClientRect();
        const xShift = (deltaX / chartRect.width) * xRange * -2;
        const yShift = (deltaY / chartRect.height) * yRange;
        let newXDomain: [number, number] = [
          currentXDomain[0] + xShift,
          currentXDomain[1] + xShift,
        ];
        const newYDomain: [number, number] = [
          currentYDomain[0] + yShift,
          currentYDomain[1] + yShift,
        ];
        const fullXDomain = [0, chartData.length - 1];
        if (newXDomain[0] < fullXDomain[0]) {
          const overflow = fullXDomain[0] - newXDomain[0];
          newXDomain = [fullXDomain[0], newXDomain[1] - overflow];
        }
        if (newXDomain[1] > fullXDomain[1]) {
          const overflow = newXDomain[1] - fullXDomain[1];
          newXDomain = [newXDomain[0] + overflow, fullXDomain[1]];
        }
        setZoomState({
          xDomain: newXDomain,
          yDomain: newYDomain,
          isZoomed: true,
        });
        setPanState({
          isPanning: true,
          lastMouseX: touch.clientX,
          lastMouseY: touch.clientY,
        });
        event.preventDefault();
      }
    },
    [touchState, panState, zoomState, chartData, handleResetZoom]
  );

  const handleTouchEnd = useCallback(() => {
    setPanState((prev) => ({ ...prev, isPanning: false }));
  }, []);

  const handleMouseDown = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (zoomState.isZoomed) {
        setPanState({
          isPanning: true,
          lastMouseX: event.clientX,
          lastMouseY: event.clientY,
        });
        event.preventDefault();
      }
    },
    [zoomState.isZoomed]
  );

  const handleMouseMove = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (!panState.isPanning || !zoomState.isZoomed) return;
      const deltaX = event.clientX - panState.lastMouseX;
      const deltaY = event.clientY - panState.lastMouseY;
      const currentXDomain = zoomState.xDomain || [0, chartData.length - 1];
      const currentYDomain = zoomState.yDomain || [
        Math.min(...chartData.map((d) => d.close)) * 0.99,
        Math.max(...chartData.map((d) => d.close)) * 1.01,
      ];
      const xRange = currentXDomain[1] - currentXDomain[0];
      const yRange = currentYDomain[1] - currentYDomain[0];
      const chartRect = chartContainerRef.current?.getBoundingClientRect();
      if (!chartRect) return;
      const xShift = (deltaX / chartRect.width) * xRange * -1.5;
      const yShift = (deltaY / chartRect.height) * yRange;
      let newXDomain: [number, number] = [
        currentXDomain[0] + xShift,
        currentXDomain[1] + xShift,
      ];
      const newYDomain: [number, number] = [
        currentYDomain[0] + yShift,
        currentYDomain[1] + yShift,
      ];
      const fullXDomain = [0, chartData.length - 1];
      if (newXDomain[0] < fullXDomain[0]) {
        const overflow = fullXDomain[0] - newXDomain[0];
        newXDomain = [fullXDomain[0], newXDomain[1] - overflow];
      }
      if (newXDomain[1] > fullXDomain[1]) {
        const overflow = newXDomain[1] - fullXDomain[1];
        newXDomain = [newXDomain[0] + overflow, fullXDomain[1]];
      }
      setZoomState({
        xDomain: newXDomain,
        yDomain: newYDomain,
        isZoomed: true,
      });
      setPanState({
        isPanning: true,
        lastMouseX: event.clientX,
        lastMouseY: event.clientY,
      });
    },
    [panState, zoomState, chartData]
  );

  const handleMouseUp = useCallback(() => {
    setPanState((prev) => ({ ...prev, isPanning: false }));
  }, []);

  const handleMouseLeave = useCallback(() => {
    setPanState((prev) => ({ ...prev, isPanning: false }));
  }, []);

  useEffect(() => {
    if (!panState.isPanning) return;
    const handleGlobalMouseUp = () => {
      setPanState((prev) => ({ ...prev, isPanning: false }));
    };
    window.addEventListener("mouseup", handleGlobalMouseUp);
    return () => {
      window.removeEventListener("mouseup", handleGlobalMouseUp);
    };
  }, [panState.isPanning]);

  // ====== Portfolio Distribution and Bot Advanced Settings ======
  const portfolioDistributionData = openPositions.map(
    (pos: SimplePosition) => ({
      name: pos.symbol,
      value: pos.amount,
    })
  );

  const [botRiskLevel, setBotRiskLevel] = useState<number>(50);
  const [botTradesPerDay, setBotTradesPerDay] = useState<number>(8);
  const [botSuccessRate, setBotSuccessRate] = useState<number>(67);
  const [botAutoRebalance, setBotAutoRebalance] = useState<boolean>(true);
  const [botDCAEnabled, setBotDCAEnabled] = useState<boolean>(true);
  const [botShowAdvanced, setBotShowAdvanced] = useState<boolean>(false);

  const generatePortfolioHistory = useCallback(
    (range: string) => {
      setPortfolioChartLoading(true);
      let dataPoints = 24;
      let startValue = paperBalance * 0.98;
      let volatility = 0.01;
      let startDate = new Date();
      let dateStep = 60 * 60 * 1000;
      console.log("Using account creation date:", accountCreationDate);
      switch (range) {
        case "24h":
          dataPoints = 24;
          startValue = paperBalance * 0.98;
          volatility = 0.005;
          startDate = new Date(Date.now() - 24 * 60 * 60 * 1000);
          dateStep = 60 * 60 * 1000;
          break;
        case "1w":
          dataPoints = 7;
          startValue = paperBalance * 0.95;
          volatility = 0.01;
          startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
          dateStep = 24 * 60 * 60 * 1000;
          break;
        case "1m":
          dataPoints = 30;
          startValue = paperBalance * 0.9;
          volatility = 0.02;
          startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
          dateStep = 24 * 60 * 60 * 1000;
          break;
        case "1y":
          dataPoints = 12;
          startValue = paperBalance * 0.7;
          volatility = 0.05;
          startDate = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
          dateStep = 30 * 24 * 60 * 60 * 1000;
          break;
        case "all":
        default:
          dataPoints = 24;
          startValue = paperBalance * 0.4;
          volatility = 0.07;
          if (accountCreationDate) {
            startDate = new Date(accountCreationDate);
            console.log("Using start date:", startDate);
            const totalDays = Math.max(
              1,
              (Date.now() - startDate.getTime()) / (24 * 60 * 60 * 1000)
            );
            dateStep = Math.ceil(totalDays / dataPoints) * 24 * 60 * 60 * 1000;
            dateStep = Math.max(dateStep, 24 * 60 * 60 * 1000);
          } else {
            startDate = new Date(Date.now() - 3 * 365 * 24 * 60 * 60 * 1000);
            dateStep = 45 * 24 * 60 * 60 * 1000;
          }
          break;
      }
      const data = [];
      let currentValue = startValue;
      if (range === "all") {
        const endDate = new Date();
        const totalTimespan = endDate.getTime() - startDate.getTime();
        for (let i = 0; i < dataPoints; i++) {
          const percentage = i / (dataPoints - 1);
          const date = new Date(
            startDate.getTime() + percentage * totalTimespan
          );
          const change = (Math.random() - 0.4) * volatility * currentValue;
          currentValue += change;
          if (i === dataPoints - 1) {
            currentValue = paperBalance;
          }
          data.push({
            timestamp: date.toISOString(),
            totalValue: currentValue * 0.8,
            paperBalance: currentValue * 0.2,
          });
        }
      } else {
        for (let i = 0; i < dataPoints; i++) {
          const date = new Date(startDate.getTime() + i * dateStep);
          const change = (Math.random() - 0.4) * volatility * currentValue;
          currentValue += change;
          if (i === dataPoints - 1) {
            currentValue = paperBalance;
          }
          data.push({
            timestamp: date.toISOString(),
            totalValue: currentValue * 0.8,
            paperBalance: currentValue * 0.2,
          });
        }
      }
      setPortfolioHistory(data);
      setPortfolioChartLoading(false);
    },
    [paperBalance, accountCreationDate]
  );

  useEffect(() => {
    generatePortfolioHistory(portfolioDateRange);
  }, [portfolioDateRange, generatePortfolioHistory]);

  // ============== Render ==============
  return (
    <SidebarProvider defaultOpen={!isMobile}>
      <AppSidebar />
      <SidebarInset>
        {!isMobile && <SidebarRail className="absolute top-4.5 left-4" />}
        {/* Hide any default sidebar triggers on mobile except our custom one */}
        <style>{`
          @media (max-width: 640px) {
            [data-sidebar="trigger"]:not(.mobile-tray-icon-button) {
              display: none !important;
            }
            .sidebar-trigger:not(.mobile-tray-icon-button) {
              display: none !important;
            }
            button[data-sidebar="trigger"]:not(.mobile-tray-icon-button) {
              display: none !important;
            }
            [data-testid="sidebar-trigger"]:not(.mobile-tray-icon-button) {
              display: none !important;
            }
            .sr-only:has([data-sidebar="trigger"]):not(.mobile-tray-icon-button) {
              display: none !important;
            }
            /* Hide any button that might be positioned absolutely in top-left */
            button[style*="position: absolute"][style*="top"][style*="left"]:not(.mobile-tray-icon-button) {
              display: none !important;
            }
            /* Hide any element with fixed positioning that might be a sidebar trigger */
            [style*="position: fixed"][style*="top: 0"][style*="left: 0"]:not(.mobile-tray-icon-button) {
              display: none !important;
            }
          }
        `}</style>
        <style>{`
          html, body {
            scrollbar-width: none;
            -ms-overflow-style: none;
            overflow-x: hidden;
          }
          html::-webkit-scrollbar, 
          body::-webkit-scrollbar {
            display: none;
          }
          @keyframes glow {
            0%, 100% { text-shadow: 0 0 10px rgba(129, 161, 255, 0.7), 0 0 20px rgba(129, 161, 255, 0.5), 0 0 30px rgba(129, 161, 255, 0.3); }
            50% { text-shadow: 0 0 15px rgba(129, 161, 255, 0.9), 0 0 25px rgba(129, 161, 255, 0.7), 0 0 35px rgba(129, 161, 255, 0.5); }
          }
          .alien-text {
            font-family: "Space Mono", monospace;
            letter-spacing: 0.4em;
            font-weight: 800;
            text-transform: uppercase;
            animation: glow 2s ease-in-out infinite;
            background-clip: text;
          }
          .dark .alien-text {
            color: rgba(200, 220, 255, 0.9);
          }
          .alien-text {
            color: rgba(60, 90, 150, 0.9);
          }
          .loading-overlay {
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            display: flex;
            justify-content: center;
            align-items: center;
            z-index: 9999;
            backdrop-filter: blur(5px);
            transition: opacity 0.3s ease;
          }
          .dark .loading-overlay {
            background-color: rgba(13, 17, 23, 0.8);
          }
          .light .loading-overlay {
            background-color: rgba(255, 255, 255, 0.8);
          }
          
          /* Mobile-specific overrides for Bot Status & Strategy card */
          @media (max-width: 767px) {
            .bot-status-indicator {
              width: 12px !important;
              height: 12px !important;
              min-width: 12px !important;
              min-height: 12px !important;
              flex-shrink: 0 !important;
            }
            
            /* Aggressive progress bar targeting - make them slim and clean */
            .bot-progress-bar,
            .bot-progress-bar *,
            .bot-progress-bar > *,
            .bot-progress-bar div {
              height: 6px !important;
              min-height: 6px !important;
              max-height: 6px !important;
            }
            
            /* Ensure progress indicator fits perfectly */
            .bot-progress-bar > div {
              top: 0 !important;
              bottom: 0 !important;
              border-radius: 9999px !important;
            }
            
            .bot-section-spacing {
              margin-bottom: 16px !important;
            }
            .bot-performance-spacing {
              margin-bottom: 12px !important;
            }
            
            /* Fix mobile dropdown touch issues */
            .mobile-dropdown-fix,
            .mobile-dropdown-fix * {
              -webkit-touch-callout: none !important;
              -webkit-user-select: none !important;
              -khtml-user-select: none !important;
              -moz-user-select: none !important;
              -ms-user-select: none !important;
              user-select: none !important;
              touch-action: manipulation !important;
            }
            
            /* Ensure dropdown buttons work properly on mobile */
            .mobile-dropdown-trigger {
              touch-action: manipulation !important;
              -webkit-tap-highlight-color: transparent !important;
              cursor: pointer !important;
            }
            
            /* Dropdown content positioning fixes for mobile */
            .mobile-dropdown-content {
              position: absolute !important;
              z-index: 1000 !important;
              touch-action: manipulation !important;
            }
            
            /* Prevent iOS zoom on dropdown interaction */
            .mobile-dropdown-trigger:focus {
              outline: none !important;
              -webkit-tap-highlight-color: transparent !important;
            }
            
            /* Floating header tray styles for mobile - macOS dock style */
            .mobile-floating-header {
              position: fixed !important;
              top: 8px !important;
              left: 8px !important;
              right: 8px !important;
              z-index: 50 !important;
              background: rgba(15, 23, 43, 0.85) !important;
              backdrop-filter: blur(12px) !important;
              -webkit-backdrop-filter: blur(12px) !important;
              border: 1px solid rgba(255, 255, 255, 0.1) !important;
              border-radius: 16px !important;
              padding: 6px 8px !important;
              margin: 0 !important;
              width: calc(100% - 16px) !important;
              max-width: calc(100vw - 16px) !important;
              box-sizing: border-box !important;
              box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3) !important;
            }
            
            /* Light mode support for mobile floating header */
            .light .mobile-floating-header {
              background: rgba(255, 255, 255, 0.85) !important;
              border: 1px solid rgba(0, 0, 0, 0.1) !important;
              box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1) !important;
            }
            
            .mobile-header-content {
              display: flex !important;
              align-items: center !important;
              width: 100% !important;
              max-width: 100% !important;
              min-height: 40px !important;
              height: 40px !important;
              overflow: hidden !important;
              gap: 4px !important;
              justify-content: space-between !important;
              padding: 0 !important;
            }
            
            /* Compact button styles for mobile tray - equal distribution */
            .mobile-tray-icon-button {
              height: 36px !important;
              width: 36px !important;
              min-height: 36px !important;
              min-width: 36px !important;
              max-height: 36px !important;
              max-width: 36px !important;
              padding: 0 !important;
              border-radius: 10px !important;
              flex-shrink: 0 !important;
              display: flex !important;
              align-items: center !important;
              justify-content: center !important;
            }
            
            /* Icon sizes within buttons - fixed size */
            .mobile-tray-icon-button .lucide-icon,
            .mobile-tray-icon-button svg {
              width: 16px !important;
              height: 16px !important;
              flex-shrink: 0 !important;
            }
            
            .mobile-connection-indicator {
              width: 12px !important;
              height: 12px !important;
              flex-shrink: 0 !important;
            }
            
            .mobile-last-updated-section {
              display: flex !important;
              align-items: center !important;
              gap: 0 !important;
              flex: 1 !important;
              min-width: 0 !important;
              overflow: hidden !important;
              height: 36px !important;
              margin: 0 !important;
            }
            
            .mobile-last-updated-combined {
              height: 36px !important;
              min-height: 36px !important;
              max-height: 36px !important;
              padding: 0 12px !important;
              font-size: 10px !important;
              line-height: 1.1 !important;
              border-radius: 10px !important;
              white-space: nowrap !important;
              overflow: hidden !important;
              text-overflow: ellipsis !important;
              flex: 1 !important;
              display: flex !important;
              flex-direction: column !important;
              align-items: center !important;
              justify-content: center !important;
              width: 100% !important;
              color: white !important;
              background-color: rgba(0, 0, 0, 0.9) !important;
              border-color: rgba(0, 0, 0, 0.3) !important;
            }
            
            /* Dark mode support for mobile floating header */
            .dark .mobile-last-updated-combined {
              background-color: rgba(255, 255, 255, 0.9) !important;
              border-color: rgba(255, 255, 255, 0.3) !important;
              color: black !important;
            }
            
            .mobile-last-updated-combined * {
              color: white !important;
              overflow: visible !important;
            }
            
            /* Dark mode text colors */
            .dark .mobile-last-updated-combined * {
              color: black !important;
            }
            
            /* Extra specificity for time element */
            .mobile-last-updated-section .mobile-last-updated-combined .mobile-last-updated-time {
              color: white !important;
              font-weight: 600 !important;
            }
            
            /* Dark mode specificity */
            .dark .mobile-last-updated-section .mobile-last-updated-combined .mobile-last-updated-time {
              color: black !important;
            }
            
            /* Force text color on all mobile tray text elements */
            .mobile-floating-header .mobile-last-updated-time,
            .mobile-floating-header .mobile-last-updated-combined .mobile-last-updated-time {
              color: rgb(255, 255, 255) !important;
              text-shadow: none !important;
              opacity: 1 !important;
              filter: none !important;
            }
            
            /* Dark mode overrides */
            .dark .mobile-floating-header .mobile-last-updated-time,
            .dark .mobile-floating-header .mobile-last-updated-combined .mobile-last-updated-time {
              color: rgb(0, 0, 0) !important;
            }
            
            /* Override any disabled or muted styles */
            .mobile-last-updated-combined:disabled,
            .mobile-last-updated-combined[disabled],
            .mobile-last-updated-combined .mobile-last-updated-time {
              color: rgb(255, 255, 255) !important;
              opacity: 1 !important;
            }
            
            /* Dark mode disabled styles */
            .dark .mobile-last-updated-combined:disabled,
            .dark .mobile-last-updated-combined[disabled],
            .dark .mobile-last-updated-combined .mobile-last-updated-time {
              color: rgb(0, 0, 0) !important;
            }
            
            .mobile-last-updated-text {
              font-size: 7px !important;
              line-height: 1 !important;
              opacity: 0.8 !important;
              margin: 0 !important;
              padding: 0 !important;
              color: rgb(255, 255, 255) !important;
              text-transform: uppercase !important;
              text-align: center !important;
            }
            
            /* Dark mode text color */
            .dark .mobile-last-updated-text {
              color: rgb(0, 0, 0) !important;
            }
            
            .mobile-last-updated-time {
              font-size: 9px !important;
              line-height: 1 !important;
              font-weight: 600 !important;
              margin: 0 !important;
              padding: 0 !important;
              color: white !important;
              text-align: center !important;
            }
            
            /* Dark mode time color */
            .dark .mobile-last-updated-time {
              color: black !important;
            }
            
            .mobile-connection-wrapper {
              display: flex !important;
              align-items: center !important;
              justify-content: center !important;
              flex-shrink: 0 !important;
              min-width: 12px !important;
              width: 12px !important;
              height: 12px !important;
              margin: 0 !important;
            }
            
            /* Remove unused right buttons wrapper since we're using individual flex items */
            
            /* Adjust main content padding for mobile floating header - match tray width */
            .mobile-content-wrapper {
              padding-top: 56px !important;
              padding-left: 0 !important;
              padding-right: 0 !important;
              padding-bottom: 16px !important;
              margin: 0 !important;
              width: 100vw !important;
              max-width: 100vw !important;
              box-sizing: border-box !important;
            }
            
            /* Mobile title section - match tray width exactly */
            .mobile-title-section {
              position: relative !important;
              left: 8px !important;
              right: 8px !important;
              padding: 12px 0 8px 0 !important;
              margin-bottom: 16px !important;
              margin-left: 0 !important;
              margin-right: 0 !important;
              width: calc(100% - 16px) !important;
              max-width: calc(100vw - 16px) !important;
              box-sizing: border-box !important;
            }
            
            .mobile-title-section h1 {
              font-size: 24px !important;
              font-weight: 700 !important;
              text-align: left !important;
              padding-left: 0 !important;
              margin: 0 !important;
            }
            
            /* Ensure all mobile content respects boundaries */
            .mobile-content-container {
              width: 100% !important;
              max-width: 100% !important;
              overflow-x: hidden !important;
              box-sizing: border-box !important;
            }
            
            /* Mobile footer specific styling */
            .mobile-footer {
              position: relative !important;
              left: 8px !important;
              right: 8px !important;
              margin-left: 0 !important;
              margin-right: 0 !important;
              width: calc(100% - 16px) !important;
              max-width: calc(100vw - 16px) !important;
              box-sizing: border-box !important;
              padding-left: 0 !important;
              padding-right: 0 !important;
            }
            
            /* Mobile section padding to match header tray */
            .mobile-section-padding {
              position: relative !important;
              left: 8px !important;
              right: 8px !important;
              margin-left: 0 !important;
              margin-right: 0 !important;
              width: calc(100% - 10px) !important;
              max-width: calc(100vw - 10px) !important;
              box-sizing: border-box !important;
              padding-left: 0 !important;
              padding-right: 0 !important;
            }
            
            /* Remove problematic responsive overrides */
            .mobile-grid-responsive {
              /* Use default gap spacing */
            }
            
            .mobile-card-responsive {
              /* Use default card styling */
            }
            
            .mobile-text-responsive {
              /* Use default text sizing */
            }
            
            .mobile-title-responsive {
              /* Use default title sizing */
            }
          }
            
            /* Mobile-specific toggle switch fixes */
            .toggle-switch-mobile {
              width: 32px !important;
              height: 16px !important;
              min-width: 32px !important;
              min-height: 16px !important;
              display: flex !important;
              align-items: center !important;
              padding: 1px !important;
            }
            
            .toggle-thumb-mobile {
              width: 12px !important;
              height: 12px !important;
              min-width: 12px !important;
              min-height: 12px !important;
              margin: 0 !important;
              position: absolute !important;
              top: 50% !important;
              left: 2px !important;
              transform: translateY(-50%) !important;
              transition: transform 200ms ease-in-out, left 200ms ease-in-out !important;
            }
            
            .toggle-switch-mobile[data-state="checked"] .toggle-thumb-mobile {
              left: 18px !important;
              transform: translateY(-50%) !important;
            }
            
            .toggle-switch-mobile[data-state="unchecked"] .toggle-thumb-mobile {
              left: 2px !important;
              transform: translateY(-50%) !important;
            }
          }
          
          /* Desktop progress bar styles */
          @media (min-width: 768px) {
            .bot-progress-bar,
            .bot-progress-bar *,
            .bot-progress-bar > *,
            .bot-progress-bar div {
              height: 4px !important;
              min-height: 4px !important;
              max-height: 4px !important;
            }
            
            .bot-progress-bar > div {
              top: 0 !important;
              bottom: 0 !important;
              border-radius: 9999px !important;
            }
          }
        `}</style>
        {(loading || isLoadingCurrencies) && (
          <div className="loading-overlay">
            <div className="text-center">
              <h1 className="crypto-dashboard-title text-4xl sm:text-6xl md:text-7xl">
                CRYPTO PILOT
              </h1>
            </div>
          </div>
        )}
        <div
          className={cn(
            "w-full overflow-hidden no-scrollbar sidebar-responsive-content",
            isMobile
              ? "mobile-content-wrapper mobile-content-container"
              : "p-2 sm:p-4"
          )}
          style={{ maxWidth: "100%" }}
        >
          {/* Mobile Floating Header Tray */}
          {isMobile && (
            <div className="mobile-floating-header">
              <div className="mobile-header-content">
                {/* 1. Sidebar Toggle Button - First element */}
                <div
                  style={{
                    flex: "0 0 36px",
                    display: "flex",
                    justifyContent: "center",
                  }}
                >
                  <SidebarTrigger className="mobile-tray-icon-button bg-transparent border-black/20 dark:border-white/20 text-black/90 dark:text-white/90 hover:bg-black/10 dark:hover:bg-white/10" />
                </div>

                {/* 2. "LAST UPDATED" section - Takes remaining space */}
                <div className="group relative mobile-last-updated-section">
                  <div
                    className="mobile-last-updated-combined"
                    style={{
                      color: "white !important",
                      backgroundColor: "rgba(0, 0, 0, 0.9) !important",
                      borderColor: "rgba(0, 0, 0, 0.3) !important",
                      border: "1px solid rgba(0, 0, 0, 0.3)",
                      borderRadius: "10px",
                      padding: "0 12px",
                      height: "36px",
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      justifyContent: "center",
                      flex: "1",
                      width: "100%",
                      maxWidth: "100%",
                      overflow: "hidden",
                    }}
                  >
                    <div
                      className="mobile-last-updated-text"
                      style={{
                        color: "rgb(255, 255, 255) !important",
                        fontSize: "7px !important",
                        lineHeight: "1 !important",
                        textTransform: "uppercase",
                        opacity: "0.8 !important",
                      }}
                    >
                      LAST UPDATED
                    </div>
                    <div
                      className="mobile-last-updated-time"
                      style={{
                        color: "rgb(255, 255, 255) !important",
                        fontSize: "9px !important",
                        fontWeight: "600 !important",
                        lineHeight: "1 !important",
                        textShadow: "none !important",
                        opacity: "1 !important",
                        filter: "none !important",
                      }}
                    >
                      {(() => {
                        // Show current live time (e.g., 6:17:23)
                        const now = new Date();
                        // Include forceUpdate to trigger re-render every second
                        forceUpdate;
                        return now.toLocaleTimeString("en-US", {
                          hour12: false,
                          hour: "numeric",
                          minute: "2-digit",
                          second: "2-digit",
                        });
                      })()}
                    </div>
                  </div>
                  {/* Tooltip for Last Updated */}
                  <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-3 py-1 bg-black/80 text-white text-xs rounded-md shadow-lg opacity-0 group-hover:opacity-100 transition-opacity duration-200 whitespace-nowrap z-50 border border-white/20">
                    <div className="font-medium">Last Updated</div>
                    <div className="text-white/70">
                      {lastUpdated
                        ? `Data refreshed at ${lastUpdated}`
                        : "No data refresh yet"}
                    </div>
                    <div className="absolute top-full left-1/2 transform -translate-x-1/2 w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-black/80"></div>
                  </div>
                </div>

                {/* 3. Connection Indicator - Center element */}
                <div
                  style={{
                    flex: "0 0 36px",
                    display: "flex",
                    justifyContent: "center",
                  }}
                >
                  <div className="mobile-connection-wrapper">
                    <div className="group relative">
                      <span
                        className={cn(
                          "mobile-connection-indicator inline-block rounded-full transition-all duration-300 cursor-help shadow-lg",
                          wsConnected
                            ? "bg-green-500 shadow-green-500/50"
                            : connectionStatus === "connecting"
                            ? "bg-yellow-500 shadow-yellow-500/50 animate-pulse"
                            : "bg-red-500 shadow-red-500/50 animate-ping"
                        )}
                        style={
                          connectionStatus === "connecting"
                            ? {
                                animationDuration: "2s",
                              }
                            : {}
                        }
                        title={
                          wsConnected
                            ? "Real-time data connected"
                            : connectionStatus === "connecting"
                            ? "Connecting to real-time data..."
                            : "Connection lost - data may be outdated"
                        }
                      />
                      {/* Tooltip */}
                      <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-3 py-1 bg-black/80 text-white text-xs rounded-md shadow-lg opacity-0 group-hover:opacity-100 transition-opacity duration-200 whitespace-nowrap z-50 border border-white/20">
                        <div className="font-medium">
                          {wsConnected
                            ? "Connected"
                            : connectionStatus === "connecting"
                            ? "Connecting..."
                            : "Disconnected"}
                        </div>
                        <div className="text-white/70">
                          {wsConnected
                            ? "Real-time market data active"
                            : connectionStatus === "connecting"
                            ? "Establishing connection..."
                            : "Attempting to reconnect..."}
                        </div>
                        <div className="absolute top-full left-1/2 transform -translate-x-1/2 w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-black/80"></div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* 4. Refresh Button - Individual element */}
                <div
                  style={{
                    flex: "0 0 36px",
                    display: "flex",
                    justifyContent: "center",
                  }}
                >
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleRefresh}
                    disabled={loading}
                    className="mobile-tray-icon-button bg-transparent border-black/20 dark:border-white/20 text-black/90 dark:text-white/90 hover:bg-black/10 dark:hover:bg-white/10"
                  >
                    <RefreshCw className="h-4 w-4" />
                  </Button>
                </div>

                {/* 5. Mode Toggle - Individual element */}
                <div
                  style={{
                    flex: "0 0 36px",
                    display: "flex",
                    justifyContent: "center",
                  }}
                >
                  <ModeToggle className="mobile-tray-icon-button bg-transparent border-black/20 dark:border-white/20 text-black/90 dark:text-white/90 hover:bg-black/10 dark:hover:bg-white/10" />
                </div>
              </div>
            </div>
          )}

          {/* Mobile Title Section - Below the tray */}
          {isMobile && (
            <div className="mobile-title-section">
              <h1 className="text-3xl font-bold crypto-dashboard-title">
                Crypto Pilot Dashboard
              </h1>
            </div>
          )}

          {/* Header - Desktop Only */}
          <div className="hidden sm:flex flex-col gap-4 mb-4 sm:mb-6">
            {/* Desktop and mobile title row */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
              <div className="pl-10">
                <h1 className="text-3xl font-bold crypto-dashboard-title">
                  Crypto Pilot Dashboard
                </h1>
              </div>

              {/* Desktop: Controls on the right */}
              <div className="hidden sm:flex flex-col sm:flex-row items-start sm:items-center gap-2 sm:gap-4 w-full sm:w-auto">
                <div className="flex items-center gap-2">
                  <div className="text-xs sm:text-sm text-muted-foreground">
                    Last updated: {lastUpdated || "Never"}
                  </div>
                  <div className="group relative">
                    <span
                      className={cn(
                        "inline-block w-3 h-3 rounded-full transition-all duration-300 cursor-help shadow-lg",
                        wsConnected
                          ? "bg-green-500 shadow-green-500/50"
                          : connectionStatus === "connecting"
                          ? "bg-yellow-500 shadow-yellow-500/50 animate-pulse"
                          : "bg-red-500 shadow-red-500/50 animate-ping"
                      )}
                      style={
                        connectionStatus === "connecting"
                          ? {
                              animationDuration: "2s",
                            }
                          : {}
                      }
                      title={
                        wsConnected
                          ? "Real-time data connected"
                          : connectionStatus === "connecting"
                          ? "Connecting to real-time data..."
                          : "Connection lost - data may be outdated"
                      }
                    />
                    {/* Tooltip */}
                    <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-3 py-1 bg-popover text-popover-foreground text-sm rounded-md shadow-lg opacity-0 group-hover:opacity-100 transition-opacity duration-200 whitespace-nowrap z-50 border">
                      <div className="font-medium">
                        {wsConnected
                          ? "Connected"
                          : connectionStatus === "connecting"
                          ? "Connecting..."
                          : "Disconnected"}
                      </div>
                      <div className="text-muted-foreground">
                        {wsConnected
                          ? "Real-time market data active"
                          : connectionStatus === "connecting"
                          ? "Establishing connection..."
                          : "Attempting to reconnect..."}
                      </div>
                      <div className="absolute top-full left-1/2 transform -translate-x-1/2 w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-popover"></div>
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleRefresh}
                    disabled={loading}
                  >
                    <RefreshCw className="h-3 w-3 sm:h-4 sm:w-4 mr-1 sm:mr-2" />
                    {loading ? "Loading" : "Refresh"}
                  </Button>
                  <ModeToggle />
                </div>
              </div>
            </div>
          </div>
          {error && (
            <Card
              className={cn(
                "mb-4 sm:mb-6 border-red-500",
                isMobile && "mobile-section-padding"
              )}
            >
              <CardContent className="p-2 sm:p-4 text-red-500 text-sm">
                {error}
              </CardContent>
            </Card>
          )}
          {/* Row 1: Portfolio & Bot */}
          <div
            className={cn(
              "grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6 mb-4 sm:mb-6",
              isMobile && "mobile-section-padding"
            )}
          >
            {/* Consolidated Portfolio Overview & Value Chart */}
            <Card className="lg:col-span-1">
              <CardHeader className="p-3 sm:p-4 pb-0">
                <div className="flex justify-between items-start">
                  <div className="flex-1">
                    <CardTitle className="text-base sm:text-lg">
                      Portfolio Overview
                    </CardTitle>
                    <p className="mb-2 text-muted-foreground text-sm">
                      {isNewUser
                        ? `Welcome, ${user?.name || "Trader"}!`
                        : `Welcome back, ${user?.name || "Trader"}!`}
                    </p>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-3 sm:p-4">
                {portfolioLoading ? (
                  <InlineLoading
                    message="Loading portfolio..."
                    size="md"
                    className="h-48"
                  />
                ) : (
                  <div className="space-y-2">
                    {/* Portfolio Stats - Mobile: 2 rows, Desktop: 3-column */}
                    <div className="flex flex-col space-y-2 sm:grid sm:grid-cols-3 sm:gap-4 sm:space-y-0 text-sm">
                      {/* Mobile: First row with Balance and Open Positions side by side */}
                      <div className="grid grid-cols-2 gap-4 sm:block sm:col-span-1">
                        <div className="flex justify-between sm:block">
                          <p className="text-muted-foreground">Balance</p>
                          <p className="text-lg font-semibold sm:mt-1">
                            {formatCurrency(portfolioData?.paperBalance || 0)}
                          </p>
                        </div>
                        <div className="sm:hidden">
                          <p className="text-muted-foreground mb-1">
                            Open Positions
                          </p>
                          {positions.length === 0 ? (
                            <p className="text-xs text-muted-foreground">
                              No positions held
                            </p>
                          ) : (
                            <div className="space-y-1">
                              {openPositions
                                .slice(0, 2)
                                .map((pos: SimplePosition) => (
                                  <div
                                    key={pos.symbol}
                                    className="flex justify-between text-xs"
                                  >
                                    <span>{pos.symbol}</span>
                                    <span>{pos.amount.toFixed(4)}</span>
                                  </div>
                                ))}
                              {openPositions.length > 2 && (
                                <p className="text-xs text-muted-foreground">
                                  +{openPositions.length - 2} more
                                </p>
                              )}
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Mobile: Second row with Overall P/L, Desktop: Second column */}
                      <div className="flex justify-between sm:block">
                        <p className="text-muted-foreground">Overall P/L</p>
                        <p
                          className={cn(
                            "text-lg font-semibold sm:mt-1",
                            (portfolioData?.profitLossPercentage || 0) >= 0
                              ? "text-green-600"
                              : "text-red-600"
                          )}
                        >
                          {(portfolioData?.profitLossPercentage || 0) >= 0
                            ? "+"
                            : ""}
                          {(portfolioData?.profitLossPercentage || 0).toFixed(
                            2
                          )}
                          %
                        </p>
                      </div>

                      {/* Desktop: Third column - Open Positions */}
                      <div className="hidden sm:block">
                        <div className="flex justify-between items-start sm:block">
                          <p className="text-muted-foreground">
                            Open Positions
                          </p>
                          {positions.length === 0 ? (
                            <p className="text-sm text-muted-foreground sm:mt-1">
                              No positions held
                            </p>
                          ) : (
                            <div className="text-right sm:text-left sm:mt-1">
                              <div className="space-y-1 sm:space-y-1">
                                {openPositions
                                  .slice(0, 2)
                                  .map((pos: SimplePosition) => (
                                    <div
                                      key={pos.symbol}
                                      className="flex justify-between text-xs sm:justify-between"
                                    >
                                      <span>{pos.symbol}</span>
                                      <span>{pos.amount.toFixed(4)}</span>
                                    </div>
                                  ))}
                                {openPositions.length > 2 && (
                                  <p className="text-xs text-muted-foreground">
                                    +{openPositions.length - 2} more
                                  </p>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Portfolio Value Chart - Mobile: Larger, Desktop: Same */}
                    <div className="border-t pt-2 -mx-3 sm:-mx-4 px-2 sm:px-3">
                      {/* Time frame dropdown above the chart */}
                      <div className="flex justify-between items-center mb-3">
                        <h4 className="text-sm font-medium text-muted-foreground">
                          Portfolio Value
                        </h4>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="outline"
                              size="sm"
                              className={cn(
                                "h-8 flex justify-center items-center",
                                isMobile
                                  ? "w-[40px] text-sm px-1 min-w-0 bg-background text-white dark:text-black"
                                  : "w-auto px-3"
                              )}
                            >
                              <span
                                className={
                                  isMobile
                                    ? "text-sm font-bold text-white dark:text-black"
                                    : ""
                                }
                              >
                                {isMobile
                                  ? portfolioDateRange === "24h"
                                    ? "24h"
                                    : portfolioDateRange === "1w"
                                    ? "1w"
                                    : portfolioDateRange === "1m"
                                    ? "1m"
                                    : portfolioDateRange === "1y"
                                    ? "1y"
                                    : "all"
                                  : portfolioDateRange}
                              </span>
                              <ChevronDown
                                className={cn(
                                  "opacity-50 flex-shrink-0",
                                  isMobile ? "h-3 w-3 ml-1" : "h-4 w-4 ml-2"
                                )}
                              />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent>
                            <DropdownMenuItem
                              onClick={() => setPortfolioDateRange("24h")}
                            >
                              24h
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => setPortfolioDateRange("1w")}
                            >
                              1 Week
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => setPortfolioDateRange("1m")}
                            >
                              1 Month
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => setPortfolioDateRange("1y")}
                            >
                              1 Year
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => setPortfolioDateRange("all")}
                            >
                              All Time
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                      <div className="w-full h-60 sm:h-62 overflow-hidden rounded-md">
                        {portfolioChartLoading ? (
                          <InlineLoading
                            message="Loading chart data..."
                            size="md"
                            className="h-full"
                          />
                        ) : (
                          <div className="w-full h-full overflow-visible">
                            <PortfolioChart
                              data={portfolioHistory}
                              timeframe={
                                portfolioDateRange as
                                  | "24h"
                                  | "1w"
                                  | "1m"
                                  | "1y"
                                  | "all"
                              }
                              isMobile={isMobile}
                            />
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
            {/* Bot Status & Strategy */}
            <Card className="lg:col-span-1">
              <CardHeader className="p-3 sm:p-4 pb-0">
                <div className="flex justify-between items-center">
                  <CardTitle className="text-base sm:text-lg">
                    Bot Status & Strategy
                  </CardTitle>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setBotShowAdvanced((prev) => !prev)}
                    className="h-8 w-8 p-0"
                  >
                    <Settings className="h-4 w-4" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="p-3 sm:p-4">
                {/* Mobile-first layout with forced CSS classes */}
                <div className="space-y-4 sm:space-y-3">
                  <div className="bot-section-spacing mobile-dropdown-fix">
                    <Label htmlFor="bot-select" className="text-sm font-medium">
                      Bot Name
                    </Label>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          id="bot-select"
                          variant="outline"
                          className="mt-1 w-full flex justify-between items-center h-9 sm:h-auto mobile-dropdown-trigger"
                        >
                          {selectedBot || "Select bot"}
                          <ChevronDown className="h-4 w-4 opacity-50" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent
                        align="start"
                        className="w-[280px] sm:w-[500px] h-auto mobile-dropdown-content"
                      >
                        {botNames.map((botName) => (
                          <DropdownMenuItem
                            key={botName}
                            onClick={() => setSelectedBot(botName)}
                          >
                            {botName}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                  <div className="flex items-center gap-3 bot-section-spacing">
                    <div
                      className={cn(
                        "bot-status-indicator w-3 h-3 sm:w-4 sm:h-4 rounded-full shrink-0 flex-shrink-0",
                        botActive ? "bg-green-500" : "bg-red-500"
                      )}
                    />
                    <p className="text-sm font-medium">
                      Status:{" "}
                      <span
                        className={
                          botActive ? "text-green-600" : "text-red-600"
                        }
                      >
                        {botActive ? "Active" : "Paused"}
                      </span>
                    </p>
                  </div>
                  <div className="bot-section-spacing mobile-dropdown-fix">
                    <Label
                      htmlFor="strategy-select"
                      className="text-sm font-medium"
                    >
                      Strategy
                    </Label>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          id="strategy-select"
                          variant="outline"
                          className="mt-1 w-full flex justify-between items-center h-9 sm:h-auto mobile-dropdown-trigger"
                        >
                          {botStrategy || "Select strategy"}
                          <ChevronDown className="h-4 w-4 opacity-50" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent
                        align="start"
                        className="w-[280px] sm:w-[500px] h-auto mobile-dropdown-content"
                      >
                        <DropdownMenuItem
                          onClick={() => setBotStrategy("Aggressive Growth")}
                        >
                          Aggressive Growth
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => setBotStrategy("Conservative")}
                        >
                          Conservative
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => setBotStrategy("Balanced")}
                        >
                          Balanced
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setBotStrategy("DCA")}>
                          Dollar-Cost Averaging
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => setBotStrategy("Trend Following")}
                        >
                          Trend Following
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                  <div className="bot-section-spacing">
                    <p className="text-sm font-medium bot-performance-spacing sm:mb-2">
                      Bot Performance
                    </p>
                    <div className="space-y-3 sm:space-y-2">
                      <div>
                        <div className="flex justify-between text-sm sm:text-xs mb-1">
                          <span>Success Rate</span>
                          <span className="font-medium">{botSuccessRate}%</span>
                        </div>
                        <div className="bot-progress-bar w-full bg-secondary rounded-full h-1.5 sm:h-1 overflow-hidden relative">
                          <div
                            className="bg-primary h-full rounded-full transition-all duration-300 ease-in-out absolute top-0 left-0"
                            style={{ width: `${botSuccessRate}%` }}
                          />
                        </div>
                      </div>
                      <div>
                        <div className="flex justify-between text-sm sm:text-xs mb-1">
                          <span>Avg. Trades/Day</span>
                          <span className="font-medium">{botTradesPerDay}</span>
                        </div>
                        <div className="bot-progress-bar w-full bg-secondary rounded-full h-1.5 sm:h-1 overflow-hidden relative">
                          <div
                            className="bg-primary h-full rounded-full transition-all duration-300 ease-in-out absolute top-0 left-0"
                            style={{
                              width: `${Math.min(botTradesPerDay * 5, 100)}%`,
                            }}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                  {botShowAdvanced && (
                    <div className="pt-3 sm:pt-2 border-t">
                      <p className="text-sm font-medium mb-3 sm:mb-2">
                        Advanced Settings
                      </p>
                      <div className="space-y-4">
                        <div>
                          <div className="flex justify-between items-center mb-2 sm:mb-1">
                            <Label htmlFor="risk-level" className="text-xs">
                              Risk Level
                            </Label>
                            <span className="text-xs font-medium">
                              {botRiskLevel}%
                            </span>
                          </div>
                          <Slider
                            id="risk-level"
                            min={10}
                            max={90}
                            step={10}
                            value={[botRiskLevel]}
                            onValueChange={(value) => setBotRiskLevel(value[0])}
                          />
                          {botRiskLevel > 70 && (
                            <div className="flex items-center mt-2 sm:mt-1 text-amber-600 text-xs sm:text-[10px] gap-1">
                              <AlertTriangle className="h-3 w-3" />
                              <span>
                                High risk settings may lead to increased
                                volatility
                              </span>
                            </div>
                          )}
                        </div>
                        <div className="flex items-center justify-between">
                          <div className="flex flex-col gap-1">
                            <Label htmlFor="auto-rebalance" className="text-xs">
                              Auto-Rebalance
                            </Label>
                            <span className="text-xs sm:text-[10px] text-muted-foreground">
                              Maintains target allocation
                            </span>
                          </div>
                          <div
                            className={cn(
                              "relative cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out",
                              "toggle-switch-mobile sm:inline-flex sm:h-[24px] sm:w-[44px] sm:shrink-0",
                              botAutoRebalance ? "bg-primary" : "bg-input"
                            )}
                            data-state={
                              botAutoRebalance ? "checked" : "unchecked"
                            }
                            onClick={() => setBotAutoRebalance((prev) => !prev)}
                          >
                            <span
                              className={cn(
                                "pointer-events-none block rounded-full bg-background shadow-lg ring-0",
                                "toggle-thumb-mobile sm:relative sm:h-5 sm:w-5 sm:top-auto sm:left-auto sm:transition-transform sm:duration-200 sm:ease-in-out",
                                botAutoRebalance
                                  ? "sm:translate-x-5"
                                  : "sm:translate-x-0"
                              )}
                              data-state={
                                botAutoRebalance ? "checked" : "unchecked"
                              }
                            />
                          </div>
                        </div>
                        <div className="flex items-center justify-between">
                          <div className="flex flex-col gap-1">
                            <Label htmlFor="dca-enabled" className="text-xs">
                              DCA Enabled
                            </Label>
                            <span className="text-xs sm:text-[10px] text-muted-foreground">
                              Dollar-cost averaging
                            </span>
                          </div>
                          <div
                            className={cn(
                              "relative cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out",
                              "toggle-switch-mobile sm:inline-flex sm:h-[24px] sm:w-[44px] sm:shrink-0",
                              botDCAEnabled ? "bg-primary" : "bg-input"
                            )}
                            data-state={botDCAEnabled ? "checked" : "unchecked"}
                            onClick={() => setBotDCAEnabled((prev) => !prev)}
                          >
                            <span
                              className={cn(
                                "pointer-events-none block rounded-full bg-background shadow-lg ring-0",
                                "toggle-thumb-mobile sm:relative sm:h-5 sm:w-5 sm:top-auto sm:left-auto sm:transition-transform sm:duration-200 sm:ease-in-out",
                                botDCAEnabled
                                  ? "sm:translate-x-5"
                                  : "sm:translate-x-0"
                              )}
                              data-state={
                                botDCAEnabled ? "checked" : "unchecked"
                              }
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                  <div className="pt-4 sm:pt-3">
                    <Button
                      variant={botActive ? "destructive" : "default"}
                      size="sm"
                      className="w-full"
                      onClick={() => setBotActive((prev) => !prev)}
                    >
                      {botActive ? "Pause Bot" : "Activate Bot"}
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
          {/* Row 2: Ticker/Chart & Top Crypto */}
          <div
            className={cn(
              "grid grid-cols-1 lg:grid-cols-3 gap-3 sm:gap-4",
              isMobile && "mobile-section-padding"
            )}
          >
            {/* Main chart side */}
            <div className="lg:col-span-2">
              {chartData.length > 0 && (
                <Card className="mb-3 sm:mb-4">
                  <CardHeader className="p-3 sm:p-4 pb-0">
                    <div className="flex flex-col sm:flex-row justify-between gap-2 w-full">
                      <div className="flex flex-col gap-1">
                        <CardTitle className="text-base sm:text-lg">
                          {selectedCurrency}/USD Chart
                        </CardTitle>
                        {cryptoData && (
                          <div className="flex items-center gap-2">
                            <span className="text-sm sm:text-base font-semibold">
                              {formatCurrency(cryptoData.price)}
                            </span>
                            {topCurrencies.find(
                              (c) => c.symbol === selectedCurrency
                            )?.change24h !== undefined && (
                              <span
                                className={cn(
                                  "text-xs rounded-md px-1.5 py-0.5 font-medium",
                                  (topCurrencies.find(
                                    (c) => c.symbol === selectedCurrency
                                  )?.change24h || 0) >= 0
                                    ? "bg-green-500/10 text-green-600"
                                    : "bg-red-500/10 text-red-600"
                                )}
                              >
                                {(topCurrencies.find(
                                  (c) => c.symbol === selectedCurrency
                                )?.change24h || 0) >= 0
                                  ? "+"
                                  : ""}
                                {(
                                  topCurrencies.find(
                                    (c) => c.symbol === selectedCurrency
                                  )?.change24h || 0
                                ).toFixed(2)}
                                %
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                      <div className="flex items-center space-x-2">
                        <span className="text-xs text-muted-foreground">
                          Last updated: {lastUpdated || "Never"}
                        </span>
                        {zoomState.isZoomed && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={handleResetZoom}
                            className="text-xs"
                          >
                            Reset Zoom
                          </Button>
                        )}
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="p-2 sm:p-4">
                    <div
                      ref={chartContainerRef}
                      onMouseDown={handleMouseDown}
                      onMouseMove={handleMouseMove}
                      onMouseUp={handleMouseUp}
                      onMouseLeave={handleMouseLeave}
                      onTouchStart={handleTouchStart}
                      onTouchMove={handleTouchMove}
                      onTouchEnd={handleTouchEnd}
                      style={{
                        width: "100%",
                        height: 250,
                        touchAction: "none",
                        cursor: panState.isPanning
                          ? "grabbing"
                          : zoomState.isZoomed
                          ? "grab"
                          : "default",
                        userSelect: "none",
                        overflow: "hidden",
                      }}
                    >
                      <ResponsiveContainer width="100%" height={250}>
                        <LineChart
                          data={
                            zoomState.isZoomed && minuteData.length > 0
                              ? minuteData
                              : chartData
                          }
                          margin={{ top: 5, right: 10, left: 0, bottom: 0 }}
                        >
                          <CartesianGrid
                            strokeDasharray="3 3"
                            stroke="#aaa"
                            opacity={0.2}
                          />
                          <XAxis
                            dataKey="time"
                            tick={{ fontSize: 9 }}
                            domain={zoomState.xDomain}
                            allowDataOverflow
                            interval="preserveStartEnd"
                            minTickGap={15}
                          />
                          <YAxis
                            domain={zoomState.yDomain || ["auto", "auto"]}
                            allowDataOverflow
                            tick={{ fontSize: 9 }}
                            tickFormatter={(val: number) => val.toFixed(0)}
                            width={35}
                          />
                          <Line
                            type="monotone"
                            dataKey="close"
                            stroke="#f7931a"
                            strokeWidth={2}
                            dot={false}
                            activeDot={{ r: 6 }}
                            isAnimationActive
                            animationBegin={0}
                            animationDuration={2000}
                            animationEasing="ease-in-out"
                          />
                          <Tooltip
                            content={({ active, payload }) => {
                              if (active && payload && payload.length) {
                                const data = payload[0].payload;
                                const timestamp = data.timestamp * 1000;
                                const date = new Date(timestamp);
                                const formattedDate = date.toLocaleDateString(
                                  "en-US",
                                  {
                                    month: "short",
                                    day: "numeric",
                                    year: "numeric",
                                  }
                                );
                                const formattedTime = date.toLocaleTimeString(
                                  "en-US",
                                  {
                                    hour: "2-digit",
                                    minute: "2-digit",
                                  }
                                );
                                let priceChangePercent = null;
                                const currentChartData =
                                  zoomState.isZoomed && minuteData.length > 0
                                    ? minuteData
                                    : chartData;
                                const dataIndex = currentChartData.findIndex(
                                  (item) => item.timestamp === data.timestamp
                                );
                                if (
                                  dataIndex > 0 &&
                                  currentChartData[dataIndex - 1]
                                ) {
                                  const prevClose =
                                    currentChartData[dataIndex - 1].close;
                                  const currentClose = data.close;
                                  priceChangePercent =
                                    ((currentClose - prevClose) / prevClose) *
                                    100;
                                }
                                return (
                                  <div className="bg-background/95 backdrop-blur-sm border rounded shadow-lg p-3 text-xs">
                                    <div className="font-bold mb-1 text-sm">
                                      {selectedCurrency}/USD
                                    </div>
                                    <div className="text-muted-foreground mb-2">
                                      {formattedDate} at {formattedTime}
                                    </div>
                                    <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                                      <div>Price:</div>
                                      <div className="text-right font-medium">
                                        {formatCurrency(data.close)}
                                      </div>
                                      {data.open !== undefined && (
                                        <>
                                          <div>Open:</div>
                                          <div className="text-right">
                                            {formatCurrency(data.open)}
                                          </div>
                                        </>
                                      )}
                                      {data.high !== undefined && (
                                        <>
                                          <div>High:</div>
                                          <div className="text-right">
                                            {formatCurrency(data.high)}
                                          </div>
                                        </>
                                      )}
                                      {data.low !== undefined && (
                                        <>
                                          <div>Low:</div>
                                          <div className="text-right">
                                            {formatCurrency(data.low)}
                                          </div>
                                        </>
                                      )}
                                      {priceChangePercent !== null && (
                                        <>
                                          <div>Change:</div>
                                          <div
                                            className={`text-right ${
                                              priceChangePercent >= 0
                                                ? "text-green-600"
                                                : "text-red-600"
                                            }`}
                                          >
                                            {priceChangePercent >= 0 ? "+" : ""}
                                            {priceChangePercent.toFixed(2)}%
                                          </div>
                                        </>
                                      )}
                                      {data.volume !== undefined && (
                                        <>
                                          <div>Volume:</div>
                                          <div className="text-right">
                                            {formatCurrency(data.volume, true)}
                                          </div>
                                        </>
                                      )}
                                      {data.isMinuteData && (
                                        <div className="col-span-2 mt-1 text-[10px] text-muted-foreground">
                                          Minute resolution data
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                );
                              }
                              return null;
                            }}
                          />
                          {isLoadingMinuteData && (
                            <text
                              x="50%"
                              y="50%"
                              textAnchor="middle"
                              fill="currentColor"
                              dy=".3em"
                              fontSize="14"
                              fontWeight="bold"
                            >
                              Loading minute data...
                            </text>
                          )}
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </CardContent>
                  <CardFooter className="border-t p-2 sm:p-4">
                    <div className="w-full">
                      <p className="text-[10px] sm:text-xs text-muted-foreground mb-1 sm:mb-2">
                        Data from Binance & CoinGecko API; live updates from
                        Binance WebSocket.
                      </p>
                    </div>
                  </CardFooter>
                </Card>
              )}
            </div>
            {/* Top Cryptocurrencies */}
            <div className="lg:col-span-1 lg:col-start-3">
              <Card className="h-full">
                <CardHeader className="p-3 sm:p-4 pb-0">
                  <CardTitle className="text-base sm:text-lg">
                    Top 10 Cryptocurrencies
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="overflow-auto max-h-[450px] sm:max-h-[450px]">
                    <Table className="w-full">
                      <TableCaption className="text-[10px] sm:text-xs">
                        Updated in real-time via WebSocket
                      </TableCaption>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-[60px] text-xs">
                            Symbol
                          </TableHead>
                          <TableHead className="text-right text-xs">
                            Price
                          </TableHead>
                          <TableHead className="text-right text-xs hidden sm:table-cell">
                            Market Cap
                          </TableHead>
                          <TableHead className="text-right text-xs">
                            24h
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {isLoadingCurrencies ? (
                          <TableRow>
                            <TableCell
                              colSpan={4}
                              className="text-center text-xs"
                            >
                              <InlineLoading
                                message="Loading market data..."
                                size="sm"
                              />
                            </TableCell>
                          </TableRow>
                        ) : (
                          topCurrencies.map((currency) => (
                            <TableRow
                              key={currency.symbol}
                              className={cn(
                                "cursor-pointer hover:bg-muted/50 transition-colors",
                                selectedCurrency === currency.symbol &&
                                  "bg-muted/30"
                              )}
                              onClick={() =>
                                handleCurrencySelect(currency.symbol)
                              }
                            >
                              <TableCell className="font-medium text-xs py-2">
                                {currency.symbol}
                              </TableCell>
                              <TableCell className="text-right text-xs py-2">
                                {formatCurrency(currency.price)}
                              </TableCell>
                              <TableCell className="text-right text-xs py-2 hidden sm:table-cell">
                                {formatCurrency(currency.marketCap, true)}
                              </TableCell>
                              <TableCell className="text-right text-xs py-2">
                                <div className="flex items-center justify-end gap-1">
                                  {currency.change24h > 0 ? (
                                    <ArrowUp className="h-3 w-3 text-green-500" />
                                  ) : (
                                    <ArrowDown className="h-3 w-3 text-red-400" />
                                  )}
                                  <Badge
                                    variant={
                                      currency.change24h > 0
                                        ? "success"
                                        : "destructive"
                                    }
                                    className={cn(
                                      "text-[10px] px-1 py-0",
                                      currency.change24h < 0 &&
                                        "bg-red-500/10 text-red-400 dark:text-red-400 dark:bg-red-500/20"
                                    )}
                                  >
                                    {Math.abs(currency.change24h).toFixed(1)}%
                                  </Badge>
                                </div>
                              </TableCell>
                            </TableRow>
                          ))
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
          {/* Row 3: Quick Trade, Recent Trades, Bot Roadmap, News/Tips */}
          <div
            className={cn(
              "grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6 mt-4",
              isMobile && "mobile-section-padding"
            )}
          >
            {/* LEFT COLUMN: Quick Trade + Roadmap */}
            <div className="flex flex-col gap-4">
              <Card>
                <CardHeader className="p-3 sm:p-4 pb-0">
                  <CardTitle className="text-base sm:text-lg">
                    Quick Trade
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-3 sm:p-4">
                  <p className="text-xs sm:text-sm mb-2">
                    For simplicity, a novice can instantly buy/sell currently
                    selected currency.
                  </p>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <Button className="w-full sm:w-auto" variant="default">
                      Buy 0.01 {selectedCurrency}
                    </Button>
                    <Button className="w-full sm:w-auto" variant="destructive">
                      Sell 0.01 {selectedCurrency}
                    </Button>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="p-3 sm:p-4 pb-0">
                  <CardTitle className="text-base sm:text-lg">
                    Bot Roadmap
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <Table className="w-full">
                      <TableHeader>
                        <TableRow>
                          <TableHead className="text-xs whitespace-nowrap"></TableHead>
                          <TableHead className="text-xs">Plan</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {botRoadmap.length === 0 ? (
                          <TableRow>
                            <TableCell
                              colSpan={2}
                              className="text-center text-xs py-2"
                            >
                              No upcoming actions
                            </TableCell>
                          </TableRow>
                        ) : (
                          botRoadmap.map((action) => (
                            <TableRow key={action.id}>
                              <TableCell className="text-xs py-2">
                                {action.date}
                              </TableCell>
                              <TableCell className="text-xs py-2">
                                {action.plan}
                              </TableCell>
                            </TableRow>
                          ))
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            </div>
            {/* RIGHT COLUMN: Recent Trades + News/Tips */}
            <div className="flex flex-col gap-4">
              <Card>
                <CardHeader className="p-3 sm:p-4 pb-0">
                  <CardTitle className="text-base sm:text-lg">
                    Recent Trades
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <Table className="w-full">
                      <TableHeader>
                        <TableRow>
                          <TableHead className="text-xs whitespace-nowrap">
                            Time
                          </TableHead>
                          <TableHead className="text-xs whitespace-nowrap">
                            Action
                          </TableHead>
                          <TableHead className="text-xs text-right whitespace-nowrap">
                            Amount
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {recentTrades.length === 0 ? (
                          <TableRow>
                            <TableCell
                              colSpan={5}
                              className="text-center text-xs py-2"
                            >
                              No recent trades
                            </TableCell>
                          </TableRow>
                        ) : (
                          recentTrades.map((trade) => (
                            <TableRow key={trade.id}>
                              <TableCell className="text-xs py-2">
                                <span
                                  className={
                                    trade.type === "BUY"
                                      ? "text-green-600"
                                      : "text-red-600"
                                  }
                                >
                                  {trade.type}
                                </span>
                              </TableCell>
                              <TableCell className="text-xs py-2">
                                {trade.symbol}
                              </TableCell>
                              <TableCell className="text-right text-xs py-2">
                                {trade.amount}
                              </TableCell>
                              <TableCell className="text-right text-xs py-2">
                                {formatCurrency(trade.price)}
                              </TableCell>
                              <TableCell className="text-right text-xs py-2">
                                {trade.timestamp}
                              </TableCell>
                            </TableRow>
                          ))
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="p-3 sm:p-4 pb-0">
                  <CardTitle className="text-base sm:text-lg">
                    News & Tips
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-3 sm:p-4">
                  {loadingNews ? (
                    <div className="flex justify-center items-center h-[100px]">
                      <p className="text-sm text-muted-foreground">
                        Loading news...
                      </p>
                    </div>
                  ) : newsItems.length === 0 ? (
                    <p className="text-xs">No news items available</p>
                  ) : (
                    <div className="h-[250px] sm:h-[300px] overflow-y-auto pr-1 scrollbar-thin">
                      <ul className="list-none text-xs sm:text-sm space-y-4">
                        {newsItems.map((item) => (
                          <li
                            key={item.id}
                            className="border-b pb-3 last:border-b-0"
                          >
                            <div className="flex gap-2">
                              {item.imageUrl && (
                                <div className="hidden sm:block flex-shrink-0">
                                  <img
                                    src={item.imageUrl}
                                    alt={item.title}
                                    className="h-12 w-12 rounded object-cover"
                                  />
                                </div>
                              )}
                              <div>
                                <a
                                  href={item.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="font-semibold mb-1 hover:text-primary transition-colors"
                                >
                                  {item.title}
                                </a>
                                <p className="text-muted-foreground text-xs mt-1">
                                  {item.snippet}
                                </p>
                                <div className="text-[10px] text-muted-foreground mt-1">
                                  {item.source} · {item.publishedAt}
                                </div>
                              </div>
                            </div>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
        {/* Footer / Disclaimer */}
        <div
          className={cn(
            "mt-6 text-xs text-muted-foreground",
            isMobile && "mobile-footer"
          )}
        >
          <p>
            Disclaimer: This is a paper-trading bot dashboard for demonstration
            only. It does not constitute financial advice. Always do your own
            research.
          </p>
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
