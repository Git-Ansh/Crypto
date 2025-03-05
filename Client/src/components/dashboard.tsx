"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { ModeToggle } from "@/components/mode-toggle";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CardFooter,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowDownIcon, ArrowUpIcon, RefreshCw } from "lucide-react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";
import { cn } from "@/lib/utils";
import axios from "axios";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faBitcoin,
  faEthereum,
  faTelegramPlane,
} from "@fortawesome/free-brands-svg-icons";
import { faCoins } from "@fortawesome/free-solid-svg-icons";

// ================== CONFIG ==================
const MAX_COINS = 10;
const MAX_CHARTS = 5;

// Ask for data in 15-min intervals for the last 24h
// so we get about 96 points in the chart
const CHART_INTERVAL = "m15";  // or "m5", "m30", "h1" etc.
const CHART_RANGE_HOURS = 24;  
const WS_UPDATE_INTERVAL = 2000;
const FETCH_COOLDOWN_MS = 15 * 60 * 1000;
const RATE_LIMIT_COOLDOWN_MS = 2 * 60 * 1000;
// ...existing code...
const MAX_CHART_POINTS = 100; 
// ...existing code...
interface CoinCapAsset {
  id: string;
  symbol: string;
  name: string;
  priceUsd: string;
  changePercent24Hr: string;
  volumeUsd24Hr: string;
  marketCapUsd: string;
}
interface CryptoInfo {
  id: string;
  symbol: string;
  name: string;
  price: number;
  changePercent24h: number;
  volume24h: number;
  marketCap: number;
}
interface KlineData {
  time: string;  
  price: number;
}
interface BinanceWebSocket extends WebSocket {
  pingInterval?: NodeJS.Timeout;
}

// Font Awesome icon map
const ICON_MAP: Record<string, any> = {
  bitcoin: faBitcoin,
  ethereum: faEthereum,
  ripple: faTelegramPlane,
  binancecoin: faCoins,
  solana: faCoins,
  cardano: faCoins,
  dogecoin: faCoins,
  polkadot: faCoins,
  tether: faCoins,
  default: faCoins,
};

