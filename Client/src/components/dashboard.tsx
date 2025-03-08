"use client";

import { useState, useEffect, useRef, useCallback } from "react";
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

// ================== CONFIG ==================
const HISTORICAL_ENDPOINT =
  "https://data-api.coindesk.com/index/cc/v1/historical/hours";
const CURRENT_PRICE_ENDPOINT =
  "https://data-api.coindesk.com/index/cc/v1/latest/tick?market=cadli&instruments=BTC-USD&apply_mapping=true";

// CryptoCompare WebSocket endpoint & subscription
const WS_ENDPOINT = "wss://data-streamer.cryptocompare.com";
const SUBSCRIBE_MESSAGE = {
  action: "SUBSCRIBE",
  type: "index_cc_v1_latest_tick",
  market: "cadli",
  instruments: ["BTC-USD"],
  groups: ["VALUE", "CURRENT_HOUR"],
};

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

interface KlineData {
  time: string;
  close: number;
}

interface WSMessage {
  TYPE: string; // e.g. "1101", "4002", etc.
  INSTRUMENT?: string;
  VALUE?: number; // price
  // other fields omitted
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

  // ------------------ Helper Functions ------------------
  function formatCurrency(num: number): string {
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
        }))
        .sort((a, b) => a.timestamp - b.timestamp);

      console.log(`Processed ${sortedData.length} historical data points`);
      return sortedData.map(({ time, close }) => ({ time, close }));
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

      setLastUpdated(new Date().toLocaleTimeString());
      setLoading(false);
      return historical.length > 0; // Return success status
    } catch (err: any) {
      console.error("Error in initializeDashboard:", err);
      setError(err?.message || "Failed to initialize data");
      setLoading(false);
      return false;
    }
  }, [fetchHistoricalData, fetchTickerData]);

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
      ws.send(JSON.stringify(SUBSCRIBE_MESSAGE));
    };

    ws.onmessage = (evt) => {
      try {
        const msg: WSMessage = JSON.parse(evt.data);
        // Watch for the "1101" type (VALUE update) from CryptoCompare
        if (
          msg.TYPE === "1101" &&
          msg.INSTRUMENT === "BTC-USD" &&
          msg.VALUE !== undefined
        ) {
          // Put the latest price into a buffer to be processed in batches
          priceBufferRef.current = msg.VALUE;
          messageCountRef.current += 1;

          if (messageCountRef.current >= BATCH_THRESHOLD) {
            processBatch();
          } else if (!batchTimerRef.current) {
            // If we haven't scheduled a batch yet, schedule one
            batchTimerRef.current = window.setTimeout(() => {
              processBatch();
            }, BATCH_WINDOW);
          }
        } else {
          // For debugging – other messages from the stream
          console.log("Received WS message:", msg);
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
            <CardTitle>Live 24h Hourly Chart</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart
                data={chartData} // Show all data points, not just the last 24
                margin={{ top: 10, right: 20, left: 0, bottom: 0 }}
              >
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="#aaa"
                  opacity={0.2}
                />
                <XAxis dataKey="time" tick={{ fontSize: 10 }} />
                <YAxis
                  domain={["auto", "auto"]}
                  tick={{ fontSize: 10 }}
                  tickFormatter={(val: number) => val.toFixed(2)}
                />
                <Tooltip
                  contentStyle={{ fontSize: "0.75rem" }}
                  formatter={(value) => formatCurrency(value as number)}
                  labelFormatter={(label) => `Time: ${label}`}
                />
                <Line
                  type="monotone"
                  dataKey="close"
                  stroke="#f7931a"
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
          <CardFooter className="border-t p-4">
            <p className="text-xs text-muted-foreground">
              Data from Coindesk API; live updates from CryptoCompare WebSocket.
            </p>
          </CardFooter>
        </Card>
      )}
    </div>
  );
}
