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
  // Debug: Log what data we're receiving with generation timestamp
  const currentTime = new Date().toISOString();
  
  console.log(`🎯 [${currentTime}] PortfolioChart received data for ${timeframe}:`, {
    dataPoints: data?.length || 0,
    timeframe,
    firstPoint: data?.[0],
    lastPoint: data?.[data.length - 1],
    dataHashes: data?.slice(0, 3).map(p => ({ 
      timestamp: p?.timestamp || p?.date, 
      total: p?.total?.toFixed(2),
      _timeframe: p?._timeframe,
      _isFallback: p?._isFallback,
      _isMockData: p?._isMockData
    }))
  });

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
    if (!dateValue || !(dateValue instanceof Date) || isNaN(dateValue.getTime())) {
      dateValue = new Date();
    }

    return {
      ...item,
      timestamp: dateValue.getTime(), // Use timestamp as number for proper XAxis domain
      originalTimestamp: dateValue, // Keep original for tooltip
      // Ensure we have the required values
      totalValue: item.totalValue || item.value || 0,
      paperBalance: item.paperBalance || 0,
      total: (item.totalValue || item.value || 0) + (item.paperBalance || 0),
    };
  });

  // Sort data by timestamp to ensure chronological order
  formatData.sort((a, b) => a.timestamp - b.timestamp);

  // Debug the actual time range of data
  if (formatData.length > 0) {
    const firstTime = new Date(formatData[0].timestamp);
    const lastTime = new Date(formatData[formatData.length - 1].timestamp);
    const timeSpanMinutes = (lastTime.getTime() - firstTime.getTime()) / (1000 * 60);
    console.log(`🎯 Chart data time span for ${timeframe}: ${timeSpanMinutes.toFixed(1)} minutes`);
    console.log(`🎯 Chart first timestamp: ${firstTime.toISOString()}`);
    console.log(`🎯 Chart last timestamp: ${lastTime.toISOString()}`);
    console.log(`🎯 Chart value range: ${formatData[0].total.toFixed(2)} to ${formatData[formatData.length - 1].total.toFixed(2)}`);
  }

  const formatXAxis = (tickItem: any) => {
    let timestamp: Date;
    
    // Handle both Date objects and number timestamps
    if (typeof tickItem === 'number') {
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
      
      // Use originalTimestamp if available, otherwise convert label
      const displayDate = payload[0]?.payload?.originalTimestamp || new Date(label);

      return (
        <Card className="p-2 bg-background border shadow-md">
          <p className="text-sm font-medium">{formatTooltipDate(displayDate)}</p>
          <p className="text-sm text-green-500">
            Total: {formatCurrency(totalValue)}
          </p>
          <p className="text-sm text-blue-500">
            Portfolio: {formatCurrency(portfolioValue)}
          </p>
          <p className="text-sm text-purple-500">
            Cash: {formatCurrency(cashValue)}
          </p>
        </Card>
      );
    }
    return null;
  };

  return (
    <div className="w-full h-64">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart
          data={formatData}
          margin={{
            top: 10,
            right: isMobile ? 0 : 5,
            left: isMobile ? -15 : -10,
            bottom: 0,
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
            domain={['dataMin', 'dataMax']}
            scale="time"
            type="number"
            tickFormatter={formatXAxis}
            tick={{ fontSize: isMobile ? 10 : 12 }}
            tickLine={false}
            axisLine={false}
            allowDataOverflow={false}
          />
          <YAxis
            tickFormatter={(value) =>
              isMobile
                ? `$${(value / 1000).toFixed(0)}k`
                : `$${value.toLocaleString()}`
            }
            tick={{ fontSize: isMobile ? 10 : 12 }}
            tickLine={false}
            axisLine={false}
            width={isMobile ? 45 : 65}
          />
          <Tooltip content={<CustomTooltip />} />
          <Area
            type="monotone"
            dataKey="total"
            stroke="#10b981"
            fillOpacity={1}
            fill="url(#totalGradient)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
