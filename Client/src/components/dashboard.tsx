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
  ReferenceArea,
} from "recharts";

// Example UI components – adjust these to your project's design.
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardFooter,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ModeToggle } from "@/components/mode-toggle";
import { RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

// First, add these imports at the top
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
import { ArrowUp, ArrowDown } from "lucide-react";

// ================== CONFIG ==================
const HISTORICAL_ENDPOINT =
  "https://data-api.coindesk.com/index/cc/v1/historical/hours";
const CURRENT_PRICE_ENDPOINT =
  "https://data-api.coindesk.com/index/cc/v1/latest/tick?market=cadli&instruments=BTC-USD&apply_mapping=true";
const MINUTE_DATA_ENDPOINT =
  "https://data-api.coindesk.com/index/cc/v1/historical/minutes";

// CryptoCompare WebSocket endpoint & subscription
const WS_ENDPOINT = "wss://data-streamer.cryptocompare.com";
const SUBSCRIBE_MESSAGE = {
  action: "SUBSCRIBE",
  type: "index_cc_v1_latest_tick",
  market: "cadli",
  instruments: ["BTC-USD"],
  groups: ["VALUE", "CURRENT_HOUR"],
};

// Modify the WS subscription to include more currencies
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

// Define the endpoint for top currencies
// Replace with this corrected endpoint (uses min-api instead of data-api)
const TOP_CURRENCIES_ENDPOINT =
  "https://min-api.cryptocompare.com/data/pricemultifull?fsyms=BTC,ETH,XRP,BNB,ADA,SOL,DOGE,DOT,AVAX,MATIC,LINK,SHIB&tsyms=USD";
// Polling/batch settings for WS updates
const BATCH_THRESHOLD = 5; // Process 5 messages at once
const BATCH_WINDOW = 2000; // Or every 2 seconds
const MAX_CHART_POINTS = 1000; // Increase this to allow for more historical + live data points

// ================== TYPE DEFINITIONS ==================
interface HistoricalResponse {
  Data: any[]; // Array of historical data objects
  Err?: Record<string, any>;
}

interface CryptoInfo {
  price: number;
}

// Update your KlineData interface to include timestamp
interface KlineData {
  time: string;
  close: number;
  timestamp: number; // Make this required since you depend on it
  open?: number;
  high?: number;
  low?: number;
  volume?: number;
  isMinuteData?: boolean; // Also add this flag used in fetchMinuteData
}

interface WSMessage {
  TYPE: string; // e.g. "1101", "4002", etc.
  INSTRUMENT?: string;
  VALUE?: number; // price
  // other fields omitted
}

// Add these new interfaces for the top currencies data
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
  const [cryptoData, setCryptoData] = useState<CryptoInfo | null>(null);
  const [chartData, setChartData] = useState<KlineData[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [wsConnected, setWsConnected] = useState<boolean>(false);
  const [lastUpdated, setLastUpdated] = useState<string>("");

  // Refs for WebSocket and batching
  const wsRef = useRef<WebSocket | null>(null);
  const messageCountRef = useRef<number>(0);
  const batchTimerRef = useRef<number | null>(null);
  const priceBufferRef = useRef<number | null>(null);
  const lastChartUpdateRef = useRef<number>(Date.now());
  const HOUR_IN_MS = 60 * 60 * 1000; // 1 hour in milliseconds

  // State for zooming
  const [zoomState, setZoomState] = useState({
    xDomain: undefined as [number, number] | undefined,
    yDomain: undefined as [number, number] | undefined,
    isZoomed: false,
  });

  // Add touch state trackers
  const [touchState, setTouchState] = useState({
    initialDistance: 0,
    initialDomains: {
      x: [0, 0] as [number, number],
      y: [0, 0] as [number, number],
      centerX: 0,
      centerY: 0,
    },
  });

  // Add these new state variables at the top of your component
  const [minuteData, setMinuteData] = useState<KlineData[]>([]);
  const [isLoadingMinuteData, setIsLoadingMinuteData] =
    useState<boolean>(false);
  const [minuteDataRange, setMinuteDataRange] = useState<{
    start: number;
    end: number;
  } | null>(null);
  const minuteDataThreshold = 12; // Increase from 8 to 12 to make it more sensitive

  // Add pan state to your component
  const [panState, setPanState] = useState({
    isPanning: false,
    lastMouseX: 0,
    lastMouseY: 0,
  });

  // Add these state variables right after your existing state declarations
  const [topCurrencies, setTopCurrencies] = useState<CurrencyData[]>([]);
  const [isLoadingCurrencies, setIsLoadingCurrencies] = useState<boolean>(true);

  // 1. First, add state to track the selected currency
  const [selectedCurrency, setSelectedCurrency] = useState<string>("BTC");
  const [selectedCurrencyName, setSelectedCurrencyName] =
    useState<string>("Bitcoin");

  // ------------------ Helper Functions ------------------
  // Update the formatCurrency function to handle large numbers (market cap)
  function formatCurrency(num: number, abbreviated: boolean = false): string {
    // For market cap, use abbreviated formatting
    if (abbreviated && num > 1000000) {
      if (num > 1000000000) {
        return new Intl.NumberFormat("en-US", {
          style: "currency",
          currency: "USD",
          notation: "compact",
          compactDisplay: "short",
          maximumFractionDigits: 2,
        }).format(num);
      }
      if (num > 1000000) {
        return new Intl.NumberFormat("en-US", {
          style: "currency",
          currency: "USD",
          notation: "compact",
          compactDisplay: "short",
          maximumFractionDigits: 2,
        }).format(num);
      }
    }

    // For regular prices use standard formatting
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

  // 2. Create a function to handle currency selection
  const handleCurrencySelect = useCallback(
    (symbol: string) => {
      // Close existing WebSocket connection
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }

      // Reset states
      setZoomState({
        xDomain: undefined,
        yDomain: undefined,
        isZoomed: false,
      });
      setChartData([]);
      setMinuteData([]);

      // Set new selected currency
      setSelectedCurrency(symbol);

      // Find currency name from our top currencies list
      const currencyData = topCurrencies.find((c) => c.symbol === symbol);
      if (currencyData) {
        setSelectedCurrencyName(currencyData.name || symbol);
      }

      // Load data for this currency
      initializeDashboardForCurrency(symbol);
    },
    [topCurrencies]
  );

  // ------------------ REST: Fetch Historical Data (24h Hourly) ------------------
  // 3. Modify API functions to accept currency parameter
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
        console.log(
          `DEBUG fetchHistoricalData for ${symbol} response:`,
          resp.data
        );

        if (resp.data.Err && Object.keys(resp.data.Err).length > 0) {
          throw new Error(
            "Historical API Error: " + JSON.stringify(resp.data.Err)
          );
        }

        // Ensure we have data array
        const dataArray = resp.data.Data;
        if (!Array.isArray(dataArray) || dataArray.length === 0) {
          throw new Error(
            `No historical data found for ${symbol} or unexpected response structure`
          );
        }

        // Map each historical point
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

        console.log(
          `Processed ${sortedData.length} historical data points for ${symbol}`
        );
        return sortedData;
      } catch (err: any) {
        console.error(
          `Error fetching historical data for ${symbol}:`,
          err?.message
        );
        throw new Error(
          `Error fetching historical data for ${symbol} from Coindesk`
        );
      }
    },
    []
  );

  // ------------------ REST: Fetch Current Ticker Data ------------------
  // 4. Modify ticker data fetch for selected currency
  const fetchTickerDataForCurrency = useCallback(
    async (symbol: string): Promise<CryptoInfo> => {
      try {
        const endpoint = `https://data-api.coindesk.com/index/cc/v1/latest/tick?market=cadli&instruments=${symbol}-USD&apply_mapping=true`;
        const resp = await axios.get(endpoint);
        console.log(`DEBUG fetchTickerData for ${symbol} response:`, resp.data);

        if (resp.data.Err && Object.keys(resp.data.Err).length > 0) {
          throw new Error("API Error: " + JSON.stringify(resp.data.Err));
        }

        const tickerItem = resp.data.Data[`${symbol}-USD`];
        if (!tickerItem || tickerItem.VALUE === undefined) {
          throw new Error(`No ${symbol}-USD tick data found`);
        }

        return { price: tickerItem.VALUE };
      } catch (err: any) {
        console.error(
          `DEBUG fetchTickerData error for ${symbol}:`,
          err.response?.data || err.message
        );
        throw new Error(
          `Error fetching current price for ${symbol} from Coindesk`
        );
      }
    },
    []
  );

  // Add this new function to fetch minute-level data
  // 5. Also update minute data fetch function
  const fetchMinuteDataForCurrency = useCallback(
    async (
      symbol: string,
      startTime: number,
      endTime: number
    ): Promise<KlineData[]> => {
      try {
        setIsLoadingMinuteData(true);
        console.log(
          `Fetching ${symbol} minute data from ${new Date(
            startTime
          ).toISOString()} to ${new Date(endTime).toISOString()}`
        );

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
          console.error("API Error or empty response:", resp.data);
          throw new Error(
            resp.data.Err
              ? "Minute Data API Error: " + JSON.stringify(resp.data.Err)
              : "Empty response from minute data API"
          );
        }

        // Ensure we have data array
        const dataArray = resp.data.Data;
        if (!Array.isArray(dataArray) || dataArray.length === 0) {
          console.warn("No minute data points in response");
          setIsLoadingMinuteData(false);
          return [];
        }

        // Map each minute point
        const sortedData = dataArray
          .map((item: any) => ({
            timestamp: item.TIMESTAMP,
            time: formatTime(item.TIMESTAMP * 1000),
            close: item.CLOSE,
            open: item.OPEN,
            high: item.HIGH,
            low: item.LOW,
            volume: item.VOLUME,
            isMinuteData: true, // Flag to identify minute data
          }))
          .sort((a, b) => a.timestamp - b.timestamp);

        console.log(
          `Processed ${sortedData.length} minute data points from ${formatTime(
            startTime
          )} to ${formatTime(endTime)}`
        );

        // Store the range we've loaded
        setMinuteDataRange({
          start: startTime,
          end: endTime,
        });

        setIsLoadingMinuteData(false);
        return sortedData;
      } catch (err: any) {
        console.error(
          `Error fetching minute data for ${symbol}:`,
          err?.message
        );
        setIsLoadingMinuteData(false);
        throw new Error(
          `Error fetching minute data for ${symbol} from Coindesk`
        );
      }
    },
    []
  );

  // Create a function to fetch initial top currencies data
  const fetchTopCurrencies = useCallback(async () => {
    try {
      setIsLoadingCurrencies(true);
      const resp = await axios.get(TOP_CURRENCIES_ENDPOINT);

      if (!resp.data || !resp.data.RAW) {
        throw new Error("Invalid data format from cryptocompare API");
      }

      const rawData = resp.data.RAW;
      const currencies: CurrencyData[] = [];

      Object.keys(rawData).forEach((symbol) => {
        const usdData = rawData[symbol].USD;
        currencies.push({
          symbol,
          name: symbol, // We could fetch full names if needed
          price: usdData.PRICE,
          volume: usdData.VOLUME24HOUR,
          marketCap: usdData.MKTCAP,
          change24h: usdData.CHANGEPCT24HOUR,
          lastUpdated: Date.now(),
        });
      });

      // Sort by volume and take top 10
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

  // ------------------ One-Time Initialization on Mount ------------------
  // 8. Create a unified initialization function
  const processBatch = useCallback((currencySymbol: string) => {
    if (priceBufferRef.current !== null) {
      const latestPrice = priceBufferRef.current;
      const now = Date.now();

      // Always update the displayed price
      setCryptoData((prev) =>
        prev ? { ...prev, price: latestPrice } : { price: latestPrice }
      );

      // Only add new chart point if an hour has passed since the last chart update
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

        console.log(
          `Added new hourly chart point for ${currencySymbol} at ${formatTime(
            now
          )}`
        );
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

  // 6. Create WebSocket connection for selected currency
  const connectWebSocketForCurrency = useCallback(
    (symbol: string) => {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        console.log("WebSocket already connected, closing first.");
        wsRef.current.close();
        wsRef.current = null;
      }

      console.log(`Connecting WebSocket for ${symbol}-USD`);
      const ws = new WebSocket(WS_ENDPOINT);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log("WebSocket connected");
        setWsConnected(true);

        // Create subscription for specific currency
        const CURRENCY_SUBSCRIBE_MESSAGE = {
          action: "SUBSCRIBE",
          type: "index_cc_v1_latest_tick",
          market: "cadli",
          instruments: [`${symbol}-USD`],
          groups: ["VALUE", "CURRENT_HOUR"],
        };

        // Keep the multi-subscribe for top currencies
        ws.send(JSON.stringify(MULTI_SUBSCRIBE_MESSAGE));

        // Also subscribe to the selected currency specifically
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

            // If it's our selected currency, update chart and price
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

            // Update top currencies list regardless of which message it is
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

      // Rest of WebSocket handler remains the same
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

  // THEN place initializeDashboardForCurrency after it
  const initializeDashboardForCurrency = useCallback(
    async (symbol: string) => {
      try {
        setLoading(true);
        setError(null);

        // 1) Fetch historical data for this currency
        const historical = await fetchHistoricalDataForCurrency(symbol);
        setChartData(historical);

        // 2) Fetch current price for this currency
        const ticker = await fetchTickerDataForCurrency(symbol);
        setCryptoData(ticker);

        setLastUpdated(new Date().toLocaleTimeString());
        setLoading(false);

        // Connect WebSocket for this currency
        connectWebSocketForCurrency(symbol);

        return true;
      } catch (err: any) {
        console.error(`Error initializing dashboard for ${symbol}:`, err);
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

  // ------------------ WebSocket: Connect for Live Updates ------------------
  // 7. Update the processBatch function to use selected currency

  // ------------------ Refresh Button: Only Update Current Price ------------------
  const handleRefresh = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const ticker = await fetchTickerDataForCurrency(selectedCurrency);
      setCryptoData(ticker);
      setLastUpdated(new Date().toLocaleTimeString());
      setLoading(false);
    } catch (err: any) {
      console.error("Error in handleRefresh:", err);
      setError(err?.message || "Failed to refresh price");
      setLoading(false);
    }
  }, [fetchTickerDataForCurrency, selectedCurrency]);

  // ------------------ Zoom Handlers ------------------
  const chartContainerRef = useRef<HTMLDivElement>(null);

  // Reset zoom - MOVE THIS FUNCTION UP
  const handleResetZoom = useCallback(() => {
    setZoomState({
      xDomain: undefined,
      yDomain: undefined,
      isZoomed: false,
    });
    // Optionally clear minute data when resetting zoom
    setMinuteData([]);
    setMinuteDataRange(null);
  }, []);

  // Handle wheel events for zooming
  const handleWheel = useCallback(
    (event: React.WheelEvent<HTMLDivElement>) => {
      event.preventDefault();

      if (chartData.length === 0) return;

      // Get current domains or set defaults if undefined
      const currentXDomain = zoomState.xDomain || [0, chartData.length - 1];
      const currentYDomain = zoomState.yDomain || [
        Math.min(...chartData.map((d) => d.close)) * 0.99,
        Math.max(...chartData.map((d) => d.close)) * 1.01,
      ];

      // Calculate current ranges
      const currentXRange = currentXDomain[1] - currentXDomain[0];
      const currentYRange = currentYDomain[1] - currentYDomain[0];

      // Determine zoom direction and factor
      const zoomFactor = event.deltaY > 0 ? 1.1 : 0.9; // Zoom in or out

      // Check zoom limits before proceeding
      // For x-axis: Don't allow zooming in to less than 3 data points
      if (zoomFactor < 1 && currentXRange * zoomFactor < 3) {
        return; // Prevent excessive x-axis zoom
      }

      // For y-axis: Don't allow zooming in to less than 0.5% of the full price range
      const fullYRange =
        Math.max(...chartData.map((d) => d.close)) -
        Math.min(...chartData.map((d) => d.close));
      const minYRange = fullYRange * 0.005; // 0.5% of full range

      if (zoomFactor < 1 && currentYRange * zoomFactor < minYRange) {
        return; // Prevent excessive y-axis zoom
      }

      // Calculate new domain ranges
      const xRange = currentXRange;
      const yRange = currentYRange;

      // Calculate zoom center based on cursor position
      const chartRect = event.currentTarget.getBoundingClientRect();
      const xPercent = (event.clientX - chartRect.left) / chartRect.width;
      const yPercent = (event.clientY - chartRect.top) / chartRect.height;

      // Calculate new domains centered around cursor position
      const newXDomain: [number, number] = [
        currentXDomain[0] - (xRange * zoomFactor - xRange) * xPercent,
        currentXDomain[1] + (xRange * zoomFactor - xRange) * (1 - xPercent),
      ];

      const newYDomain: [number, number] = [
        currentYDomain[0] - (yRange * zoomFactor - yRange) * (1 - yPercent),
        currentYDomain[1] + (yRange * zoomFactor - yRange) * yPercent,
      ];

      // Ensure we don't zoom out beyond the original domain
      const fullXDomain = [0, chartData.length - 1];
      const fullYDomain = [
        Math.min(...chartData.map((d) => d.close)) * 0.99,
        Math.max(...chartData.map((d) => d.close)) * 1.01,
      ];

      // Limit maximum zoom out
      if (zoomFactor > 1) {
        // Don't zoom out beyond original domain
        if (
          newXDomain[0] < fullXDomain[0] &&
          newXDomain[1] > fullXDomain[1] &&
          newYDomain[0] < fullYDomain[0] &&
          newYDomain[1] > fullYDomain[1]
        ) {
          // Reset to full view instead of allowing excessive zoom out
          return handleResetZoom();
        }
      }

      // After calculating the new domains, check if we should fetch minute data
      // Only when zooming in (zoomFactor < 1)
      if (zoomFactor < 1) {
        // Get the visible data points based on the new zoom domains
        const visibleStartIdx = Math.max(0, Math.ceil(newXDomain[0]));
        const visibleEndIdx = Math.min(
          chartData.length - 1,
          Math.floor(newXDomain[1])
        );

        // Calculate zoom width to determine if we're zoomed in enough to show minute data
        const zoomWidth = newXDomain[1] - newXDomain[0];

        // Debug the zoom width
        console.log(
          `Current zoom width: ${zoomWidth.toFixed(
            2
          )}, threshold: ${minuteDataThreshold}`
        );

        // Only fetch minute data if the visible area is small enough
        if (visibleStartIdx < visibleEndIdx) {
          const visibleStartTime = chartData[visibleStartIdx].timestamp * 1000;
          const visibleEndTime = chartData[visibleEndIdx].timestamp * 1000;

          // Force fetch if we're zoomed in enough, regardless of what data we already have
          const shouldFetch = zoomWidth <= minuteDataThreshold;

          console.log(
            `Zoomed time range: ${formatTime(visibleStartTime)} to ${formatTime(
              visibleEndTime
            )}, should fetch: ${shouldFetch}`
          );

          if (shouldFetch && !isLoadingMinuteData) {
            // Clear any previous minute data
            setMinuteData([]);

            console.log(
              `Fetching minute data for ${formatTime(
                visibleStartTime
              )} - ${formatTime(visibleEndTime)}`
            );

            fetchMinuteDataForCurrency(
              selectedCurrency,
              visibleStartTime,
              visibleEndTime
            )
              .then((newMinuteData) => {
                if (newMinuteData.length > 0) {
                  console.log(
                    `Loaded ${newMinuteData.length} minute data points`
                  );
                  setMinuteData(newMinuteData);
                } else {
                  console.warn("No minute data returned for the time range");
                }
              })
              .catch((err) => {
                console.error("Failed to load minute data:", err);
              });
          }
        }
      }

      // Set new zoom state
      setZoomState({
        xDomain: newXDomain,
        yDomain: newYDomain,
        isZoomed: true,
      });
    },
    [
      chartData,
      zoomState,
      handleResetZoom,
      fetchMinuteDataForCurrency,
      minuteDataRange,
      isLoadingMinuteData,
      selectedCurrency,
    ]
  );

  // Handle touch start (track initial pinch distance)
  const handleTouchStart = useCallback(
    (event: React.TouchEvent<HTMLDivElement>) => {
      // For pinch-to-zoom (2 fingers)
      if (event.touches.length === 2) {
        // It's a pinch gesture
        const touch1 = event.touches[0];
        const touch2 = event.touches[1];
        const distance = Math.hypot(
          touch2.clientX - touch1.clientX,
          touch2.clientY - touch1.clientY
        );

        // Get center point of the two touches
        const centerX = (touch1.clientX + touch2.clientX) / 2;
        const centerY = (touch1.clientY + touch2.clientY) / 2;

        const chartRect = event.currentTarget.getBoundingClientRect();
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
      }
      // For panning (1 finger)
      else if (event.touches.length === 1 && zoomState.isZoomed) {
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

  // Enhanced touch move handler for better mobile experience
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

        // Calculate zoom factor based on pinch
        const zoomFactor = touchState.initialDistance / distance;

        // Use the initial pinch center for zooming
        const xPercent = touchState.initialDomains.centerX;
        const yPercent = touchState.initialDomains.centerY;

        // Calculate domain ranges
        const xRange =
          touchState.initialDomains.x[1] - touchState.initialDomains.x[0];
        const yRange =
          touchState.initialDomains.y[1] - touchState.initialDomains.y[0];

        // Calculate new domains centered around pinch center point
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

        // Apply zoom limits
        if (zoomFactor > 1) {
          // Don't zoom out beyond original full domain
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
      // For panning with one finger
      else if (
        event.touches.length === 1 &&
        panState.isPanning &&
        zoomState.isZoomed
      ) {
        const touch = event.touches[0];

        // Calculate movement delta
        const deltaX = touch.clientX - panState.lastMouseX;
        const deltaY = touch.clientY - panState.lastMouseY;

        // Get current domains
        const currentXDomain = zoomState.xDomain || [0, chartData.length - 1];
        const currentYDomain = zoomState.yDomain || [
          Math.min(...chartData.map((d) => d.close)) * 0.99,
          Math.max(...chartData.map((d) => d.close)) * 1.01,
        ];

        // Calculate domain ranges
        const xRange = currentXDomain[1] - currentXDomain[0];
        const yRange = currentYDomain[1] - currentYDomain[0];

        // Get chart dimensions
        const chartRect = event.currentTarget.getBoundingClientRect();

        // Calculate domain shifts
        const xShift = (deltaX / chartRect.width) * xRange * -2; // Increased sensitivity for mobile
        const yShift = (deltaY / chartRect.height) * yRange;

        // Calculate new domains
        const newXDomain: [number, number] = [
          currentXDomain[0] + xShift,
          currentXDomain[1] + xShift,
        ];

        const newYDomain: [number, number] = [
          currentYDomain[0] + yShift,
          currentYDomain[1] + yShift,
        ];

        // Apply bounds checking
        const fullXDomain = [0, chartData.length - 1];
        let adjustedXDomain = [...newXDomain] as [number, number];

        if (newXDomain[0] < fullXDomain[0]) {
          const overflow = fullXDomain[0] - newXDomain[0];
          adjustedXDomain = [fullXDomain[0], newXDomain[1] - overflow];
        }

        if (newXDomain[1] > fullXDomain[1]) {
          const overflow = newXDomain[1] - fullXDomain[1];
          adjustedXDomain = [newXDomain[0] + overflow, fullXDomain[1]];
        }

        // Update state
        setZoomState((prev) => ({
          ...prev,
          xDomain: adjustedXDomain,
          yDomain: newYDomain,
        }));

        // Update last touch position
        setPanState({
          isPanning: true,
          lastMouseX: touch.clientX,
          lastMouseY: touch.clientY,
        });

        // Prevent default to avoid scrolling
        event.preventDefault();
      }
    },
    [touchState, panState, zoomState, chartData, handleResetZoom]
  );

  // Add touch end handler
  const handleTouchEnd = useCallback(() => {
    setPanState((prev) => ({
      ...prev,
      isPanning: false,
    }));
  }, []);

  // Add these handlers for panning
  const handleMouseDown = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      // Only start panning if we're zoomed in
      if (zoomState.isZoomed) {
        setPanState({
          isPanning: true,
          lastMouseX: event.clientX,
          lastMouseY: event.clientY,
        });

        // Disable default browser dragging behavior
        event.preventDefault();
      }
    },
    [zoomState.isZoomed]
  );

  const handleMouseMove = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (!panState.isPanning || !zoomState.isZoomed) return;

      // Calculate how far the mouse has moved
      const deltaX = event.clientX - panState.lastMouseX;
      const deltaY = event.clientY - panState.lastMouseY;

      // Get current chart domains
      const currentXDomain = zoomState.xDomain || [0, chartData.length - 1];
      const currentYDomain = zoomState.yDomain || [
        Math.min(...chartData.map((d) => d.close)) * 0.99,
        Math.max(...chartData.map((d) => d.close)) * 1.01,
      ];

      // Calculate domain ranges
      const xRange = currentXDomain[1] - currentXDomain[0];
      const yRange = currentYDomain[1] - currentYDomain[0];

      // Calculate how much to shift the domains
      const chartRect = chartContainerRef.current?.getBoundingClientRect();
      if (!chartRect) return;

      // Improved sensitivity factors for more natural panning
      const xShift = (deltaX / chartRect.width) * xRange * -1.5; // Increased sensitivity
      const yShift = (deltaY / chartRect.height) * yRange;

      // Update domains
      const newXDomain: [number, number] = [
        currentXDomain[0] + xShift,
        currentXDomain[1] + xShift,
      ];

      const newYDomain: [number, number] = [
        currentYDomain[0] + yShift,
        currentYDomain[1] + yShift,
      ];

      // Get full domain bounds
      const fullXDomain = [0, chartData.length - 1];
      const fullYDomain = [
        Math.min(...chartData.map((d) => d.close)) * 0.99,
        Math.max(...chartData.map((d) => d.close)) * 1.01,
      ];

      // Enhanced bounds checking - allow partial overscroll for better UX
      let adjustedXDomain = [...newXDomain] as [number, number];

      // If we're trying to pan past the left edge
      if (newXDomain[0] < fullXDomain[0]) {
        const overflow = fullXDomain[0] - newXDomain[0];
        adjustedXDomain = [fullXDomain[0], newXDomain[1] - overflow];
      }

      // If we're trying to pan past the right edge
      if (newXDomain[1] > fullXDomain[1]) {
        const overflow = newXDomain[1] - fullXDomain[1];
        adjustedXDomain = [newXDomain[0] + overflow, fullXDomain[1]];
      }

      // Update zoom state with adjusted domains
      setZoomState((prev) => ({
        ...prev,
        xDomain: adjustedXDomain,
        yDomain: newYDomain,
      }));

      // Update last position for next move event
      setPanState({
        isPanning: true,
        lastMouseX: event.clientX,
        lastMouseY: event.clientY,
      });
    },
    [panState, zoomState, chartData]
  );

  const handleMouseUp = useCallback(() => {
    setPanState((prev) => ({
      ...prev,
      isPanning: false,
    }));
  }, []);

  // Add mouseLeave handler to stop panning if cursor leaves the chart area
  const handleMouseLeave = useCallback(() => {
    setPanState((prev) => ({
      ...prev,
      isPanning: false,
    }));
  }, []);

  // Add a global mouse up listener
  useEffect(() => {
    if (panState.isPanning) {
      const handleGlobalMouseUp = () => {
        setPanState((prev) => ({
          ...prev,
          isPanning: false,
        }));
      };

      window.addEventListener("mouseup", handleGlobalMouseUp);

      return () => {
        window.removeEventListener("mouseup", handleGlobalMouseUp);
      };
    }
  }, [panState.isPanning]);

  // Add this useEffect to handle wheel events with the non-passive option
  useEffect(() => {
    const chartContainer = chartContainerRef.current;
    if (!chartContainer) return;

    // Create a wheel handler that can be properly removed later
    const handleWheelEvent = (event: WheelEvent) => {
      // Prevent default scrolling behavior
      event.preventDefault();

      // Process the wheel event with your zoom logic
      if (chartData.length === 0) return;

      // Get current domains or set defaults if undefined
      const currentXDomain = zoomState.xDomain || [0, chartData.length - 1];
      const currentYDomain = zoomState.yDomain || [
        Math.min(...chartData.map((d) => d.close)) * 0.99,
        Math.max(...chartData.map((d) => d.close)) * 1.01,
      ];

      // Calculate current ranges
      const currentXRange = currentXDomain[1] - currentXDomain[0];
      const currentYRange = currentYDomain[1] - currentYDomain[0];

      // Determine zoom direction and factor
      const zoomFactor = event.deltaY > 0 ? 1.1 : 0.9; // Zoom in or out

      // Copy all the logic from your handleWheel function
      // ... (insert all the code from your handleWheel function here)

      // For example:
      // Check zoom limits before proceeding
      if (zoomFactor < 1 && currentXRange * zoomFactor < 3) {
        return; // Prevent excessive x-axis zoom
      }

      // Calculate zoom center
      const chartRect = chartContainer.getBoundingClientRect();
      const xPercent = (event.clientX - chartRect.left) / chartRect.width;
      const yPercent = (event.clientY - chartRect.top) / chartRect.height;

      // Calculate new domains
      // (Add the rest of your zoom logic here)
      // After checking zoom limits and calculating the zoom center:
      // Calculate new domains centered around cursor position
      const newXDomain: [number, number] = [
        currentXDomain[0] -
          (currentXRange * zoomFactor - currentXRange) * xPercent,
        currentXDomain[1] +
          (currentXRange * zoomFactor - currentXRange) * (1 - xPercent),
      ];

      const newYDomain: [number, number] = [
        currentYDomain[0] -
          (currentYRange * zoomFactor - currentYRange) * (1 - yPercent),
        currentYDomain[1] +
          (currentYRange * zoomFactor - currentYRange) * yPercent,
      ];
      // Set zoom state at the end
      setZoomState({
        xDomain: newXDomain,
        yDomain: newYDomain,
        isZoomed: true,
      });
    };

    // Use type assertion to fix TypeScript error with passive option
    chartContainer.addEventListener("wheel", handleWheelEvent, {
      passive: false,
    } as AddEventListenerOptions);

    // Clean up listener on unmount
    return () => {
      chartContainer.removeEventListener("wheel", handleWheelEvent, {
        passive: false,
      } as AddEventListenerOptions);
    };
  }, [
    chartData,
    zoomState,
    handleResetZoom,
    fetchMinuteDataForCurrency,
    minuteDataRange,
    isLoadingMinuteData,
  ]);

  // ------------------ On Mount ------------------
  // 9. Update the initial load effect
  useEffect(() => {
    // First, fetch the top currencies
    fetchTopCurrencies().then(() => {
      // Then initialize with default BTC
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

  // ------------------ RENDER ------------------
  return (
    <div className="w-full max-w-7xl mx-auto p-2 sm:p-4">
      {/* Header - make it stack on mobile */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-4 sm:mb-6">
        <div>
          <h1 className="text-xl sm:text-3xl font-bold">
            Crypto-Pilot Dashboard
          </h1>
          {/* <p className="text-xs sm:text-sm text-muted-foreground">
            Live BTC/USD price (via WebSocket) &amp; 24h hourly chart (REST)
          </p> */}
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

      {/* Error Display */}
      {error && (
        <Card className="mb-4 sm:mb-6 border-red-500">
          <CardContent className="p-2 sm:p-4 text-red-500 text-sm">
            {error}
          </CardContent>
        </Card>
      )}

      {/* Reverse column order on mobile so chart appears first */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 sm:gap-4">
        {/* Right column - Ticker and Chart */}
        <div className="md:col-span-2 order-1 md:order-2">
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

          {/* Live Chart */}
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
                    WebkitUserSelect: "none",
                    MozUserSelect: "none",
                    msUserSelect: "none",
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
                      {/* Add this Line component which was missing */}
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

        {/* Left column - Top Currencies Table (shows after chart on mobile) */}
        <div className="md:col-span-1 order-2 md:order-1">
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
    </div>
  );
}
