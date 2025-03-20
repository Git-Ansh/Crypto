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
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";
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
//import { config } from "@/lib/config";
import { AppSidebar } from "@/components/app-sidebar";
import {
  SidebarProvider,
  SidebarInset,
  SidebarRail,
} from "@/components/ui/sidebar";
import { PortfolioChart } from "@/components/portfolio-chart";
//import { AxiosError } from "axios";

// ================== BITSTAMP ENDPOINTS ==================
const BITSTAMP_REST_API = "https://www.bitstamp.net/api/v2";
const BITSTAMP_WS_ENDPOINT = "wss://ws.bitstamp.net";

// Updated endpoints for different data types using Bitstamp public API
const TICKER_ENDPOINT = `${BITSTAMP_REST_API}/ticker`;
const OHLC_ENDPOINT = `${BITSTAMP_REST_API}/ohlc`;
const TRANSACTIONS_ENDPOINT = `${BITSTAMP_REST_API}/transactions`;

// For top currencies we’ll fetch them individually. The currency pair will be defined as e.g. "btcusd"
const TOP_CURRENCIES = [
  "btcusd",
  "ethusd",
  "xrpusd",
  "ltcusd",
  "bchusd",
  "adausd",
  "solusd",
  "dotusd",
  "linkusd",
  "maticusd",
];

// WebSocket subscription message format for Bitstamp
const createSubscriptionMessage = (channel: string, symbol: string) => ({
  event: "bts:subscribe",
  data: {
    channel: `${channel}_${symbol}`,
  },
});

const BATCH_THRESHOLD = 5;
const BATCH_WINDOW = 2000;
const MAX_CHART_POINTS = 1000;
const HOUR_IN_MS = 60 * 60 * 1000;
const UPDATE_INTERVAL_MS = 2000; // 2 seconds

// ================== INTERFACES ==================
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

interface SimplePosition {
  symbol: string;
  amount: number;
}

// Add a new interface to track multiple WebSocket connections
interface WebSocketConnection {
  ws: WebSocket;
  symbol: string;
  interval: NodeJS.Timeout | null;
}

