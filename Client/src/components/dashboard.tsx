"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
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
import { AreaChart, Area, ResponsiveContainer, Tooltip } from "recharts";
import { cn } from "@/lib/utils";
import axios from "axios";

// Font Awesome react, brand icons, fallback coin icon
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
   faBitcoin, // brand new in FA 6
  faEthereum,
  faBtc, // an older fallback for bitcoin brand
  faTelegramPlane,
} from "@fortawesome/free-brands-svg-icons";
import { faCoins } from "@fortawesome/free-solid-svg-icons";

// =============== CONFIG =============== 
const MAX_COINS = 10; // We want top 10 from CoinCap 
const MAX_CHARTS = 5; // We'll chart the first 5 from that top 10 
const CHART_RANGE_HOURS = 5; // 5-hour chart 
const WS_UPDATE_INTERVAL = 2000; // 2-second buffer for updates 
const MAX_CHART_POINTS = 24; // keep up to 24 points in the chart

// For Font Awesome: map typical coin IDs to icons 
// If not found here, we fallback to faCoins 
const ICON_MAP: Record<string, any> = {
  bitcoin:  faBitcoin, // Using the newer Bitcoin icon
  ethereum: faEthereum,
  ripple: faTelegramPlane,
  // Add more common coins
  binancecoin: faCoins,
  solana: faCoins,
  cardano: faCoins,
  dogecoin: faCoins,
  polkadot: faCoins,
  tron: faCoins,
  // Always include a fallback
  default: faCoins
};

// =============== TYPE DEFINITIONS =============== 
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
  id: string; // e.g. "bitcoin" 
  symbol: string; // e.g. "BTC" 
  name: string; // e.g. "Bitcoin" 
  price: number;
  changePercent24h: number;
  volume24h: number;
  marketCap: number;
}

interface KlineData {
  time: string; // e.g. "3:00 PM" 
  price: number;
}

interface BinanceTickerStream {
  s: string; // e.g. "BTCUSDT" 
  c: string; // last price 
}

// =============== HELPER FUNCTIONS =============== 
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
  const date = new Date(timestamp);
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

// More robust guessBinanceSymbol function
function guessBinanceSymbol(coinSymbol: string): string {
  // Special cases where symbol needs adjustment
  switch (coinSymbol.toUpperCase()) {
    case "DOGE": return "DOGEUSDT";
    case "XRP": return "XRPUSDT";
    case "BNB": return "BNBUSDT";
    case "ADA": return "ADAUSDT";
    case "DOT": return "DOTUSDT";
    case "TRX": return "TRXUSDT";
    default: return coinSymbol.toUpperCase() + "USDT";
  }
}

