"use client";

import { useState, useEffect, useRef, useCallback, TouchEvent } from "react";
import axios from "axios";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardFooter,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ModeToggle } from "@/components/mode-toggle";
import { RefreshCw, ArrowUp, ArrowDown } from "lucide-react";
import { cn } from "@/lib/utils";

// Table & Badge
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

// ================== CONFIG ENDPOINTS ==================
const HISTORICAL_ENDPOINT =
  "https://data-api.coindesk.com/index/cc/v1/historical/hours";
const CURRENT_PRICE_ENDPOINT =
  "https://data-api.coindesk.com/index/cc/v1/latest/tick?market=cadli&instruments=BTC-USD&apply_mapping=true";
const MINUTE_DATA_ENDPOINT =
  "https://data-api.coindesk.com/index/cc/v1/historical/minutes";
const WS_ENDPOINT = "wss://data-streamer.cryptocompare.com";

const MULTI_SUBSCRIBE_MESSAGE = {
  action: "SUBSCRIBE",
  type: "index_cc_v1_latest_tick",
  market: "cadli",
  instruments: [
    "BTC-USD",
    "ETH-USD",
    "XRP-USD",
    "BNB-USD",
    "ADA-USD",
    "SOL-USD",
    "DOGE-USD",
    "DOT-USD",
    "AVAX-USD",
    "MATIC-USD",
    "LINK-USD",
    "SHIB-USD",
  ],
  groups: ["VALUE", "CURRENT_HOUR"],
};

const TOP_CURRENCIES_ENDPOINT =
  "https://min-api.cryptocompare.com/data/pricemultifull?fsyms=BTC,ETH,XRP,BNB,ADA,SOL,DOGE,DOT,AVAX,MATIC,LINK,SHIB&tsyms=USD";

const BATCH_THRESHOLD = 5;
const BATCH_WINDOW = 2000;
const MAX_CHART_POINTS = 1000;
const HOUR_IN_MS = 60 * 60 * 1000;

// ================== TYPES ==================
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

