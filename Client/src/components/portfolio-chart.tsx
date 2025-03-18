import React from "react";
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

interface PortfolioSnapshot {
  timestamp: string;
  totalValue: number;
  paperBalance: number;
}

interface PortfolioChartProps {
  data: PortfolioSnapshot[] | undefined;
  timeframe: "24h" | "1w" | "1m" | "1y" | "all";
}

export function PortfolioChart({ data, timeframe }: PortfolioChartProps) {
  if (!data || data.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        No portfolio data available
      </div>
    );
  }

  const formatData = data.map((item) => ({
    ...item,
    timestamp: new Date(item.timestamp),
    total: item.totalValue + item.paperBalance,
  }));

  const formatXAxis = (timestamp: Date) => {
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
      return (
        <Card className="p-2 bg-background border shadow-md">
          <p className="text-sm font-medium">{formatTooltipDate(label)}</p>
          <p className="text-sm text-green-500">
            Total: {formatCurrency(payload[0].value)}
          </p>
          <p className="text-sm text-blue-500">
            Portfolio: {formatCurrency(payload[1].payload.totalValue)}
          </p>
          <p className="text-sm text-purple-500">
            Cash: {formatCurrency(payload[1].payload.paperBalance)}
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
          margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
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
            tick={{ fontSize: 12 }}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            tickFormatter={(value) => `$${value.toLocaleString()}`}
            tick={{ fontSize: 12 }}
            tickLine={false}
            axisLine={false}
            width={80}
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
