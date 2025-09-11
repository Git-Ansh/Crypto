import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";
import { Card } from "@/components/ui/card";
import { useRef } from "react";

interface PortfolioChartProps {
  data: any[];
  timeframe: "1H" | "24H" | "7D" | "30D";
  isMobile?: boolean;
}

export function PortfolioChart({
  data,
  timeframe,
  isMobile = false,
}: PortfolioChartProps) {
  // Only log when data changes or on mount
  const dataLengthRef = useRef(0);
  if (data.length !== dataLengthRef.current) {
    console.log(`📊 Chart data updated for ${timeframe}: ${data.length} points`);
    if (data.length > 0) {
      console.log(`📊 First point:`, data[0]);
      console.log(`📊 Last point:`, data[data.length - 1]);
    }
    dataLengthRef.current = data.length;
  }
  // Debug incoming data
  console.log(`🔍 Chart received data for ${timeframe}:`, data);
  if (data && data.length > 0) {
    console.log(`� First data point:`, data[0]);
    console.log(`📊 Data structure keys:`, Object.keys(data[0] || {}));
  }

  if (!data || data.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        No portfolio data available
      </div>
    );
  }

  // Process the data to ensure dates are properly formatted
  const formatData = data.map((item) => {
    // Handle both date string and Date object cases
    let dateValue = item.date || item.timestamp;

    // If it's a string, try to parse it
    if (typeof dateValue === "string") {
      dateValue = new Date(dateValue);
    }

    // If it's still not a valid date, use current time
    if (
      !dateValue ||
      !(dateValue instanceof Date) ||
      isNaN(dateValue.getTime())
    ) {
      dateValue = new Date();
    }

    // The dashboard transforms SSE data with these exact property names
    const totalValue = item.totalValue || item.portfolioValue || 0;
    const paperBalance = item.paperBalance || 0;
    const total = item.total || totalValue; // 'total' is set to portfolioValue in dashboard transformation
    
    // Reduced logging to prevent excessive console output

    return {
      ...item,
      timestamp: dateValue.getTime(), // Use timestamp as number for proper XAxis domain
      originalTimestamp: dateValue, // Keep original for tooltip
      // Ensure we have the required values
      totalValue: totalValue,
      paperBalance: paperBalance,
      total: total, // This should be the main value displayed
    };
  });

  // Sort data by timestamp to ensure chronological order
  formatData.sort((a, b) => a.timestamp - b.timestamp);

  // Minimal logging for data processing (only when data changes)
  const allTotals = formatData.map(d => d.total);
  const uniqueTotals = [...new Set(allTotals)];
  if (dataLengthRef.current !== formatData.length) {
    console.log(`📊 Unique total values: ${uniqueTotals.length} (${uniqueTotals.slice(0, 3).join(', ')}${uniqueTotals.length > 3 ? '...' : ''})`);
  }
  
  if (uniqueTotals.length === 1 && uniqueTotals[0] === 0) {
    console.warn(`⚠️ All chart values are 0 - this will create a flat line!`);
  } else if (uniqueTotals.length === 1) {
    console.warn(`⚠️ All chart values are the same (${uniqueTotals[0]}) - this will create a flat line!`);
  }

  // ULTRA-AGGRESSIVE dynamic range calculation for maximum peak/trough visibility
  const values = formatData.map(p => p.total);
  const dataMin = Math.min(...values);
  const dataMax = Math.max(...values);
  const dataRange = dataMax - dataMin || 0.01; // Minimum range to prevent division by zero

  // For very small variations, use MASSIVE padding to amplify visibility
  let paddingPercent;
  if (dataRange < 1) {
    // For sub-dollar variations, use 200-500% padding!
    paddingPercent = Math.max(2.0, Math.min(5.0, 10 / dataRange));
  } else if (dataRange < 10) {
    // For variations under $10, use 100-200% padding
    paddingPercent = Math.max(1.0, Math.min(2.0, 5 / dataRange));
  } else if (dataRange < 100) {
    // For variations under $100, use 50-100% padding
    paddingPercent = Math.max(0.5, Math.min(1.0, 2 / dataRange));
  } else {
    // For larger variations, use standard 10-30% padding
    paddingPercent = Math.max(0.1, Math.min(0.3, dataRange / dataMax));
  }

  const valuePadding = dataRange * paddingPercent;
  const minValue = dataMin - valuePadding;
  const maxValue = dataMax + valuePadding;

  // SENSITIVE peak and trough detection for even tiny variations
  const peaks: number[] = [];
  const troughs: number[] = [];

  if (formatData.length >= 3) {
    for (let i = 1; i < formatData.length - 1; i++) {
      const prev = formatData[i - 1].total;
      const curr = formatData[i].total;
      const next = formatData[i + 1].total;

      // Use percentage-based comparison for ultra-sensitive detection
      const prevDiff = Math.abs(curr - prev) / Math.max(curr, prev, 0.01);
      const nextDiff = Math.abs(curr - next) / Math.max(curr, next, 0.01);

      // Detect even 0.001% changes as peaks/troughs
      if (curr > prev && curr > next && (prevDiff > 0.00001 || nextDiff > 0.00001)) {
        peaks.push(i);
      } else if (curr < prev && curr < next && (prevDiff > 0.00001 || nextDiff > 0.00001)) {
        troughs.push(i);
      }
    }
  }

  // Add peak/trough markers to data
  const enhancedData = formatData.map((item, index) => ({
    ...item,
    isPeak: peaks.includes(index) || item.total === dataMax,
    isTrough: troughs.includes(index) || item.total === dataMin,
    isMax: item.total === dataMax,
    isMin: item.total === dataMin,
  }));

  // Calculate trend information
  const firstValue = formatData[0]?.total || 0;
  const lastValue = formatData[formatData.length - 1]?.total || 0;
  const totalChange = lastValue - firstValue;
  const percentChange = firstValue !== 0 ? ((totalChange / firstValue) * 100) : 0;

  // Minimal debug for value range
  if (formatData.length > 0 && formatData[0].total === 0) {
    console.log(`⚠️ Chart data has zero values for ${timeframe}`);
  }

  const formatXAxis = (tickItem: any) => {
    let timestamp: Date;

    // Handle both Date objects and number timestamps
    if (typeof tickItem === "number") {
      timestamp = new Date(tickItem);
    } else if (tickItem instanceof Date) {
      timestamp = tickItem;
    } else {
      return "";
    }

    if (!timestamp || isNaN(timestamp.getTime())) {
      return "";
    }

    if (timeframe === "1H" || timeframe === "24H") {
      return timestamp.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      });
    } else if (timeframe === "7D" || timeframe === "30D") {
      return timestamp.toLocaleDateString([], {
        month: "short",
        day: "numeric",
      });
    } else {
      return timestamp.toLocaleDateString([], {
        month: "short",
        year: "2-digit",
      });
    }
  };

  const formatTooltipDate = (timestamp: Date) => {
    if (
      !timestamp ||
      !(timestamp instanceof Date) ||
      isNaN(timestamp.getTime())
    ) {
      return "Unknown date";
    }

    if (timeframe === "1H" || timeframe === "24H") {
      return timestamp.toLocaleString([], {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } else if (timeframe === "7D" || timeframe === "30D") {
      return timestamp.toLocaleDateString([], {
        weekday: "short",
        month: "short",
        day: "numeric",
      });
    } else {
      return timestamp.toLocaleDateString([], {
        month: "long",
        year: "numeric",
      });
    }
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  };

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      // Safely access payload data with null checks
      const totalValue = payload[0]?.value || 0;
      const portfolioValue = payload[0]?.payload?.totalValue || 0;
      const cashValue = payload[0]?.payload?.paperBalance || 0;
      const pointData = payload[0]?.payload;

      // Use originalTimestamp if available, otherwise convert label
      const displayDate =
        payload[0]?.payload?.originalTimestamp || new Date(label);

      return (
        <Card className="p-3 bg-background border shadow-lg">
          <p className="text-sm font-medium mb-2">
            {formatTooltipDate(displayDate)}
          </p>
          <div className="space-y-1">
            <p className="text-sm text-green-500 font-medium">
              Total: {formatCurrency(totalValue)}
              {pointData?.isMax && <span className="ml-1 text-xs">📈 MAX</span>}
              {pointData?.isMin && <span className="ml-1 text-xs">📉 MIN</span>}
            </p>
            <p className="text-sm text-blue-500">
              Portfolio: {formatCurrency(portfolioValue)}
            </p>
            <p className="text-sm text-purple-500">
              Cash: {formatCurrency(cashValue)}
            </p>
            {pointData?.isLive && (
              <p className="text-xs text-green-600 font-bold">🔴 LIVE - Current Balance</p>
            )}
            {pointData?.isPeak && !pointData?.isMax && (
              <p className="text-xs text-green-600">🔺 Local Peak</p>
            )}
            {pointData?.isTrough && !pointData?.isMin && (
              <p className="text-xs text-red-600">🔻 Local Trough</p>
            )}
          </div>
        </Card>
      );
    }
    return null;
  };

  // Dynamic decimal places based on value range
  const decimals = dataRange < 10 ? 3 : dataRange < 100 ? 2 : 1;

  return (
    <div className="w-full h-64 relative">
      {/* Statistics overlay */}
      <div className="absolute top-2 right-2 z-10 text-xs text-muted-foreground bg-background/80 backdrop-blur-sm rounded p-2">
        <div className="space-y-1">
          <div>Range: ${(dataMax - dataMin).toFixed(2)}</div>
          <div>Peaks: {peaks.length} | Troughs: {troughs.length}</div>
          <div className={`${totalChange >= 0 ? 'text-green-600' : 'text-red-600'}`}>
            {totalChange >= 0 ? '↗' : '↘'} {percentChange.toFixed(2)}%
          </div>
        </div>
      </div>

      <ResponsiveContainer width="100%" height="100%">
        <AreaChart
          data={enhancedData}
          margin={{
            top: 15,
            right: isMobile ? 80 : 90,
            left: isMobile ? -15 : -10,
            bottom: 5,
          }}
        >
          <defs>
            <linearGradient id="totalGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#10b981" stopOpacity={0.8} />
              <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" opacity={0.1} />
          <XAxis
            dataKey="timestamp"
            domain={["dataMin", "dataMax"]}
            scale="time"
            type="number"
            tickFormatter={formatXAxis}
            tick={{ fontSize: isMobile ? 10 : 12 }}
            tickLine={false}
            axisLine={false}
            allowDataOverflow={false}
          />
          <YAxis
            domain={[minValue, maxValue]}
            tickFormatter={(value) => {
              const formattedValue = isMobile
                ? value > 1000 
                  ? `$${(value / 1000).toFixed(1)}k`
                  : `$${value.toFixed(decimals)}`
                : `$${value.toFixed(decimals)}`;
              return formattedValue;
            }}
            tick={{ fontSize: isMobile ? 10 : 12 }}
            tickLine={false}
            axisLine={false}
            width={isMobile ? 50 : 70}
          />
          <Tooltip content={<CustomTooltip />} />
          <Area
            type="monotone"
            dataKey="total"
            stroke="#10b981"
            strokeWidth={2}
            fillOpacity={1}
            fill="url(#totalGradient)"
            dot={(props: any) => {
              const { cx, cy, payload } = props;
              
              // Live point gets special highlighting (always the rightmost point)
              if (payload?.isLive) {
                return (
                  <g>
                    <circle
                      cx={cx}
                      cy={cy}
                      r={6}
                      fill="#10b981"
                      stroke="#065f46"
                      strokeWidth={2}
                    />
                    <circle
                      cx={cx}
                      cy={cy}
                      r={3}
                      fill="#ffffff"
                      stroke="none"
                    />
                    <text
                      x={cx}
                      y={cy - 10}
                      textAnchor="middle"
                      fontSize="10"
                      fill="#10b981"
                      fontWeight="bold"
                    >
                      LIVE
                    </text>
                  </g>
                );
              }
              
              // Show all dots with different styles for peaks/troughs
              if (payload?.isPeak || payload?.isMax) {
                return (
                  <circle
                    cx={cx}
                    cy={cy}
                    r={4}
                    fill="#10b981"
                    stroke="#065f46"
                    strokeWidth={2}
                  />
                );
              } else if (payload?.isTrough || payload?.isMin) {
                return (
                  <circle
                    cx={cx}
                    cy={cy}
                    r={4}
                    fill="#ef4444"
                    stroke="#991b1b"
                    strokeWidth={2}
                  />
                );
              }
              
              // Regular data points
              return (
                <circle
                  cx={cx}
                  cy={cy}
                  r={2}
                  fill="#10b981"
                  stroke="#065f46"
                  strokeWidth={1}
                  opacity={0.7}
                />
              );
            }}
            activeDot={{ r: 6, stroke: "#10b981", strokeWidth: 2 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
