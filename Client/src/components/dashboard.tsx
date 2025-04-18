"use client";
import {
  ChevronDown,
  RefreshCw,
  ArrowUp,
  ArrowDown,
  Settings,
  AlertTriangle,
  Loader2,
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
import { Progress } from "@/components/ui/progress";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { config } from "@/lib/config";
import { AppSidebar } from "@/components/app-sidebar";
import {
  SidebarProvider,
  SidebarInset,
  SidebarRail,
} from "@/components/ui/sidebar";
import { PortfolioChart } from "@/components/portfolio-chart";
import { TradeHistory } from "@/components/trade-history";
import { BotControl } from "@/components/bot-control";
import { QuickTrade } from "@/components/quick-trade";
import { Positions } from "@/components/positions";
import { BotRoadmap } from "@/components/bot-roadmap";
import { AxiosError } from "axios";

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

  const [cryptoData, setCryptoData] = useState<CryptoInfo | null>(null);
  const [chartData, setChartData] = useState<KlineData[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [wsConnected, setWsConnected] = useState<boolean>(false);
  const [lastUpdated, setLastUpdated] = useState<string>("");

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

  // On mount, fill in some placeholder trades
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
    const ws = new WebSocket(WS_ENDPOINT);
    wsRef.current = ws;
    ws.onopen = () => {
      console.log("WebSocket connected");
      setWsConnected(true);
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
    };
    ws.onclose = (e) => {
      setWsConnected(false);
      if (e.code !== 1000 && e.code !== 1001) {
        console.log(
          "WebSocket disconnected, attempting to reconnect in 5 seconds..."
        );
        setTimeout(connectWebSocketAll, 5000);
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
    <SidebarProvider defaultOpen={true}>
      <AppSidebar />
      <SidebarInset>
        <SidebarRail className="absolute top-4.5 left-4" />
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
          className="w-full max-w-7xl mx-auto p-2 sm:p-4 overflow-hidden no-scrollbar"
          style={{ maxWidth: "100%" }}
        >
          {/* Header */}
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-4 sm:mb-6">
            <div className="pl-10">
              <h1 className="text-3xl font-bold crypto-dashboard-title">
                Crypto Pilot Dashboard
              </h1>
            </div>
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 sm:gap-4 w-full sm:w-auto">
              <div className="flex items-center gap-2">
                <div className="text-xs sm:text-sm text-muted-foreground">
                  Last updated: {lastUpdated || "Never"}
                </div>
                <span
                  className={cn(
                    "inline-block w-2 h-2 rounded-full",
                    wsConnected ? "bg-green-500" : "bg-red-500"
                  )}
                />
                <span className="text-xs sm:text-sm">
                  {wsConnected ? "Connected" : "Disconnected"}
                </span>
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
          {error && (
            <Card className="mb-4 sm:mb-6 border-red-500">
              <CardContent className="p-2 sm:p-4 text-red-500 text-sm">
                {error}
              </CardContent>
            </Card>
          )}
          {/* Row 1: Portfolio & Bot */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6 mb-4 sm:mb-6">
            {/* Portfolio Overview */}
            <Card className="lg:col-span-1">
              <CardHeader className="p-3 sm:p-4 pb-0">
                <CardTitle className="text-base sm:text-lg">
                  Portfolio Overview
                  <p className="mb-2 text-muted-foreground">
                    {isNewUser
                      ? `Welcome, ${user?.name || "Trader"}!`
                      : `Welcome back, ${user?.name || "Trader"}!`}
                  </p>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-3 sm:p-4">
                {portfolioLoading ? (
                  <div className="flex justify-center items-center h-24">
                    <Loader2 className="h-6 w-6 animate-spin" />
                  </div>
                ) : (
                  <div className="text-sm sm:text-base">
                    <p>
                      <strong>Balance:</strong>{" "}
                      {formatCurrency(portfolioData?.paperBalance || 0)}
                    </p>
                    <p>
                      <strong>Overall P/L:</strong>{" "}
                      <span
                        className={
                          (portfolioData?.profitLossPercentage || 0) >= 0
                            ? "text-green-600"
                            : "text-red-600"
                        }
                      >
                        {(portfolioData?.profitLossPercentage || 0) >= 0
                          ? "+"
                          : "-"}
                        {Math.abs(
                          portfolioData?.profitLossPercentage || 0
                        ).toFixed(2)}
                        %
                      </span>
                    </p>
                    <div className="mt-2">
                      <strong>Open Positions:</strong>
                      {positions.length === 0 ? (
                        <p className="ml-4 mt-1 text-muted-foreground">
                          No positions held
                        </p>
                      ) : (
                        <ul className="list-disc ml-4 mt-1">
                          {openPositions.map((pos: SimplePosition) => (
                            <li key={pos.symbol}>
                              {pos.symbol}: {pos.amount.toFixed(6)}
                            </li>
                          ))}
                        </ul>
                      )}
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
                <div className="space-y-3">
                  <div className="flex items-center">
                    <div className="flex items-center gap-2">
                      <div
                        className={cn(
                          "h-3 w-3 rounded-full",
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
                  </div>
                  <div>
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
                          className="mt-1 w-full flex justify-between items-center"
                        >
                          {botStrategy || "Select strategy"}
                          <ChevronDown className="h-4 w-4 opacity-50" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent
                        align="start"
                        className="w-[500px] h-auto"
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
                  <div className="pt-2">
                    <p className="text-sm font-medium mb-2">Bot Performance</p>
                    <div className="space-y-2">
                      <div>
                        <div className="flex justify-between text-xs mb-1">
                          <span>Success Rate</span>
                          <span className="font-medium">{botSuccessRate}%</span>
                        </div>
                        <Progress value={botSuccessRate} className="h-1.5" />
                      </div>
                      <div>
                        <div className="flex justify-between text-xs mb-1">
                          <span>Avg. Trades/Day</span>
                          <span className="font-medium">{botTradesPerDay}</span>
                        </div>
                        <Progress
                          value={botTradesPerDay * 5}
                          className="h-1.5"
                        />
                      </div>
                    </div>
                  </div>
                  {botShowAdvanced && (
                    <div className="pt-2 border-t">
                      <p className="text-sm font-medium mb-2">
                        Advanced Settings
                      </p>
                      <div className="space-y-4">
                        <div>
                          <div className="flex justify-between items-center mb-1">
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
                            <div className="flex items-center mt-1 text-amber-600 text-[10px] gap-1">
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
                            <span className="text-[10px] text-muted-foreground">
                              Maintains target allocation
                            </span>
                          </div>
                          <div
                            className="relative inline-flex h-[24px] w-[44px] shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out"
                            data-state={
                              botAutoRebalance ? "checked" : "unchecked"
                            }
                            onClick={() => setBotAutoRebalance((prev) => !prev)}
                          >
                            <span
                              className="pointer-events-none block h-5 w-5 rounded-full bg-background shadow-lg transition-transform duration-200 ease-in-out"
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
                            <span className="text-[10px] text-muted-foreground">
                              Dollar-cost averaging
                            </span>
                          </div>
                          <div
                            className="relative inline-flex h-[24px] w-[44px] shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out"
                            data-state={botDCAEnabled ? "checked" : "unchecked"}
                            onClick={() => setBotDCAEnabled((prev) => !prev)}
                          >
                            <span
                              className="pointer-events-none block h-5 w-5 rounded-full bg-background shadow-lg transition-transform duration-200 ease-in-out"
                              data-state={
                                botDCAEnabled ? "checked" : "unchecked"
                              }
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                  <div className="pt-3">
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
            {/* Portfolio Value Chart */}
            <Card className="lg:col-span-1">
              <CardHeader className="p-3 sm:p-4 pb-0">
                <div className="flex justify-between items-center">
                  <CardTitle className="text-base sm:text-lg">
                    Portfolio Value
                  </CardTitle>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="outline"
                        className="h-8 w-[120px] flex justify-between items-center"
                      >
                        {portfolioDateRange}
                        <ChevronDown className="h-4 w-4 opacity-50" />
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
              </CardHeader>
              <CardContent className="p-3 sm:p-4 flex justify-center">
                <div style={{ width: "100%", height: 200 }}>
                  {portfolioChartLoading ? (
                    <div className="flex items-center justify-center h-full">
                      <p className="text-sm text-muted-foreground">
                        Loading chart data...
                      </p>
                    </div>
                  ) : (
                    <PortfolioChart
                      data={portfolioHistory}
                      timeframe={
                        portfolioDateRange as "24h" | "1w" | "1m" | "1y" | "all"
                      }
                    />
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
          {/* Row 2: Ticker/Chart & Top Crypto */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 sm:gap-4">
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
                              Loading...
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
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6 mt-4">
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
        <div className="mt-6 text-xs text-muted-foreground">
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