// ------------------ Dashboard Component ------------------
export default function Dashboard() {
  // -------- Existing States --------
  const [cryptoData, setCryptoData] = useState<CryptoInfo | null>(null);
  const [chartData, setChartData] = useState<KlineData[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [wsConnected, setWsConnected] = useState<boolean>(false);
  const [lastUpdated, setLastUpdated] = useState<string>("");

  const wsRef = useRef<WebSocket | null>(null);
  const messageCountRef = useRef<number>(0);
  const batchTimerRef = useRef<number | null>(null);
  const priceBufferRef = useRef<number | null>(null);
  const lastChartUpdateRef = useRef<number>(Date.now());

  // Zoom/Pan states
  const [zoomState, setZoomState] = useState<{
    xDomain?: [number, number];
    yDomain?: [number, number];
    isZoomed: boolean;
  }>({
    xDomain: undefined,
    yDomain: undefined,
    isZoomed: false,
  });

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
    initialDomains: {
      x: [0, 0],
      y: [0, 0],
      centerX: 0,
      centerY: 0,
    },
  });

  const [panState, setPanState] = useState<{
    isPanning: boolean;
    lastMouseX: number;
    lastMouseY: number;
  }>({
    isPanning: false,
    lastMouseX: 0,
    lastMouseY: 0,
  });

  // Minute-level data
  const [minuteData, setMinuteData] = useState<KlineData[]>([]);
  const [isLoadingMinuteData, setIsLoadingMinuteData] =
    useState<boolean>(false);
  const [minuteDataRange, setMinuteDataRange] = useState<{
    start: number;
    end: number;
  } | null>(null);

  const minuteDataThreshold = 12;

  // Top currencies
  const [topCurrencies, setTopCurrencies] = useState<CurrencyData[]>([]);
  const [isLoadingCurrencies, setIsLoadingCurrencies] = useState<boolean>(true);

  // Selected currency
  const [selectedCurrency, setSelectedCurrency] = useState<string>("BTC");
  const [selectedCurrencyName, setSelectedCurrencyName] =
    useState<string>("Bitcoin");

  // -------- New Feature States (Placeholders) --------
  const [portfolioBalance, setPortfolioBalance] = useState<number>(12345.67);
  const [portfolioProfitLoss, setPortfolioProfitLoss] = useState<number>(12.3); // 12.3% overall gain
  const [openPositions, setOpenPositions] = useState([
    { symbol: "BTC", amount: 0.05 },
    { symbol: "ETH", amount: 0.8 },
  ]);

  const [botActive, setBotActive] = useState<boolean>(true);
  const [botStrategy, setBotStrategy] = useState<string>("Aggressive Growth");

  // A few sample recent trades
  const [recentTrades, setRecentTrades] = useState<any[]>([]);

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

  // ------------------ Helpers ------------------
  function formatCurrency(num: number, abbreviated: boolean = false): string {
    // Abbreviated for large numbers
    if (abbreviated && num > 1000000) {
      return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        notation: "compact",
        compactDisplay: "short",
        maximumFractionDigits: 2,
      }).format(num);
    }

    // Regular price
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

  // ------------- Top Currencies -------------
  const fetchTopCurrencies = useCallback(async () => {
    try {
      setIsLoadingCurrencies(true);
      const resp = await axios.get(TOP_CURRENCIES_ENDPOINT);

      if (!resp.data || !resp.data.RAW) {
        throw new Error("Invalid data format from CryptoCompare API");
      }

      const rawData = resp.data.RAW;
      const currencies: CurrencyData[] = [];

      Object.keys(rawData).forEach((symbol) => {
        const usdData = rawData[symbol].USD;
        currencies.push({
          symbol,
          name: symbol, // or fetch the full name if you prefer
          price: usdData.PRICE,
          volume: usdData.VOLUME24HOUR,
          marketCap: usdData.MKTCAP,
          change24h: usdData.CHANGEPCT24HOUR,
          lastUpdated: Date.now(),
        });
      });

      // Sort by market cap (descending) and take top 10
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

  // ------------- Historical & Ticker Data -------------
  const fetchHistoricalDataForCurrency = useCallback(
    async (symbol: string): Promise<KlineData[]> => {
      try {
        const params = {
          market: "cadli",
          instrument: `${symbol}-USD`,
          limit: 24,
          aggregate: 1,
          fill: "true",
          apply_mapping: "true",
          response_format: "JSON",
        };
        const resp = await axios.get<HistoricalResponse>(HISTORICAL_ENDPOINT, {
          params,
        });

        if (resp.data.Err && Object.keys(resp.data.Err).length > 0) {
          throw new Error(
            "Historical API Error: " + JSON.stringify(resp.data.Err)
          );
        }

        const dataArray = resp.data.Data;
        if (!Array.isArray(dataArray) || dataArray.length === 0) {
          throw new Error(
            `No historical data found for ${symbol} or unexpected structure`
          );
        }

        const sortedData = dataArray
          .map((item: any) => ({
            timestamp: item.TIMESTAMP,
            time: formatTime(item.TIMESTAMP * 1000),
            close: item.CLOSE,
            open: item.OPEN,
            high: item.HIGH,
            low: item.LOW,
            volume: item.VOLUME,
          }))
          .sort((a, b) => a.timestamp - b.timestamp);

        return sortedData;
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
        const endpoint = `https://data-api.coindesk.com/index/cc/v1/latest/tick?market=cadli&instruments=${symbol}-USD&apply_mapping=true`;
        const resp = await axios.get(endpoint);

        if (resp.data.Err && Object.keys(resp.data.Err).length > 0) {
          throw new Error("API Error: " + JSON.stringify(resp.data.Err));
        }

        const tickerItem = resp.data.Data[`${symbol}-USD`];
        if (!tickerItem || tickerItem.VALUE === undefined) {
          throw new Error(`No ${symbol}-USD tick data found`);
        }

        return { price: tickerItem.VALUE };
      } catch (err: any) {
        console.error(`Error fetching ticker data for ${symbol}:`, err);
        throw new Error(`Failed to load current price for ${symbol}`);
      }
    },
    []
  );

  // ------------- Minute Data -------------
  const fetchMinuteDataForCurrency = useCallback(
    async (
      symbol: string,
      startTime: number,
      endTime: number
    ): Promise<KlineData[]> => {
      try {
        setIsLoadingMinuteData(true);
        const params = {
          market: "cadli",
          instrument: `${symbol}-USD`,
          start_time: Math.floor(startTime / 1000),
          end_time: Math.floor(endTime / 1000),
          granularity: 60,
          fill: "true",
          apply_mapping: "true",
          response_format: "JSON",
        };

        const resp = await axios.get(MINUTE_DATA_ENDPOINT, { params });
        if (!resp.data || resp.data.Err || !resp.data.Data) {
          throw new Error(
            resp.data.Err
              ? "Minute Data API Error: " + JSON.stringify(resp.data.Err)
              : "Empty response from minute data API"
          );
        }

        const dataArray = resp.data.Data;
        if (!Array.isArray(dataArray) || dataArray.length === 0) {
          console.warn("No minute data points in response");
          setIsLoadingMinuteData(false);
          return [];
        }

        const sortedData = dataArray
          .map((item: any) => ({
            timestamp: item.TIMESTAMP,
            time: formatTime(item.TIMESTAMP * 1000),
            close: item.CLOSE,
            open: item.OPEN,
            high: item.HIGH,
            low: item.LOW,
            volume: item.VOLUME,
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

  // ------------- WS & Initialization -------------
  const processBatch = useCallback((currencySymbol: string) => {
    if (priceBufferRef.current !== null) {
      const latestPrice = priceBufferRef.current;
      const now = Date.now();

      // Update displayed price
      setCryptoData((prev) =>
        prev ? { ...prev, price: latestPrice } : { price: latestPrice }
      );

      // Add new chart point if an hour has passed since last update
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

  const connectWebSocketForCurrency = useCallback(
    (symbol: string) => {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.close();
        wsRef.current = null;
      }

      const ws = new WebSocket(WS_ENDPOINT);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log("WebSocket connected");
        setWsConnected(true);

        // Subscribe to multiple top currencies
        ws.send(JSON.stringify(MULTI_SUBSCRIBE_MESSAGE));

        // Also subscribe to the selected currency
        const CURRENCY_SUBSCRIBE_MESSAGE = {
          action: "SUBSCRIBE",
          type: "index_cc_v1_latest_tick",
          market: "cadli",
          instruments: [`${symbol}-USD`],
          groups: ["VALUE", "CURRENT_HOUR"],
        };
        ws.send(JSON.stringify(CURRENCY_SUBSCRIBE_MESSAGE));
      };

      ws.onmessage = (evt) => {
        try {
          const msg: WSMessage = JSON.parse(evt.data);
          if (
            msg.TYPE === "1101" &&
            msg.VALUE !== undefined &&
            msg.INSTRUMENT
          ) {
            const currencyPair = msg.INSTRUMENT;
            const price = msg.VALUE;

            // If it's the selected currency
            if (currencyPair === `${symbol}-USD`) {
              priceBufferRef.current = price;
              messageCountRef.current += 1;

              if (messageCountRef.current >= BATCH_THRESHOLD) {
                processBatch(symbol);
              } else if (!batchTimerRef.current) {
                batchTimerRef.current = window.setTimeout(() => {
                  processBatch(symbol);
                }, BATCH_WINDOW);
              }
            }

            // Update top currencies list no matter which instrument
            const msgSymbol = currencyPair.split("-")[0];
            setTopCurrencies((prev) =>
              prev.map((curr) =>
                curr.symbol === msgSymbol
                  ? {
                      ...curr,
                      price: price,
                      lastUpdated: Date.now(),
                    }
                  : curr
              )
            );
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
        console.log("WebSocket closed:", e.code, e.reason);
        setWsConnected(false);
      };
    },
    [processBatch]
  );

  const initializeDashboardForCurrency = useCallback(
    async (symbol: string) => {
      try {
        setLoading(true);
        setError(null);

        // Historical
        const historical = await fetchHistoricalDataForCurrency(symbol);
        setChartData(historical);

        // Current ticker
        const ticker = await fetchTickerDataForCurrency(symbol);
        setCryptoData(ticker);

        setLastUpdated(new Date().toLocaleTimeString());
        setLoading(false);

        connectWebSocketForCurrency(symbol);
        return true;
      } catch (err: any) {
        console.error(`Error initializing for ${symbol}:`, err);
        setError(err?.message || `Failed to load data for ${symbol}`);
        setLoading(false);
        return false;
      }
    },
    [
      fetchHistoricalDataForCurrency,
      fetchTickerDataForCurrency,
      connectWebSocketForCurrency,
    ]
  );

  useEffect(() => {
    fetchTopCurrencies().then(() => {
      initializeDashboardForCurrency("BTC");
    });

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      if (batchTimerRef.current) {
        clearTimeout(batchTimerRef.current);
      }
    };
  }, [fetchTopCurrencies, initializeDashboardForCurrency]);

  // ------------- Chart & Zoom handlers -------------
  const chartContainerRef = useRef<HTMLDivElement>(null);

  const handleResetZoom = useCallback(() => {
    setZoomState({
      xDomain: undefined,
      yDomain: undefined,
      isZoomed: false,
    });
    setMinuteData([]);
    setMinuteDataRange(null);
  }, []);

  const handleCurrencySelect = useCallback(
    (symbol: string) => {
      // Close existing WS
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      setZoomState({
        xDomain: undefined,
        yDomain: undefined,
        isZoomed: false,
      });
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

  // On-demand refresh
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

  // Mouse & touch events for zoom/pan...
  // (All your existing handleWheel, handleTouchStart, handleTouchMove, etc. remain below)

  const handleTouchStart = useCallback(
    (event: React.TouchEvent<HTMLDivElement>) => {
      // For pinch-to-zoom (2 fingers)
      if (event.touches.length === 2) {
        const touch1 = event.touches[0];
        const touch2 = event.touches[1];
        const distance = Math.hypot(
          touch2.clientX - touch1.clientX,
          touch2.clientY - touch1.clientY
        );

        const chartRect = event.currentTarget.getBoundingClientRect();
        const centerX = (touch1.clientX + touch2.clientX) / 2;
        const centerY = (touch1.clientY + touch2.clientY) / 2;
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
      // For pinch-to-zoom
      if (event.touches.length === 2) {
        const touch1 = event.touches[0];
        const touch2 = event.touches[1];
        const distance = Math.hypot(
          touch2.clientX - touch1.clientX,
          touch2.clientY - touch1.clientY
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

        // Basic limit for zooming out
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
      }
      // For panning
      else if (
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

        // Bound checks
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

      // Bound checks
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

  // ------------- Render -------------
  return (
    <div className="w-full max-w-7xl mx-auto p-2 sm:p-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-4 sm:mb-6">
        <div>
          <h1 className="text-xl sm:text-3xl font-bold">
            Crypto-Pilot Dashboard
          </h1>
        </div>
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 sm:gap-4 w-full sm:w-auto">
          <div className="flex items-center gap-2">
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
          </div>
          <div className="text-xs sm:text-sm text-muted-foreground">
            Last updated: {lastUpdated || "Never"}
          </div>
          <ModeToggle />
        </div>
      </div>

      {error && (
        <Card className="mb-4 sm:mb-6 border-red-500">
          <CardContent className="p-2 sm:p-4 text-red-500 text-sm">
            {error}
          </CardContent>
        </Card>
      )}

      {/* Row 1: Portfolio Overview & Bot Status */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6 mb-4 sm:mb-6">
        {/* Portfolio Overview */}
        <Card>
          <CardHeader className="p-3 sm:p-4 pb-0 sm:pb-0">
            <CardTitle className="text-base sm:text-lg">
              Portfolio Overview
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3 sm:p-4">
            <div className="text-sm sm:text-base">
              <p>
                <strong>Balance:</strong> {formatCurrency(portfolioBalance)}
              </p>
              <p>
                <strong>Overall P/L:</strong>{" "}
                <span
                  className={
                    portfolioProfitLoss >= 0 ? "text-green-600" : "text-red-600"
                  }
                >
                  {portfolioProfitLoss >= 0 ? "+" : "-"}
                  {Math.abs(portfolioProfitLoss).toFixed(2)}%
                </span>
              </p>
              <div className="mt-2">
                <strong>Open Positions:</strong>
                <ul className="list-disc ml-4 mt-1">
                  {openPositions.map((pos, idx) => (
                    <li key={idx}>
                      {pos.symbol}: {pos.amount}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Bot Status & Strategy */}
        <Card>
          <CardHeader className="p-3 sm:p-4 pb-0 sm:pb-0">
            <CardTitle className="text-base sm:text-lg">
              Bot Status & Strategy
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3 sm:p-4">
            <p className="text-sm sm:text-base mb-2">
              <strong>Status:</strong>{" "}
              <span className={botActive ? "text-green-600" : "text-red-600"}>
                {botActive ? "Active" : "Paused"}
              </span>
            </p>
            <p className="text-sm sm:text-base mb-2">
              <strong>Strategy:</strong> {botStrategy}
            </p>
            <Button
              variant={botActive ? "destructive" : "outline"}
              size="sm"
              onClick={() => setBotActive((prev) => !prev)}
            >
              {botActive ? "Pause Bot" : "Activate Bot"}
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Row 2: Chart & Top Cryptocurrencies */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 sm:gap-4">
        {/* Chart side (2/3 width) */}
        <div className="md:col-span-2">
          {/* Ticker Info */}
          {cryptoData && (
            <Card className="mb-3 sm:mb-4">
              <CardHeader className="p-3 sm:p-4 pb-0 sm:pb-0">
                <CardTitle className="text-base sm:text-lg">
                  Ticker Info ({selectedCurrency}/USD)
                </CardTitle>
              </CardHeader>
              <CardContent className="p-3 sm:p-4 pt-2 sm:pt-3 text-sm sm:text-base">
                <div>Last Price: {formatCurrency(cryptoData.price)}</div>
              </CardContent>
            </Card>
          )}

          {/* Main Chart */}
          {chartData.length > 0 && (
            <Card className="mb-3 sm:mb-4">
              <CardHeader className="p-3 sm:p-4 pb-0 sm:pb-0">
                <div className="flex justify-between items-center">
                  <CardTitle className="text-base sm:text-lg">
                    {selectedCurrency}/USD 24h Chart
                  </CardTitle>
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
                        dot={zoomState.isZoomed && minuteData.length > 0}
                        activeDot={{ r: 6 }}
                        isAnimationActive={false}
                      />
                      <Tooltip
                        formatter={(value: number) => [
                          formatCurrency(value),
                          `${selectedCurrency}/USD`,
                        ]}
                        labelFormatter={(label) => `Time: ${label}`}
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
                    Data from Coindesk API; live updates from CryptoCompare
                    WebSocket.
                  </p>
                  <p className="text-[10px] sm:text-xs text-muted-foreground">
                    <span className="hidden sm:inline">
                      Tip: Use your mouse wheel to zoom in and out.{" "}
                    </span>
                    <span className="sm:hidden">Tip: Pinch to zoom. </span>
                    Tap the Reset Zoom button to return to full view.
                  </p>
                </div>
              </CardFooter>
            </Card>
          )}
        </div>

        {/* Top Currencies (1/3 width) */}
        <div className="md:col-span-1">
          <Card className="h-full">
            <CardHeader className="p-3 sm:p-4 pb-0 sm:pb-0">
              <CardTitle className="text-base sm:text-lg">
                Top 10 Cryptocurrencies
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-auto max-h-[400px] sm:max-h-[600px]">
                <Table className="w-full">
                  <TableCaption className="text-[10px] sm:text-xs">
                    Updated in real-time via WebSocket
                  </TableCaption>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[60px] text-xs">Symbol</TableHead>
                      <TableHead className="text-right text-xs">
                        Price
                      </TableHead>
                      <TableHead className="text-right text-xs hidden sm:table-cell">
                        Market Cap
                      </TableHead>
                      <TableHead className="text-right text-xs">24h</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {isLoadingCurrencies ? (
                      <TableRow>
                        <TableCell colSpan={4} className="text-center text-xs">
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
                          onClick={() => handleCurrencySelect(currency.symbol)}
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
                                <ArrowDown className="h-3 w-3 text-red-500" />
                              )}
                              <Badge
                                variant={
                                  currency.change24h > 0
                                    ? "outline"
                                    : "destructive"
                                }
                                className="text-[10px] px-1 py-0"
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

      {/* Row 3: Quick Trade & Recent Trades */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
        {/* Quick Trade Card */}
        <Card>
          <CardHeader className="p-3 sm:p-4 pb-0 sm:pb-0">
            <CardTitle className="text-base sm:text-lg">Quick Trade</CardTitle>
          </CardHeader>
          <CardContent className="p-3 sm:p-4">
            <p className="text-sm mb-2">
              For simplicity, a novice can instantly buy/sell the currently
              selected currency.
            </p>
            <div className="flex gap-2">
              <Button
                variant="default"
                onClick={() =>
                  alert(`(Placeholder) Buying 0.01 ${selectedCurrency}`)
                }
              >
                Buy 0.01 {selectedCurrency}
              </Button>
              <Button
                variant="destructive"
                onClick={() =>
                  alert(`(Placeholder) Selling 0.01 ${selectedCurrency}`)
                }
              >
                Sell 0.01 {selectedCurrency}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Recent Trades / Activity Feed */}
        <Card>
          <CardHeader className="p-3 sm:p-4 pb-0 sm:pb-0">
            <CardTitle className="text-base sm:text-lg">
              Recent Trades
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-auto max-h-[200px] sm:max-h-[250px]">
              <Table className="w-full">
                <TableCaption className="text-[10px] sm:text-xs">
                  Latest activity by the bot
                </TableCaption>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Type</TableHead>
                    <TableHead className="text-xs">Symbol</TableHead>
                    <TableHead className="text-right text-xs">Amount</TableHead>
                    <TableHead className="text-right text-xs">Price</TableHead>
                    <TableHead className="text-right text-xs">Time</TableHead>
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
      </div>

      {/* Footer / Disclaimer */}
      <div className="mt-6 text-xs text-muted-foreground">
        <p>
          Disclaimer: This is a paper-trading bot dashboard for demonstration
          only. It does not constitute financial advice. Always do your own
          research.
        </p>
      </div>
    </div>
  );
}
