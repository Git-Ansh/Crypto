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

  // ------------------ REST: Fetch Historical Data (24h Hourly) ------------------
  const fetchHistoricalData = useCallback(async (): Promise<KlineData[]> => {
    try {
      const params = {
        market: "cadli",
        instrument: "BTC-USD",
        limit: 24, // Make sure we get exactly 24 hours
        aggregate: 1,
        fill: "true",
        apply_mapping: "true",
        response_format: "JSON",
      };
      const resp = await axios.get<HistoricalResponse>(HISTORICAL_ENDPOINT, {
        params,
      });
      console.log("DEBUG fetchHistoricalData response:", resp.data);

      if (resp.data.Err && Object.keys(resp.data.Err).length > 0) {
        throw new Error(
          "Historical API Error: " + JSON.stringify(resp.data.Err)
        );
      }

      // Ensure we have data array
      const dataArray = resp.data.Data;
      if (!Array.isArray(dataArray) || dataArray.length === 0) {
        throw new Error(
          "No historical data found or unexpected response structure"
        );
      }

      // Map each historical point using the structure from your example
      const sortedData = dataArray
        .map((item: any) => ({
          timestamp: item.TIMESTAMP, // Use TIMESTAMP from your example
          time: formatTime(item.TIMESTAMP * 1000),
          close: item.CLOSE, // Use CLOSE from your example
          open: item.OPEN,
          high: item.HIGH,
          low: item.LOW,
          volume: item.VOLUME,
        }))
        .sort((a, b) => a.timestamp - b.timestamp);

      console.log(`Processed ${sortedData.length} historical data points`);
      return sortedData;
    } catch (err: any) {
      console.error("Error fetching historical data:", err?.message);
      throw new Error("Error fetching historical data from Coindesk");
    }
  }, []);

  // ------------------ REST: Fetch Current Ticker Data ------------------
  const fetchTickerData = useCallback(async (): Promise<CryptoInfo> => {
    try {
      const resp = await axios.get(CURRENT_PRICE_ENDPOINT);
      console.log("DEBUG fetchTickerData response:", resp.data);

      if (resp.data.Err && Object.keys(resp.data.Err).length > 0) {
        throw new Error("API Error: " + JSON.stringify(resp.data.Err));
      }

      const tickerItem = resp.data.Data["BTC-USD"];
      if (!tickerItem || tickerItem.VALUE === undefined) {
        throw new Error("No BTC-USD tick data found");
      }

      return { price: tickerItem.VALUE };
    } catch (err: any) {
      console.error(
        "DEBUG fetchTickerData error:",
        err.response?.data || err.message
      );
      throw new Error("Error fetching current price from Coindesk");
    }
  }, []);

  // Add this new function to fetch minute-level data
  const fetchMinuteData = useCallback(
    async (startTime: number, endTime: number): Promise<KlineData[]> => {
      try {
        setIsLoadingMinuteData(true);
        console.log(
          `Fetching minute data from ${new Date(
            startTime
          ).toISOString()} to ${new Date(endTime).toISOString()}`
        );

        const params = {
          market: "cadli",
          instrument: "BTC-USD",
          start_time: Math.floor(startTime / 1000), // Convert to seconds
          end_time: Math.floor(endTime / 1000),
          granularity: 60, // 60 seconds = 1 minute
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
        console.error("Error fetching minute data:", err?.message);
        setIsLoadingMinuteData(false);
        throw new Error("Error fetching minute data from Coindesk");
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
  const initializeDashboard = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      // 1) Fetch historical data for the chart
      const historical = await fetchHistoricalData();

      // Log to verify we have all 24 points
      console.log(`Setting initial chart with ${historical.length} points`);

      // Set chart data with ALL historical points
      setChartData(historical);

      // 2) Fetch current price
      const ticker = await fetchTickerData();
      setCryptoData(ticker);

      // 3) Fetch top currencies
      await fetchTopCurrencies();

      setLastUpdated(new Date().toLocaleTimeString());
      setLoading(false);
      return historical.length > 0; // Return success status
    } catch (err: any) {
      console.error("Error in initializeDashboard:", err);
      setError(err?.message || "Failed to initialize data");
      setLoading(false);
      return false;
    }
  }, [fetchHistoricalData, fetchTickerData, fetchTopCurrencies]);

  // ------------------ WebSocket: Connect for Live Updates ------------------
  const processBatch = useCallback(() => {
    if (priceBufferRef.current !== null) {
      const latestPrice = priceBufferRef.current;
      const now = Date.now();

      // Always update the displayed price (every 2 seconds)
      setCryptoData((prev) =>
        prev ? { ...prev, price: latestPrice } : { price: latestPrice }
      );

      // Only add new chart point if an hour has passed since the last chart update
      const hourElapsed = now - lastChartUpdateRef.current >= HOUR_IN_MS;

      if (hourElapsed) {
        // Update the last chart update timestamp
        lastChartUpdateRef.current = now;

        // Append a new point to the chart but preserve historical data
        setChartData((prev) => {
          const newPoint: KlineData = {
            time: formatTime(now),
            close: latestPrice,
            timestamp: now / 1000, // Add timestamp here
          };

          // Find the 24 historical points (they should be the first 24 in the array)
          const historicalPoints = prev.slice(0, 24);
          // Get the live points (everything after the first 24)
          const livePoints = prev.slice(24);

          // Add the new point to the live points
          const updatedLivePoints = [...livePoints, newPoint];

          // If we have too many live points, trim them but KEEP ALL historical points
          if (updatedLivePoints.length > MAX_CHART_POINTS - 24) {
            // Only trim from the live points, not the historical
            updatedLivePoints.shift();
          }

          // Return historical + updated live points
          return [...historicalPoints, ...updatedLivePoints];
        });

        console.log(`Added new hourly chart point at ${formatTime(now)}`);
      }

      // Always update the "last updated" indicator for price
      setLastUpdated(new Date().toLocaleTimeString());
    }

    // Reset counters
    messageCountRef.current = 0;
    priceBufferRef.current = null;
    if (batchTimerRef.current) {
      clearTimeout(batchTimerRef.current);
      batchTimerRef.current = null;
    }
  }, []);

  // Update your WebSocket connection function to use the expanded subscription
  const connectWebSocket = useCallback(() => {
    // Only open a new WebSocket if one isn't already open
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      console.log("WebSocket already connected.");
      return;
    }
    console.log("Connecting to CryptoCompare Data Streamer ->", WS_ENDPOINT);
    const ws = new WebSocket(WS_ENDPOINT);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log("WebSocket connected");
      setWsConnected(true);
      ws.send(JSON.stringify(MULTI_SUBSCRIBE_MESSAGE));
    };

    ws.onmessage = (evt) => {
      try {
        const msg: WSMessage = JSON.parse(evt.data);

        // Watch for VALUE updates from CryptoCompare
        if (msg.TYPE === "1101" && msg.VALUE !== undefined && msg.INSTRUMENT) {
          const currencyPair = msg.INSTRUMENT;
          const price = msg.VALUE;

          // If it's BTC-USD, update as before
          if (currencyPair === "BTC-USD") {
            // Put the latest price into a buffer to be processed in batches
            priceBufferRef.current = price;
            messageCountRef.current += 1;

            if (messageCountRef.current >= BATCH_THRESHOLD) {
              processBatch();
            } else if (!batchTimerRef.current) {
              // If we haven't scheduled a batch yet, schedule one
              batchTimerRef.current = window.setTimeout(() => {
                processBatch();
              }, BATCH_WINDOW);
            }
          }

          // For all currencies, update the top currencies list
          const symbol = currencyPair.split("-")[0]; // Extract 'BTC' from 'BTC-USD'

          setTopCurrencies((prev) =>
            prev.map((curr) =>
              curr.symbol === symbol
                ? {
                    ...curr,
                    price: price,
                    lastUpdated: Date.now(),
                  }
                : curr
            )
          );
        } else {
          // For debugging – other messages from the stream
          console.log("Received other WS message:", msg);
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
  }, [processBatch]);

  // ------------------ Refresh Button: Only Update Current Price ------------------
  const handleRefresh = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const ticker = await fetchTickerData();
      setCryptoData(ticker);
      setLastUpdated(new Date().toLocaleTimeString());
      setLoading(false);
    } catch (err: any) {
      console.error("Error in handleRefresh:", err);
      setError(err?.message || "Failed to refresh price");
      setLoading(false);
    }
  }, [fetchTickerData]);

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

            fetchMinuteData(visibleStartTime, visibleEndTime)
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
      fetchMinuteData,
      minuteDataRange,
      isLoadingMinuteData,
    ]
  );

  // Handle touch start (track initial pinch distance)
  const handleTouchStart = useCallback(
    (event: React.TouchEvent<HTMLDivElement>) => {
      if (event.touches.length === 2) {
        // It's a pinch gesture
        const touch1 = event.touches[0];
        const touch2 = event.touches[1];
        const distance = Math.hypot(
          touch2.clientX - touch1.clientX,
          touch2.clientY - touch1.clientY
        );

        setTouchState({
          initialDistance: distance,
          initialDomains: {
            x: zoomState.xDomain || [0, chartData.length - 1],
            y: zoomState.yDomain || [
              Math.min(...chartData.map((d) => d.close)) * 0.99,
              Math.max(...chartData.map((d) => d.close)) * 1.01,
            ],
          },
        });
      }
    },
    [chartData, zoomState]
  );

  // Handle touch move (calculate zoom based on pinch)
  const handleTouchMove = useCallback(
    (event: React.TouchEvent<HTMLDivElement>) => {
      if (event.touches.length === 2) {
        const touch1 = event.touches[0];
        const touch2 = event.touches[1];
        const distance = Math.hypot(
          touch2.clientX - touch1.clientX,
          touch2.clientY - touch1.clientY
        );

        const zoomRatio = touchState.initialDistance / distance;

        // Calculate new domains based on pinch zoom
        const xRange =
          touchState.initialDomains.x[1] - touchState.initialDomains.x[0];
        const yRange =
          touchState.initialDomains.y[1] - touchState.initialDomains.y[0];

        const newXDomain: [number, number] = [
          touchState.initialDomains.x[0] + (xRange * (1 - zoomRatio)) / 2,
          touchState.initialDomains.x[1] - (xRange * (1 - zoomRatio)) / 2,
        ];

        const newYDomain: [number, number] = [
          touchState.initialDomains.y[0] + (yRange * (1 - zoomRatio)) / 2,
          touchState.initialDomains.y[1] - (yRange * (1 - zoomRatio)) / 2,
        ];

        setZoomState({
          xDomain: newXDomain,
          yDomain: newYDomain,
          isZoomed: true,
        });
      }
    },
    [touchState]
  );

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
    fetchMinuteData,
    minuteDataRange,
    isLoadingMinuteData,
  ]);

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

      // Calculate zoom center based on cursor position
      const chartRect = chartContainer.getBoundingClientRect();
      const xPercent = (event.clientX - chartRect.left) / chartRect.width;
      const yPercent = (event.clientY - chartRect.top) / chartRect.height;

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
          handleResetZoom();
          return;
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

        // Only fetch minute data if the visible area is small enough
        if (visibleStartIdx < visibleEndIdx) {
          const visibleStartTime = chartData[visibleStartIdx].timestamp * 1000;
          const visibleEndTime = chartData[visibleEndIdx].timestamp * 1000;

          // Force fetch if we're zoomed in enough, regardless of what data we already have
          const shouldFetch = zoomWidth <= minuteDataThreshold;

          if (shouldFetch && !isLoadingMinuteData) {
            // Clear any previous minute data
            setMinuteData([]);

            fetchMinuteData(visibleStartTime, visibleEndTime)
              .then((newMinuteData) => {
                if (newMinuteData.length > 0) {
                  setMinuteData(newMinuteData);
                }
              })
              .catch((err) => {
                console.error("Failed to load minute data:", err);
              });
          }
        }
      }

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
    fetchMinuteData,
    minuteDataRange,
    isLoadingMinuteData,
    minuteDataThreshold,
  ]);

  // ------------------ On Mount ------------------
  useEffect(() => {
    // 1) Fetch historical + current data
    initializeDashboard().then((success) => {
      // 2) Only connect WS for live updates if we have historical data
      if (success) {
        console.log(
          "Historical data loaded successfully. Connecting WebSocket..."
        );
        connectWebSocket();
      } else {
        console.error(
          "Failed to load historical data. Not connecting WebSocket."
        );
      }
    });

    // Cleanup on unmount
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      if (batchTimerRef.current) {
        clearTimeout(batchTimerRef.current);
      }
    };
  }, [initializeDashboard, connectWebSocket]);

  // ------------------ RENDER ------------------
  return (
    <div className="w-full max-w-7xl mx-auto p-4">
      {/* Header */}
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-3xl font-bold">CryptoCompare BTC Dashboard</h1>
          <p className="text-muted-foreground">
            Live BTC/USD price (via WebSocket) &amp; 24h hourly chart (REST)
          </p>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "inline-block w-2 h-2 rounded-full",
                wsConnected ? "bg-green-500" : "bg-red-500"
              )}
            />
            <span className="text-sm">
              {wsConnected ? "Connected" : "Disconnected"}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={handleRefresh}
              disabled={loading}
            >
              <RefreshCw className="h-4 w-4 mr-2" />
              {loading ? "Loading" : "Refresh"}
            </Button>
          </div>
          <div className="text-sm text-muted-foreground">
            Last updated: {lastUpdated || "Never"}
          </div>
          <ModeToggle />
        </div>
      </div>

      {/* Error Display */}
      {error && (
        <Card className="mb-6 border-red-500">
          <CardContent className="p-4 text-red-500">{error}</CardContent>
        </Card>
      )}

      {/* Two column layout */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Left column - Top Currencies Table */}
        <div className="md:col-span-1">
          <Card className="h-full">
            <CardHeader>
              <CardTitle>Top 10 Cryptocurrencies</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-auto max-h-[600px]">
                <Table>
                  <TableCaption>
                    Updated in real-time via WebSocket
                  </TableCaption>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[80px]">Symbol</TableHead>
                      <TableHead className="text-right">Price</TableHead>
                      <TableHead className="text-right">Market Cap</TableHead>
                      <TableHead className="text-right">24h</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {isLoadingCurrencies ? (
                      <TableRow>
                        <TableCell colSpan={4} className="text-center">
                          Loading...
                        </TableCell>
                      </TableRow>
                    ) : (
                      topCurrencies.map((currency) => (
                        <TableRow key={currency.symbol}>
                          <TableCell className="font-medium">
                            {currency.symbol}
                          </TableCell>
                          <TableCell className="text-right">
                            {formatCurrency(currency.price)}
                          </TableCell>
                          <TableCell className="text-right">
                            {formatCurrency(currency.marketCap, true)}
                          </TableCell>
                          <TableCell className="text-right">
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
                                className="text-xs"
                              >
                                {Math.abs(currency.change24h).toFixed(2)}%
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

        {/* Right column - Ticker and Chart */}
        <div className="md:col-span-2">
          {/* Ticker Info */}
          {cryptoData && (
            <Card className="mb-4">
              <CardHeader>
                <CardTitle>Ticker Info (BTC/USD)</CardTitle>
              </CardHeader>
              <CardContent>
                <div>Last Price: {formatCurrency(cryptoData.price)}</div>
              </CardContent>
            </Card>
          )}

          {/* Live Chart */}
          {chartData.length > 0 && (
            <Card className="mb-4">
              <CardHeader>
                <div className="flex justify-between items-center">
                  <CardTitle>Live 24h Hourly Chart</CardTitle>
                  {zoomState.isZoomed && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleResetZoom}
                    >
                      Reset Zoom
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                <div
                  ref={chartContainerRef}
                  onMouseDown={handleMouseDown}
                  onMouseMove={handleMouseMove}
                  onMouseUp={handleMouseUp}
                  onMouseLeave={handleMouseLeave}
                  onTouchStart={handleTouchStart}
                  onTouchMove={handleTouchMove}
                  style={{
                    width: "100%",
                    height: 300,
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
                  <ResponsiveContainer width="100%" height={300}>
                    <LineChart
                      data={
                        zoomState.isZoomed && minuteData.length > 0
                          ? minuteData
                          : chartData
                      }
                      margin={{ top: 10, right: 20, left: 0, bottom: 0 }}
                    >
                      <CartesianGrid
                        strokeDasharray="3 3"
                        stroke="#aaa"
                        opacity={0.2}
                      />
                      <XAxis
                        dataKey="time"
                        tick={{ fontSize: 10 }}
                        domain={zoomState.xDomain}
                        allowDataOverflow
                      />
                      <YAxis
                        domain={zoomState.yDomain || ["auto", "auto"]}
                        allowDataOverflow
                        tick={{ fontSize: 10 }}
                        tickFormatter={(val: number) => val.toFixed(0)}
                      />
                      <Tooltip
                        contentStyle={{ fontSize: "0.75rem" }}
                        formatter={(value, name) => {
                          if (name === "close")
                            return formatCurrency(value as number);
                          if (name === "high")
                            return formatCurrency(value as number);
                          if (name === "low")
                            return formatCurrency(value as number);
                          if (name === "open")
                            return formatCurrency(value as number);
                          if (name === "volume") return value;
                          return value;
                        }}
                        content={({ active, payload, label }) => {
                          if (active && payload && payload.length) {
                            const data = payload[0].payload;
                            return (
                              <div className="p-2 bg-background border rounded-md shadow-sm">
                                <p className="text-xs font-medium">{`Time: ${label}`}</p>
                                <p className="text-xs">
                                  Price: {formatCurrency(data.close)}
                                </p>
                                {data.high && (
                                  <p className="text-xs">
                                    High: {formatCurrency(data.high)}
                                  </p>
                                )}
                                {data.low && (
                                  <p className="text-xs">
                                    Low: {formatCurrency(data.low)}
                                  </p>
                                )}
                                {data.open && (
                                  <p className="text-xs">
                                    Open: {formatCurrency(data.open)}
                                  </p>
                                )}
                                {data.volume && (
                                  <p className="text-xs">
                                    Volume: {Math.round(data.volume)}
                                  </p>
                                )}
                              </div>
                            );
                          }
                          return null;
                        }}
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
                      {/* Add a loading indicator for minute data */}
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
              <CardFooter className="border-t p-4">
                <div className="w-full">
                  <p className="text-xs text-muted-foreground mb-2">
                    Data from Coindesk API; live updates from CryptoCompare
                    WebSocket.
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Tip: Use your mouse wheel to zoom in and out. Use the Reset
                    Zoom button to return to full view.
                  </p>
                </div>
              </CardFooter>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
