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
  timeframe: "24h" | "1w" | "1m" | "1y" | "all";
  isMobile?: boolean;
}

export function PortfolioChart({ data, timeframe, isMobile = false }: PortfolioChartProps) {
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
    const dateValue = item.date || item.timestamp;
    const dateObj =
      typeof dateValue === "string" ? new Date(dateValue) : dateValue;

    return {
      ...item,
      timestamp: dateObj,
      // Ensure we have the required values
      totalValue: item.totalValue || item.value || 0,
      paperBalance: item.paperBalance || 0,
      total: (item.totalValue || item.value || 0) + (item.paperBalance || 0),
    };
  });

  const formatXAxis = (timestamp: Date) => {
    if (
      !timestamp ||
      !(timestamp instanceof Date) ||
      isNaN(timestamp.getTime())
    ) {
      return "";
    }

    if (timeframe === "24h") {
      return timestamp.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      });
    } else if (timeframe === "1w" || timeframe === "1m") {
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

    if (timeframe === "24h") {
      return timestamp.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      });
    } else if (timeframe === "1w" || timeframe === "1m") {
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

      return (
        <Card className="p-2 bg-background border shadow-md">
          <p className="text-sm font-medium">{formatTooltipDate(label)}</p>
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
            bottom: 0 
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
            tickFormatter={formatXAxis}
            tick={{ fontSize: isMobile ? 10 : 12 }}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            tickFormatter={(value) => isMobile ? `$${(value/1000).toFixed(0)}k` : `$${value.toLocaleString()}`}
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