// =============== MAIN DASHBOARD =============== 
export default function Dashboard() {
  // The top 10 cryptos from CoinCap 
  const [cryptoData, setCryptoData] = useState<CryptoInfo[]>([]);
  // Chart data for the first 5 
  const [chartData, setChartData] = useState<Record<string, KlineData[]>>({});
  // Basic states 
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [wsConnected, setWsConnected] = useState(false);
  const [lastUpdated, setLastUpdated] = useState("");

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const reconnectAttemptsRef = useRef<number>(0);
  const scheduledUpdateRef = useRef<NodeJS.Timeout | null>(null);
  const priceBufferRef = useRef<Record<string, number>>({});

  // ========== 1) Fetch top 10 from CoinCap ========== 
  const fetchTopCoins = async () => {
    try {
      setLoading(true);
      setError(null);

      // We'll fetch the top 15 or 20, then slice the first 10 
      const resp = await axios.get("https://api.coincap.io/v2/assets", {
        params: { limit: 15 },
        timeout: 10000,
      });
      if (!resp.data?.data) throw new Error("No data from CoinCap");
      const raw = resp.data.data as CoinCapAsset[];

      // Sort by rank or by market cap, up to top 10 
      // Some times the order from the API is already sorted by rank 
      // We'll just trust it for simplicity, or sort explicitly 
      // raw.sort(...) if needed 
      const top10 = raw.slice(0, MAX_COINS).map((coin) => ({
        id: coin.id,
        symbol: coin.symbol,
        name: coin.name,
        price: parseFloat(coin.priceUsd),
        changePercent24h: parseFloat(coin.changePercent24Hr),
        volume24h: parseFloat(coin.volumeUsd24Hr),
        marketCap: parseFloat(coin.marketCapUsd),
      }));
      setCryptoData(top10);
      setLoading(false);
      return top10;
    } catch (err: any) {
      setLoading(false);
      setError(err.message || "Error fetching top coins");
      throw err;
    }
  };

  // ========== 2) Fetch 5-hour historical data for a coin by ID ========== 
  const fetchHistory = async (coinId: string): Promise<KlineData[]> => {
    try {
      const end = Date.now();
      const start = end - CHART_RANGE_HOURS * 60 * 60 * 1000; // 5 hours in ms 
      const resp = await axios.get(`https://api.coincap.io/v2/assets/${coinId}/history`, {
        params: {
          interval: "h1",
          start,
          end,
        },
        timeout: 10000,
      });
      if (!resp.data?.data) return [];
      return resp.data.data.map((point: any) => ({
        time: formatTime(point.time),
        price: parseFloat(point.priceUsd),
      }));
    } catch (err) {
      console.error("Error fetching history for", coinId, err);
      return [];
    }
  };

  // Improved fetchAllData to handle empty responses
  const fetchAllData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      // 1) top 10 for table
      const top10 = await fetchTopCoins();
      
      if (!top10 || top10.length === 0) {
        setError("No cryptocurrency data available");
        setLoading(false);
        return;
      }

      // 2) from those 10, take first 5 for chart
      const chartSlice = top10.slice(0, MAX_CHARTS);
      const promises = chartSlice.map((coin) => fetchHistory(coin.id));
      const results = await Promise.all(promises);

      const newChartData: Record<string, KlineData[]> = {};
      chartSlice.forEach((coin, idx) => {
        newChartData[coin.id] = results[idx] || [];
      });
      
      setChartData(newChartData);
      setLastUpdated(new Date().toLocaleTimeString());
      setLoading(false);
    } catch (err: any) {
      console.error("Error in fetchAllData:", err);
      setError(err?.message || "Failed to fetch cryptocurrency data");
      setLoading(false);
    }
  }, []);

  // ========== 4) WebSocket updates via Binance for only the first 5 coins ========== 

  // Merge buffered updates into state 
  const applyPriceUpdates = useCallback((updates: Record<string, number>) => {
    if (Object.keys(updates).length === 0) return;

    // Update the table data 
    setCryptoData((prev) => {
      return prev.map((coin) => {
        if (updates[coin.id] != null) {
          return { ...coin, price: updates[coin.id] };
        }
        return coin;
      });
    });

    // Optionally add data points to chart 
    setChartData((prev) => {
      const next = { ...prev };
      for (const [coinId, newPrice] of Object.entries(updates)) {
        if (next[coinId]) {
          const nowPoint = {
            time: formatTime(Date.now()),
            price: newPrice,
          };
          const arr = [...next[coinId], nowPoint];
          if (arr.length > MAX_CHART_POINTS) arr.shift();
          next[coinId] = arr;
        }
      }
      return next;
    });

    setLastUpdated(new Date().toLocaleTimeString());
  }, []);

  // Improved WebSocket connection function that handles empty data
  const connectWebSocket = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    
    if (wsRef.current) {
      try {
        wsRef.current.onclose = null;
        wsRef.current.close();
      } catch (err) {
        console.error("Error closing WebSocket:", err);
      }
      wsRef.current = null;
    }
    
    // Extract the first 5 from cryptoData
    const slice5 = cryptoData.slice(0, MAX_CHARTS);
    if (slice5.length === 0) {
      console.log("No crypto data available for WebSocket connection");
      return;
    }

    // Build stream list
    const streams = slice5.map((coin) => {
      const binanceSymbol = guessBinanceSymbol(coin.symbol);
      return binanceSymbol.toLowerCase() + "@ticker";
    });
    
    const url = `wss://stream.binance.com:9443/stream?streams=${streams.join("/")}`;
    console.log("Connecting Binance WS ->", url);

    try {
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log("Binance WS connected");
        setWsConnected(true);
        reconnectAttemptsRef.current = 0;
      };

      ws.onmessage = (evt) => {
        try {
          const parsed = JSON.parse(evt.data);
          if (!parsed?.data?.s) return;
          
          // Find the coin by matching the Binance symbol
          const binSym = parsed.data.s;
          const coin = cryptoData.find((c) => guessBinanceSymbol(c.symbol) === binSym);
          
          if (!coin) {
            console.log(`No matching coin found for symbol ${binSym}`);
            return;
          }

          const priceNum = parseFloat(parsed.data.c);
          if (!isNaN(priceNum)) {
            priceBufferRef.current[coin.id] = priceNum;
            
            if (!scheduledUpdateRef.current) {
              scheduledUpdateRef.current = setTimeout(() => {
                const updates = { ...priceBufferRef.current };
                priceBufferRef.current = {};
                scheduledUpdateRef.current = null;
                applyPriceUpdates(updates);
              }, WS_UPDATE_INTERVAL);
            }
          }
        } catch (err) {
          console.error("Error parsing WS message:", err);
        }
      };

      ws.onerror = (err) => {
        console.error("Binance WS error:", err);
        setWsConnected(false);
      };

      ws.onclose = (e) => {
        console.log("Binance WS closed", e.code, e.reason);
        setWsConnected(false);

        // Don't try to reconnect if component is unmounting
        if (wsRef.current === null) return;
        
        if (reconnectAttemptsRef.current >= 10) {
          console.log("Max WS reconnect attempts reached, stopping.");
          return;
        }
        
        reconnectAttemptsRef.current += 1;
        const delay = Math.min(60000, 2000 * Math.pow(1.5, reconnectAttemptsRef.current));
        
        console.log(`Will attempt reconnection in ${delay/1000} seconds`);
        
        reconnectTimerRef.current = window.setTimeout(() => {
          reconnectTimerRef.current = null;
          connectWebSocket();
        }, delay);
      };
    } catch (err) {
      console.error("Error creating WebSocket:", err);
      setWsConnected(false);
    }
  }, [cryptoData, applyPriceUpdates]);

  // ========== 5) Manual refresh ========== 
  const handleRefresh = useCallback(() => {
    fetchAllData().then(() => {
      if (!wsConnected) connectWebSocket();
    });
  }, [fetchAllData, wsConnected, connectWebSocket]);

  // ========== 6) On mount, fetch & connect ========== 
  useEffect(() => {
    fetchAllData().then(() => {
      connectWebSocket();
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
  }, [fetchAllData, connectWebSocket]);

  // ========== RENDER ========== 
  return (
    <div className="w-full max-w-7xl mx-auto p-4">
      {/* Header */} 
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-3xl font-bold">Crypto Dashboard</h1>
          <p className="text-muted-foreground">
            Dynamically shows top 10 (CoinCap) & charts top 5 with 5h data, live from Binance
          </p>
        </div>
        <div className="flex items-center gap-4">
          {/* WebSocket status */} 
          <div className={cn("flex items-center gap-2 text-sm", wsConnected ? "text-green-500" : "text-red-500")}>
            <span className={cn("inline-block w-2 h-2 rounded-full", wsConnected ? "bg-green-500" : "bg-red-500")} />
            {wsConnected ? "Connected" : "Disconnected"}
          </div>

          {/* Refresh */} 
          <Button variant="outline" size="sm" onClick={handleRefresh} disabled={loading}>
            <RefreshCw className={cn("h-4 w-4 mr-2", loading && "animate-spin")} />
            Refresh
          </Button>

          {/* Last updated */} 
          <div className="text-sm text-muted-foreground">
            Last updated: {lastUpdated || "Never"}
          </div>

          {/* Mode toggle */} 
          <ModeToggle />
        </div>
      </div>

      {/* Error display */} 
      {error && (
        <Card className="mb-6 border-red-500">
          <CardContent className="p-4 text-red-500">
            {error}
          </CardContent>
        </Card>
      )}

      {/* Chart area for top 5 */} 
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
        {loading && cryptoData.length === 0 ? (
          // Show placeholders if no data yet 
          Array(MAX_CHARTS).fill(null).map((_, i) => (
            <Card key={i} className="overflow-hidden">
              <CardHeader className="p-4 animate-pulse">
                <div className="h-6 bg-muted rounded w-1/3 mb-2" />
                <div className="h-4 bg-muted rounded w-1/4" />
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
                      <CardDescription className="text-sm uppercase">{coin.symbol}</CardDescription>
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
                      <AreaChart data={data} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
                        <defs>
                          <linearGradient id={`gradient-${coin.id}`} x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor={coin.changePercent24h >= 0 ? "#22c55e" : "#ef4444"} stopOpacity={0.8}/>
                            <stop offset="95%" stopColor={coin.changePercent24h >= 0 ? "#22c55e" : "#ef4444"} stopOpacity={0}/>
                          </linearGradient>
                        </defs>
                        <Area
                          type="monotone"
                          dataKey="price"
                          stroke={coin.changePercent24h >= 0 ? "#22c55e" : "#ef4444"}
                          fillOpacity={1}
                          fill={`url(#gradient-${coin.id})`}
                        />
                        <Tooltip
                          content={({ active, payload }) => {
                            if (active && payload && payload.length > 0) {
                              const val = payload[0].value as number;
                              const time = payload[0].payload?.time || "N/A";
                              return (
                                <div className="bg-background border border-border p-2 rounded-md text-xs">
                                  <p className="mb-1">{time}</p>
                                  <p className="font-medium">{formatCurrency(val)}</p>
                                </div>
                              );
                            }
                            return null;
                          }}
                        />
                      </AreaChart>
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

      {/* Table for all top 10 */} 
      <Card>
        <CardHeader>
          <CardTitle>Top 10 Cryptocurrencies</CardTitle>
          <CardDescription>Showing dynamic results from CoinCap. Icons from Font Awesome.</CardDescription>
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
                    // pick icon from our map or fallback 
                    const iconFA = ICON_MAP[coin.id] || faCoins;
                    return (
                      <tr key={coin.id} className="border-b hover:bg-muted/30">
                        <td className="px-4 py-3 flex items-center gap-2">
                          {/* Font Awesome icon for the coin */} 
                          <FontAwesomeIcon icon={iconFA} />
                          <span className="font-medium text-base">{coin.symbol.toUpperCase()}</span>
                        </td>
                        <td className="px-4 py-3">{coin.name}</td>
                        <td className="px-4 py-3 font-medium">
                          {formatCurrency(coin.price)}
                        </td>
                        <td className="px-4 py-3">
                          <div className={cn("flex items-center", isUp ? "text-green-500" : "text-red-500")}>
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
            Live updates from Binance WebSocket every 2s (for top 5). 
            Font Awesome icons – ensure you have <code>@fortawesome</code> set up.
          </p>
        </CardFooter>
      </Card>
    </div>
  );
}