// ================== DASHBOARD COMPONENT ==================
export default function Dashboard() {
  const navigate = useNavigate();
  const { user, logout, loading: authLoading } = useAuth();

  // State variables
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

  // Refs for WebSocket and batching
  const wsRef = useRef<WebSocket | null>(null);
  const messageCountRef = useRef<number>(0);
  const batchTimerRef = useRef<NodeJS.Timeout | null>(null);
  const priceBufferRef = useRef<number | null>(null);
  const lastChartUpdateRef = useRef<number>(Date.now());
  const wsIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttemptsRef = useRef<number>(0);
  const reconnectTimerRef = useRef<NodeJS.Timeout | null>(null);
  const socketManagerRef = useRef<{
    isConnecting: boolean;
    activeSymbol: string | null;
    pendingSymbol: string | null;
  }>({
    isConnecting: false,
    activeSymbol: null,
    pendingSymbol: null,
  });

  // Add a new ref to track all WebSocket connections
  const wsConnectionsRef = useRef<Record<string, WebSocketConnection>>({});

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

  // Minute data for zoomed chart view
  const [minuteData, setMinuteData] = useState<KlineData[]>([]);
  const [isLoadingMinuteData, setIsLoadingMinuteData] =
    useState<boolean>(false);
  const [minuteDataRange, setMinuteDataRange] = useState<{
    start: number;
    end: number;
  } | null>(null);

  // Top currencies state (for the table)
  const [topCurrencies, setTopCurrencies] = useState<CurrencyData[]>([]);
  const [isLoadingCurrencies, setIsLoadingCurrencies] = useState<boolean>(true);

  // Selected currency state
  const [selectedCurrency, setSelectedCurrency] = useState<string>("BTC");
  const [selectedCurrencyName, setSelectedCurrencyName] =
    useState<string>("Bitcoin");

  // Other feature states (portfolio, positions, trades, bot, news)
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

  const [openPositions, setOpenPositions] = useState<SimplePosition[]>([
    { symbol: "BTC", amount: 0.05 },
    { symbol: "ETH", amount: 0.8 },
  ]);

  const [recentTrades, setRecentTrades] = useState<any[]>([]);
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

  const [newsItems, setNewsItems] = useState<any[]>([]);
  const [loadingNews, setLoadingNews] = useState<boolean>(true);

  const [trades, setTrades] = useState<Trade[]>([]);
  const [botConfig, setBotConfig] = useState<any>(null);
  const [timeframe, setTimeframe] = useState<
    "24h" | "1w" | "1m" | "1y" | "all"
  >("1m");
  const [accountCreationDate, setAccountCreationDate] = useState<string | null>(
    null
  );

  // ================== FETCH FUNCTIONS ==================

  // Fetch ticker data for a given currency from Bitstamp
  const fetchTickerDataForCurrency = useCallback(
    async (symbol: string): Promise<CryptoInfo> => {
      try {
        const bitstampSymbol = `${symbol.toLowerCase()}usd`;
        const resp = await axios.get(`${TICKER_ENDPOINT}/${bitstampSymbol}`);
        if (!resp.data || resp.data.last === undefined) {
          throw new Error(`No ticker data found for ${symbol}`);
        }
        return { price: parseFloat(resp.data.last) };
      } catch (err: any) {
        console.error(`Error fetching ticker data for ${symbol}:`, err);
        throw new Error(`Failed to load current price for ${symbol}`);
      }
    },
    []
  );

  // Fetch historical OHLC data for chart (1-hour resolution for the last 24 hours)
  const fetchHistoricalDataForCurrency = useCallback(
    async (symbol: string): Promise<KlineData[]> => {
      try {
        const bitstampSymbol = `${symbol.toLowerCase()}usd`;
        const params = {
          step: 3600, // 1 hour in seconds
          limit: 24, // Last 24 hours
        };
        const resp = await axios.get(`${OHLC_ENDPOINT}/${bitstampSymbol}`, {
          params,
        });
        if (!resp.data || !resp.data.data || !resp.data.data.ohlc) {
          throw new Error(`No historical data found for ${symbol}`);
        }
        const dataArray = resp.data.data.ohlc;
        return dataArray.map((item: any) => ({
          time: new Date(item.timestamp * 1000).toLocaleTimeString(),
          close: parseFloat(item.close),
          timestamp: item.timestamp * 1000,
          open: parseFloat(item.open),
          high: parseFloat(item.high),
          low: parseFloat(item.low),
          volume: parseFloat(item.volume),
        }));
      } catch (err: any) {
        console.error(`Error fetching historical data for ${symbol}:`, err);
        throw new Error(`Failed to load historical data for ${symbol}`);
      }
    },
    []
  );

  // Fetch minute data (1-minute resolution) – similar to the above function
  const fetchMinuteDataForCurrency = useCallback(
    async (
      symbol: string,
      startTime: number,
      endTime: number
    ): Promise<KlineData[]> => {
      try {
        setIsLoadingMinuteData(true);
        const bitstampSymbol = `${symbol.toLowerCase()}usd`;
        const params = {
          step: 60,
          limit: 1000,
          start: Math.floor(startTime / 1000),
          end: Math.floor(endTime / 1000),
        };
        const resp = await axios.get(`${OHLC_ENDPOINT}/${bitstampSymbol}`, {
          params,
        });
        if (!resp.data || !resp.data.data || !resp.data.data.ohlc) {
          throw new Error(`No minute data found for ${symbol}`);
        }
        const dataArray = resp.data.data.ohlc;
        const minuteData = dataArray.map((item: any) => ({
          time: new Date(item.timestamp * 1000).toLocaleTimeString(),
          close: parseFloat(item.close),
          timestamp: item.timestamp * 1000,
          open: parseFloat(item.open),
          high: parseFloat(item.high),
          low: parseFloat(item.low),
          volume: parseFloat(item.volume),
          isMinuteData: true,
        }));
        setIsLoadingMinuteData(false);
        return minuteData;
      } catch (err: any) {
        console.error(`Error fetching minute data for ${symbol}:`, err);
        setIsLoadingMinuteData(false);
        throw new Error(`Failed to load minute data for ${symbol}`);
      }
    },
    []
  );

  // Fetch top currencies data by fetching ticker info for each pair
  const fetchTopCurrencies = useCallback(async () => {
    try {
      setIsLoadingCurrencies(true);
      const promises = TOP_CURRENCIES.map(async (pair) => {
        try {
          const resp = await axios.get(`${TICKER_ENDPOINT}/${pair}`);
          if (!resp.data) {
            throw new Error(
              `Invalid data format from Bitstamp API for ${pair}`
            );
          }
          const currencySymbol = pair.replace("usd", "").toUpperCase();
          return {
            symbol: currencySymbol,
            name: currencySymbol,
            price: parseFloat(resp.data.last),
            volume: parseFloat(resp.data.volume),
            marketCap: 0, // Bitstamp does not provide market cap
            change24h: parseFloat(resp.data.percent_change_24) || 0,
            lastUpdated: Date.now(),
          };
        } catch (err) {
          console.error(`Error fetching data for ${pair}:`, err);
          return null;
        }
      });
      const results = await Promise.all(promises);
      const currencies = results.filter(Boolean) as CurrencyData[];
      setTopCurrencies(currencies);
      setIsLoadingCurrencies(false);
      return true;
    } catch (err: any) {
      console.error("Error fetching top currencies:", err);
      setIsLoadingCurrencies(false);
      return false;
    }
  }, []);

  // ================== WEBSOCKET & BATCHING ==================
  const processBatch = useCallback((currencySymbol: string) => {
    if (priceBufferRef.current !== null) {
      const latestPrice = priceBufferRef.current;
      const now = Date.now();
      setCryptoData((prev) =>
        prev ? { ...prev, price: latestPrice } : { price: latestPrice }
      );

      // Update chart if an hour has passed
      const hourElapsed = now - lastChartUpdateRef.current >= HOUR_IN_MS;
      if (hourElapsed) {
        lastChartUpdateRef.current = now;
        setChartData((prev) => {
          // Chart update logic remains the same
          const newPoint: KlineData = {
            time: new Date(now).toLocaleTimeString(),
            close: latestPrice,
            timestamp: now,
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

    // Reset for next batch
    messageCountRef.current = 0;
    priceBufferRef.current = null;
  }, []);

  const connectWebSocketForCurrency = useCallback(
    (symbol: string, isMainChart: boolean = true) => {
      // If we already have a connection for this symbol, don't create a new one
      if (wsConnectionsRef.current[symbol]) {
        // If this is for the main chart, update the active symbol
        if (isMainChart) {
          socketManagerRef.current.activeSymbol = symbol;
        }
        return;
      }

      // Set up the WebSocket connection
      const bitstampSymbol = `${symbol.toLowerCase()}usd`;

      if (isMainChart) {
        socketManagerRef.current.isConnecting = true;
        socketManagerRef.current.activeSymbol = symbol;

        // Close existing main chart connection if any
        if (wsRef.current) {
          wsRef.current.close();
          wsRef.current = null;
        }

        // Clear main chart interval if any
        if (wsIntervalRef.current) {
          clearInterval(wsIntervalRef.current);
          wsIntervalRef.current = null;
        }
      }

      setTimeout(() => {
        const ws = new WebSocket(BITSTAMP_WS_ENDPOINT);

        // Store in the appropriate ref
        if (isMainChart) {
          wsRef.current = ws;
        }

        // Create a new connection entry
        wsConnectionsRef.current[symbol] = {
          ws,
          symbol,
          interval: null,
        };

        // Set up connection timeout
        const connectionTimeout = setTimeout(() => {
          console.error(`WebSocket connection timeout for ${symbol}`);
          ws.close();
          if (isMainChart) {
            setWsConnected(false);
            socketManagerRef.current.isConnecting = false;
          }
          delete wsConnectionsRef.current[symbol];
        }, 10000);

        ws.onopen = () => {
          console.log(`WebSocket connected successfully for ${symbol}`);
          clearTimeout(connectionTimeout);

          if (isMainChart) {
            setWsConnected(true);
            reconnectAttemptsRef.current = 0;
            socketManagerRef.current.isConnecting = false;
          }

          try {
            // Subscribe to live trades
            const tradeSubscription = createSubscriptionMessage(
              "live_trades",
              bitstampSymbol
            );
            ws.send(JSON.stringify(tradeSubscription));
            console.log(
              `Sent trade subscription for ${symbol}:`,
              tradeSubscription
            );

            // For main chart, also subscribe to order book
            if (isMainChart) {
              const orderBookSubscription = createSubscriptionMessage(
                "order_book",
                bitstampSymbol
              );
              ws.send(JSON.stringify(orderBookSubscription));
              console.log(
                `Sent order book subscription for ${symbol}:`,
                orderBookSubscription
              );

              // Set up interval for regular UI updates for the main chart
              wsIntervalRef.current = setInterval(() => {
                // Only update if we have received price data from WebSocket
                if (priceBufferRef.current !== null) {
                  const latestPrice = priceBufferRef.current;
                  setCryptoData((prev) =>
                    prev
                      ? { ...prev, price: latestPrice }
                      : { price: latestPrice }
                  );

                  // Update chart if needed
                  const now = Date.now();
                  const hourElapsed =
                    now - lastChartUpdateRef.current >= HOUR_IN_MS;
                  if (hourElapsed) {
                    lastChartUpdateRef.current = now;
                    setChartData((prev) => {
                      const newPoint: KlineData = {
                        time: new Date(now).toLocaleTimeString(),
                        close: latestPrice,
                        timestamp: now,
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

                  // Always update timestamp when we update the UI
                  setLastUpdated(new Date().toLocaleTimeString());
                }
              }, UPDATE_INTERVAL_MS) as unknown as NodeJS.Timeout;
            }
          } catch (err) {
            console.error(
              `Error setting up WebSocket subscriptions for ${symbol}:`,
              err
            );
          }
        };

        ws.onmessage = (evt) => {
          try {
            const msg = JSON.parse(evt.data);
            if (msg.event === "trade" && msg.data && msg.data.price) {
              const price = parseFloat(msg.data.price);

              // Update the price buffer for the active symbol
              if (
                symbol.toLowerCase() ===
                socketManagerRef.current.activeSymbol?.toLowerCase()
              ) {
                priceBufferRef.current = price;

                // Also update the cryptoData state directly for immediate UI update
                setCryptoData((prev) =>
                  prev ? { ...prev, price: price } : { price: price }
                );
              }

              // Update top currencies table immediately for any currency
              setTopCurrencies((prev) =>
                prev.map((curr) =>
                  curr.symbol.toLowerCase() === symbol.toLowerCase()
                    ? { ...curr, price: price, lastUpdated: Date.now() }
                    : curr
                )
              );
            }
          } catch (err) {
            console.error(`Error parsing WS message for ${symbol}:`, err);
          }
        };

        ws.onerror = (err) => {
          console.error(`WebSocket error for ${symbol}:`, err);
          if (isMainChart) {
            setWsConnected(false);
            socketManagerRef.current.isConnecting = false;
          }
          delete wsConnectionsRef.current[symbol];
        };

        ws.onclose = (e) => {
          if (isMainChart) {
            setWsConnected(false);
            socketManagerRef.current.isConnecting = false;
          }

          clearTimeout(connectionTimeout);
          console.log(
            `WebSocket closed for ${symbol} with code ${e.code}, reason: ${e.reason}`
          );

          // Clear the connection from our tracking
          delete wsConnectionsRef.current[symbol];

          // Clear the update interval for main chart
          if (isMainChart && wsIntervalRef.current) {
            clearInterval(wsIntervalRef.current);
            wsIntervalRef.current = null;
          }

          // Reconnect logic
          if (e.code !== 1000 && e.code !== 1001) {
            console.log(
              `WebSocket disconnected abnormally for ${symbol} (code: ${e.code}), attempting to reconnect...`
            );
            const reconnectDelay = Math.min(
              30000,
              5000 * Math.pow(1.5, reconnectAttemptsRef.current)
            );
            if (isMainChart) {
              reconnectAttemptsRef.current++;
            }
            console.log(
              `Reconnect attempt for ${symbol} in ${reconnectDelay}ms`
            );
            setTimeout(() => {
              connectWebSocketForCurrency(symbol, isMainChart);
            }, reconnectDelay);
          }
        };
      }, 1000);
    },
    []
  );

  // Add a function to connect WebSockets for all top currencies
  const connectAllCurrencyWebSockets = useCallback(() => {
    TOP_CURRENCIES.forEach((pair) => {
      const symbol = pair.replace("usd", "").toUpperCase();
      connectWebSocketForCurrency(symbol, symbol === selectedCurrency);
    });

    // Set up a global interval to update the UI every 2 seconds
    const globalInterval = setInterval(() => {
      setLastUpdated(new Date().toLocaleTimeString());
    }, UPDATE_INTERVAL_MS);

    return () => clearInterval(globalInterval);
  }, [connectWebSocketForCurrency, selectedCurrency]);

  // Initialize dashboard: load historical data, ticker and connect WebSocket
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
        connectWebSocketForCurrency(symbol);
      } catch (err: any) {
        console.error(`Error initializing for ${symbol}:`, err);
        setError(err?.message || `Failed to load data for ${symbol}`);
        setLoading(false);
      }
    },
    [
      fetchHistoricalDataForCurrency,
      fetchTickerDataForCurrency,
      connectWebSocketForCurrency,
    ]
  );

  // Fetch latest news from a public API (for demonstration)
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

  // Dummy fetch user data (e.g., to get account creation date)
  const fetchUserData = useCallback(async () => {
    try {
      setLoading(true);
      const response = await axios.get("/api/users/profile");
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

  // On mount, load top currencies, initialize dashboard and fetch news & user data
  useEffect(() => {
    // First fetch top currencies
    fetchTopCurrencies().then(() => {
      // Initialize dashboard with default currency (BTC)
      initializeDashboardForCurrency(selectedCurrency);

      // Then connect all WebSockets
      const cleanup = connectAllCurrencyWebSockets();
      return () => {
        cleanup();
        // Close all WebSocket connections
        Object.values(wsConnectionsRef.current).forEach((conn) => {
          if (conn.ws) {
            conn.ws.close();
          }
          if (conn.interval) {
            clearInterval(conn.interval);
          }
        });
        wsConnectionsRef.current = {};

        if (wsRef.current) {
          wsRef.current.close();
          wsRef.current = null;
        }
        if (wsIntervalRef.current) {
          clearInterval(wsIntervalRef.current);
          wsIntervalRef.current = null;
        }
        if (batchTimerRef.current) {
          clearTimeout(batchTimerRef.current);
        }
      };
    });
    fetchLatestNews();
    fetchUserData();
  }, [
    fetchTopCurrencies,
    connectAllCurrencyWebSockets,
    fetchLatestNews,
    fetchUserData,
    initializeDashboardForCurrency,
    selectedCurrency,
  ]);

  // ================== HANDLERS ==================
  const chartContainerRef = useRef<HTMLDivElement>(null);

  const handleResetZoom = useCallback(() => {
    setZoomState({ xDomain: undefined, yDomain: undefined, isZoomed: false });
    setMinuteData([]);
    setMinuteDataRange(null);
  }, []);

  const handleCurrencySelect = useCallback(
    (symbol: string) => {
      // Don't reload the entire dashboard, just update what's needed
      setZoomState({ xDomain: undefined, yDomain: undefined, isZoomed: false });
      setSelectedCurrency(symbol);
      const currencyData = topCurrencies.find((c) => c.symbol === symbol);
      if (currencyData) {
        setSelectedCurrencyName(currencyData.name || symbol);
      }

      // Update the active symbol in the socket manager
      socketManagerRef.current.activeSymbol = symbol;

      // Use existing WebSocket connection or create a new one
      if (wsConnectionsRef.current[symbol]) {
        // Update the main chart WebSocket reference
        wsRef.current = wsConnectionsRef.current[symbol].ws;
      } else {
        // Connect a new WebSocket for this currency
        connectWebSocketForCurrency(symbol, true);
      }

      // Fetch historical data for the new currency
      setLoading(true);
      fetchHistoricalDataForCurrency(symbol)
        .then((data) => {
          setChartData(data);
          setLoading(false);
        })
        .catch((err) => {
          console.error(`Error fetching historical data for ${symbol}:`, err);
          setError(`Failed to load historical data for ${symbol}`);
          setLoading(false);
        });

      // Use the current price from topCurrencies if available
      const currentCurrency = topCurrencies.find((c) => c.symbol === symbol);
      if (currentCurrency) {
        setCryptoData({ price: currentCurrency.price });
      } else {
        // Fallback to fetching the current price
        fetchTickerDataForCurrency(symbol)
          .then((data) => {
            setCryptoData(data);
          })
          .catch((err) => {
            console.error(`Error fetching ticker data for ${symbol}:`, err);
          });
      }
    },
    [
      topCurrencies,
      fetchHistoricalDataForCurrency,
      fetchTickerDataForCurrency,
      connectWebSocketForCurrency,
    ]
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

  // Zoom/Pan handlers for mouse and touch events on the chart
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

  // Dummy portfolio history generator
  const generatePortfolioHistory = useCallback(
    (range: string) => {
      setPortfolioChartLoading(true);
      let dataPoints = 24;
      let startValue = paperBalance * 0.98;
      let volatility = 0.01;
      let startDate = new Date();
      let dateStep = 60 * 60 * 1000;
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

  // Advanced bot settings state
  const [botRiskLevel, setBotRiskLevel] = useState<number>(50);
  const [botTradesPerDay, setBotTradesPerDay] = useState<number>(8);
  const [botSuccessRate, setBotSuccessRate] = useState<number>(67);
  const [botAutoRebalance, setBotAutoRebalance] = useState<boolean>(true);
  const [botDCAEnabled, setBotDCAEnabled] = useState<boolean>(true);
  const [botShowAdvanced, setBotShowAdvanced] = useState<boolean>(false);

  // ================== RENDER ==================
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
                      {portfolioData?.paperBalance
                        ? `$${portfolioData.paperBalance.toFixed(2)}`
                        : "$0.00"}
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
          {/* Row 2: Ticker/Chart & Top Crypto Table */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 sm:gap-4">
            {/* Main Chart */}
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
                              {`$${cryptoData.price.toFixed(2)}`}
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
                                const timestamp = data.timestamp;
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
                                      <div className="text-right font-medium">{`$${data.close.toFixed(
                                        2
                                      )}`}</div>
                                      {data.open !== undefined && (
                                        <>
                                          <div>Open:</div>
                                          <div className="text-right">{`$${data.open.toFixed(
                                            2
                                          )}`}</div>
                                        </>
                                      )}
                                      {data.high !== undefined && (
                                        <>
                                          <div>High:</div>
                                          <div className="text-right">{`$${data.high.toFixed(
                                            2
                                          )}`}</div>
                                        </>
                                      )}
                                      {data.low !== undefined && (
                                        <>
                                          <div>Low:</div>
                                          <div className="text-right">{`$${data.low.toFixed(
                                            2
                                          )}`}</div>
                                        </>
                                      )}
                                      {priceChangePercent !== null && (
                                        <>
                                          <div>Change:</div>
                                          <div
                                            className={cn(
                                              "text-right",
                                              priceChangePercent >= 0
                                                ? "text-green-600"
                                                : "text-red-600"
                                            )}
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
                                            {data.volume.toFixed(2)}
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
                        Data from Bitstamp public API; live updates via
                        WebSocket.
                      </p>
                    </div>
                  </CardFooter>
                </Card>
              )}
            </div>
            {/* Top Cryptocurrencies Table */}
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
                        Updated in real-time via Bitstamp WebSocket
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
                              <TableCell className="text-right text-xs py-2">{`$${currency.price.toFixed(
                                2
                              )}`}</TableCell>
                              <TableCell className="text-right text-xs py-2 hidden sm:table-cell">
                                {currency.marketCap
                                  ? `$${currency.marketCap.toFixed(2)}`
                                  : "-"}
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
                                        "bg-red-500/10 text-red-400"
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
                    For simplicity, a novice can instantly buy/sell the
                    currently selected currency.
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
                              <TableCell className="text-right text-xs py-2">{`$${trade.price.toFixed(
                                2
                              )}`}</TableCell>
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
          {/* Footer / Disclaimer */}
          <div className="mt-6 text-xs text-muted-foreground">
            <p>
              Disclaimer: This is a paper-trading bot dashboard for
              demonstration only. It does not constitute financial advice.
              Always do your own research.
            </p>
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