// Helpers for formatting
function formatCurrency(num: number): string {
  if (typeof num !== "number" || isNaN(num)) return "$0.00";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(num);
}
function formatLargeNumber(num: number): string {
  if (typeof num !== "number" || isNaN(num)) return "$0.00";
  if (num >= 1e12) return `$${(num / 1e12).toFixed(2)}T`;
  if (num >= 1e9) return `$${(num / 1e9).toFixed(2)}B`;
  if (num >= 1e6) return `$${(num / 1e6).toFixed(2)}M`;
  return formatCurrency(num);
}
function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export default function Dashboard() {
  const [cryptoData, setCryptoData] = useState<CryptoInfo[]>([]);
  const [chartData, setChartData] = useState<Record<string, KlineData[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState("");
  const [wsConnected, setWsConnected] = useState(false);

  const [apiCoolingDown, setApiCoolingDown] = useState(false);
  const lastFetchAttemptRef = useRef<number>(0);

  const wsRef = useRef<BinanceWebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const reconnectAttemptsRef = useRef<number>(0);
  const scheduledUpdateRef = useRef<NodeJS.Timeout | null>(null);
  const priceBufferRef = useRef<Record<string, number>>({});

  // 1) fetchTopCoins
  const fetchTopCoins = async (): Promise<CryptoInfo[]> => {
    const now = Date.now();
    const hasCache = !!localStorage.getItem("topCoins");
    if ((apiCoolingDown || now - lastFetchAttemptRef.current < FETCH_COOLDOWN_MS) && hasCache) {
      // use cached
      const cachedString = localStorage.getItem("topCoins");
      const cachedTime = localStorage.getItem("topCoinsTime");
      if (cachedString && cachedTime) {
        const age = now - parseInt(cachedTime, 10);
        if (age < FETCH_COOLDOWN_MS) {
          try {
            const parsed = JSON.parse(cachedString) as CryptoInfo[];
            if (parsed.length > 0) {
              console.log("Using cached topCoins data from localStorage.");
              setLoading(false);
              return parsed;
            }
          } catch {}
        }
      }
      throw new Error("CoinCap fetch is on cooldown. No fresh data available.");
    }

    lastFetchAttemptRef.current = now;
    setLoading(true);

    try {
      const resp = await axios.get("https://api.coincap.io/v2/assets", {
        params: { limit: 15 },
        timeout: 10000,
      });
      if (!resp.data?.data) throw new Error("No data from CoinCap");
      const raw = resp.data.data as CoinCapAsset[];
      const top10 = raw.slice(0, MAX_COINS).map((c) => ({
        id: c.id,
        symbol: c.symbol,
        name: c.name,
        price: parseFloat(c.priceUsd),
        changePercent24h: parseFloat(c.changePercent24Hr),
        volume24h: parseFloat(c.volumeUsd24Hr),
        marketCap: parseFloat(c.marketCapUsd),
      }));
      localStorage.setItem("topCoins", JSON.stringify(top10));
      localStorage.setItem("topCoinsTime", now.toString());
      setLoading(false);
      return top10;
    } catch (err: any) {
      console.error("fetchTopCoins error:", err?.message);
      setLoading(false);

      if (err?.response?.status === 429) {
        setApiCoolingDown(true);
        setTimeout(() => setApiCoolingDown(false), RATE_LIMIT_COOLDOWN_MS);
        throw new Error("Rate-limited by CoinCap. Using cached data if any...");
      }
      // fallback
      const cachedString = localStorage.getItem("topCoins");
      if (cachedString) {
        try {
          const parsed = JSON.parse(cachedString) as CryptoInfo[];
          if (parsed.length > 0) {
            console.log("Using fallback localStorage topCoins data due to error.");
            return parsed;
          }
        } catch {}
      }
      throw err;
    }
  };

  // 2) fetchHistory (use 24h but with 15-min intervals)
  const fetchHistory = async (coinId: string): Promise<KlineData[]> => {
    const cacheKey = `history_${coinId}`;
    const cacheTimeKey = `history_${coinId}_time`;
    const now = Date.now();
    const hasCache = !!localStorage.getItem(cacheKey);

    if ((apiCoolingDown || (now - lastFetchAttemptRef.current < FETCH_COOLDOWN_MS)) && hasCache) {
      const existing = localStorage.getItem(cacheKey);
      const existingT = localStorage.getItem(cacheTimeKey);
      if (existing && existingT) {
        const age = now - parseInt(existingT, 10);
        if (age < FETCH_COOLDOWN_MS) {
          try {
            return JSON.parse(existing) as KlineData[];
          } catch {}
        }
        return JSON.parse(existing) as KlineData[];
      }
      console.warn(`No fresh history for ${coinId} and no valid cache => returning empty.`);
      return [];
    }

    // fetch 24h of data
    try {
      const end = now;
      const start = end - CHART_RANGE_HOURS * 3600000; // 24h
      const resp = await axios.get(`https://api.coincap.io/v2/assets/${coinId}/history`, {
        params: {
          interval: CHART_INTERVAL, // e.g. "m15"
          start,
          end,
        },
        timeout: 10000,
      });
      if (!resp.data?.data) return [];
      // Build array from each point
      const hist = resp.data.data.map((p: any) => ({
        time: formatTime(p.time),
        price: parseFloat(p.priceUsd),
      }));
      localStorage.setItem(cacheKey, JSON.stringify(hist));
      localStorage.setItem(cacheTimeKey, now.toString());
      return hist;
    } catch (err: any) {
      console.error(`Error fetching history for ${coinId}:`, err?.message);
      if (err?.response?.status === 429) {
        setApiCoolingDown(true);
        setTimeout(() => setApiCoolingDown(false), RATE_LIMIT_COOLDOWN_MS);
      }
      // fallback
      const fallback = localStorage.getItem(cacheKey);
      if (fallback) {
        console.log(`Cannot fetch fresh history for ${coinId}. Using fallback localStorage data.`);
        try {
          return JSON.parse(fallback) as KlineData[];
        } catch {}
      }
      return [];
    }
  };

  // 3) Combined
  const fetchAllData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const top10 = await fetchTopCoins();
      setCryptoData(top10);

      if (top10.length === 0) {
        setError("No cryptocurrency data available.");
        setLoading(false);
        return;
      }
      // gather chart data for first 5
      const chartSlice = top10.slice(0, MAX_CHARTS);
      const results = await Promise.all(chartSlice.map((c) => fetchHistory(c.id)));
      const newChartData: Record<string, KlineData[]> = {};
      chartSlice.forEach((coin, i) => {
        newChartData[coin.id] = results[i] || [];
      });
      setChartData(newChartData);

      setLastUpdated(new Date().toLocaleTimeString());
      setLoading(false);
    } catch (err: any) {
      console.error("Error in fetchAllData:", err);
      setError(err?.message || "Failed to fetch data");
      setLoading(false);
    }
  }, []);

  // 4) CoinCap WebSocket
  function connectCoincapWS(coinsData = cryptoData) {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    if (!coinsData || !coinsData.length) {
      console.log("No data for WS connection");
      return;
    }
    const slice10 = coinsData.slice(0, 10);
    const assetsQuery = slice10.map(c => c.id).join(',');
    const url = `wss://ws.coincap.io/prices?assets=${assetsQuery}`;
    console.log("Connecting CoinCap WebSocket ->", url);

    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log("CoinCap WebSocket connected");
      setWsConnected(true);
      reconnectAttemptsRef.current = 0;
    };

    ws.onmessage = (evt) => {
      try {
        const updates = JSON.parse(evt.data) as Record<string,string>;
        for (const [coinId, priceStr] of Object.entries(updates)) {
          const match = coinsData.find(c => c.id === coinId);
          if (match) {
            priceBufferRef.current[coinId] = parseFloat(priceStr);
          }
        }
        if (!scheduledUpdateRef.current && Object.keys(priceBufferRef.current).length > 0) {
          scheduledUpdateRef.current = setTimeout(() => {
            const finalUpdates = { ...priceBufferRef.current };
            priceBufferRef.current = {};
            scheduledUpdateRef.current = null;
            applyCoincapUpdates(finalUpdates);
          }, WS_UPDATE_INTERVAL);
        }
      } catch (err) {
        console.error("Error parsing CoinCap WS message:", err);
      }
    };

    ws.onerror = (err) => {
      console.error("CoinCap WS error:", err);
      setWsConnected(false);
    };

    ws.onclose = (e) => {
      console.log("CoinCap WS closed", e.code, e.reason);
      setWsConnected(false);
      if (reconnectAttemptsRef.current >= 5) {
        console.log("Max WS reconnect attempts reached, stopping.");
        return;
      }
      reconnectAttemptsRef.current += 1;
      const delay = Math.min(30000, 1000 * Math.pow(2, reconnectAttemptsRef.current));
      console.log(`Will attempt reconnection in ${delay / 1000}s`);
      reconnectTimerRef.current = window.setTimeout(() => {
        reconnectTimerRef.current = null;
        connectCoincapWS(coinsData);
      }, delay);
    };
  }

  function applyCoincapUpdates(updates: Record<string, number>) {
    setCryptoData(prev => {
      return prev.map((coin) => {
        if (updates[coin.id] !== undefined) {
          return { ...coin, price: updates[coin.id] };
        }
        return coin;
      });
    });

    setChartData(prev => {
      const updated = { ...prev };
      for (const [coinId, newPrice] of Object.entries(updates)) {
        if (updated[coinId]) {
          const newPt = { time: formatTime(Date.now()), price: newPrice };
          const arr = [...updated[coinId], newPt];
          if (arr.length > MAX_CHART_POINTS) arr.shift();
          updated[coinId] = arr;
        }
      }
      return updated;
    });
    setLastUpdated(new Date().toLocaleTimeString());
  }

  const handleRefresh = useCallback(() => {
    fetchAllData();
  }, [fetchAllData]);

  function forceFreshConnection() {
    localStorage.removeItem("topCoins");
    localStorage.removeItem("topCoinsTime");
    setApiCoolingDown(false);
    lastFetchAttemptRef.current = 0;
    fetchAllData().then(() => {
      connectCoincapWS();
    });
  }

  useEffect(() => {
    fetchAllData().then(() => {
      connectCoincapWS();
    });
    return () => {
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      if (scheduledUpdateRef.current) clearTimeout(scheduledUpdateRef.current);
      if (wsRef.current) {
        try {
          wsRef.current.onclose = null;
          wsRef.current.close();
        } catch {}
        wsRef.current = null;
      }
    };
  }, [fetchAllData]);

  return (
    <div className="w-full max-w-7xl mx-auto p-4">
      {/* Header */}
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-3xl font-bold">Crypto Dashboard</h1>
          <p className="text-muted-foreground">Real-time cryptocurrency prices from CoinCap (24h data)</p>
        </div>
        <div className="flex items-center gap-4">
          {/* WebSocket status */}
          <div className={cn("flex items-center gap-2 text-sm", wsConnected ? "text-green-500" : "text-red-500")}>
            <span className={cn("inline-block w-2 h-2 rounded-full", wsConnected ? "bg-green-500" : "bg-red-500")} />
            {wsConnected ? "Connected" : "Disconnected"}
          </div>
          <Button variant="outline" size="sm" onClick={forceFreshConnection}>
            <RefreshCw className={cn("h-4 w-4 mr-2", loading && "animate-spin")} />
            Refresh
          </Button>
          <div className="text-sm text-muted-foreground">
            Last updated: {lastUpdated || "Never"}
          </div>
          <ModeToggle />
        </div>
      </div>

      {/* Error */}
      {error && (
        <Card className="mb-6 border-red-500">
          <CardContent className="p-4 text-red-500">{error}</CardContent>
        </Card>
      )}

      {/* Graphs for first 5 coins */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
        {loading && cryptoData.length === 0 ? (
          Array(MAX_CHARTS)
            .fill(null)
            .map((_, i) => (
              <Card key={i} className="overflow-hidden">
                <CardHeader className="p-4 animate-pulse">
                  <div className="h-6 bg-muted rounded w-1/3 mb-2"></div>
                  <div className="h-4 bg-muted rounded w-1/4"></div>
                </CardHeader>
                <CardContent className="p-0 pt-2 h-[120px] flex items-center justify-center">
                  <div className="text-muted-foreground text-xs">Loading chart data...</div>
                </CardContent>
              </Card>
            ))
        ) : (
          cryptoData.slice(0, MAX_CHARTS).map((coin) => {
            const data = chartData[coin.id] || [];
            return (
              <Card key={coin.id} className="overflow-hidden">
                <CardHeader className="p-4 pb-0">
                  <div className="flex justify-between items-center">
                    <div>
                      <CardTitle className="text-lg">{coin.name}</CardTitle>
                      <CardDescription className="text-sm uppercase">
                        {coin.symbol}
                      </CardDescription>
                    </div>
                    <div className="text-right">
                      <div className="text-lg font-bold">{formatCurrency(coin.price)}</div>
                      <div
                        className={cn(
                          "flex items-center text-sm justify-end",
                          coin.changePercent24h >= 0 ? "text-green-500" : "text-red-500"
                        )}
                      >
                        {coin.changePercent24h >= 0 ? (
                          <ArrowUpIcon className="h-3 w-3 mr-1" />
                        ) : (
                          <ArrowDownIcon className="h-3 w-3 mr-1" />
                        )}
                        {Math.abs(coin.changePercent24h).toFixed(2)}%
                      </div>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="p-0 pt-2 h-[120px]">
                  {data.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart
                        data={data}
                        margin={{ top: 10, right: 20, left: 0, bottom: 0 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" stroke="#aaa" opacity={0.2} />
                        <XAxis dataKey="time" tick={{ fontSize: 10 }} />
                        <YAxis
                          domain={[
                            (dataMin: number) => dataMin * 0.98,
                            (dataMax: number) => dataMax * 1.02,
                          ]}
                          tick={{ fontSize: 10 }}
                          tickFormatter={(val: number) => val.toFixed(2)}
                        />
                        <Tooltip
                          contentStyle={{ fontSize: "0.75rem" }}
                          formatter={(value: any) => formatCurrency(value)}
                          labelFormatter={(label) => `Time: ${label}`}
                        />
                        <Line
                          type="monotone"
                          dataKey="price"
                          stroke="#22c55e"
                          strokeWidth={2}
                          dot={false}
                          activeDot={{ r: 4 }}
                          isAnimationActive={false}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="h-full flex items-center justify-center">
                      <p className="text-muted-foreground text-xs">No chart data</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })
        )}
      </div>

      {/* Table for top 10 */}
      <Card>
        <CardHeader>
          <CardTitle>Top 10 Cryptocurrencies</CardTitle>
          <CardDescription>Using CoinCap’s 24h data & real-time WS</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="relative overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="text-xs uppercase border-b">
                <tr>
                  <th className="px-4 py-3">Symbol</th>
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Price</th>
                  <th className="px-4 py-3">24h %</th>
                  <th className="px-4 py-3">Volume (24h)</th>
                  <th className="px-4 py-3">Market Cap</th>
                </tr>
              </thead>
              <tbody>
                {loading && cryptoData.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-4 text-center">
                      Loading...
                    </td>
                  </tr>
                ) : cryptoData.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-4 text-center text-muted-foreground">
                      No data
                    </td>
                  </tr>
                ) : (
                  cryptoData.map((coin) => {
                    const isUp = coin.changePercent24h >= 0;
                    const faIcon = ICON_MAP[coin.id] || ICON_MAP.default;
                    return (
                      <tr key={coin.id} className="border-b hover:bg-muted/30">
                        <td className="px-4 py-3 flex items-center gap-2">
                          <FontAwesomeIcon icon={faIcon} />
                          <span className="font-medium text-base">
                            {coin.symbol.toUpperCase()}
                          </span>
                        </td>
                        <td className="px-4 py-3">{coin.name}</td>
                        <td className="px-4 py-3 font-medium">
                          {formatCurrency(coin.price)}
                        </td>
                        <td className="px-4 py-3">
                          <div
                            className={cn(
                              "flex items-center",
                              isUp ? "text-green-500" : "text-red-500"
                            )}
                          >
                            {isUp ? (
                              <ArrowUpIcon className="h-3 w-3 mr-1" />
                            ) : (
                              <ArrowDownIcon className="h-3 w-3 mr-1" />
                            )}
                            {Math.abs(coin.changePercent24h).toFixed(2)}%
                          </div>
                        </td>
                        <td className="px-4 py-3">{formatLargeNumber(coin.volume24h)}</td>
                        <td className="px-4 py-3">{formatLargeNumber(coin.marketCap)}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
        <CardFooter className="border-t p-4">
          <p className="text-xs text-muted-foreground">
            Data from CoinCap (cached ~15 min). 24h with 15-min intervals. Real-time feed for top 10.
          </p>
        </CardFooter>
      </Card>
    </div>
  );
}
