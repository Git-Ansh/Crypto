import React from "react";
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
import { ArrowUpRight, ArrowDownRight, Bot, User } from "lucide-react";

interface Trade {
  _id: string;
  type: "buy" | "sell";
  amount: number;
  symbol: string;
  price: number;
  total: number;
  executedBy: "user" | "bot";
  status: "pending" | "completed" | "failed" | "canceled";
  timestamp: string;
}

interface TradeHistoryProps {
  trades: Trade[];
}

export function TradeHistory({ trades }: TradeHistoryProps) {
  if (!trades || trades.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        No trade history available
      </div>
    );
  }

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleString([], {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Type</TableHead>
          <TableHead>Symbol</TableHead>
          <TableHead>Amount</TableHead>
          <TableHead>Price</TableHead>
          <TableHead>Total</TableHead>
          <TableHead>Date</TableHead>
          <TableHead>By</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {trades.slice(0, 10).map((trade) => (
          <TableRow key={trade._id}>
            <TableCell>
              <div className="flex items-center">
                {trade.type === "buy" ? (
                  <Badge
                    variant="outline"
                    className="bg-green-500/10 text-green-500 border-green-500/20"
                  >
                    <ArrowUpRight className="mr-1 h-3 w-3" />
                    Buy
                  </Badge>
                ) : (
                  <Badge
                    variant="outline"
                    className="bg-red-500/10 text-red-500 border-red-500/20"
                  >
                    <ArrowDownRight className="mr-1 h-3 w-3" />
                    Sell
                  </Badge>
                )}
              </div>
            </TableCell>
            <TableCell className="font-medium">{trade.symbol}</TableCell>
            <TableCell>{trade.amount.toFixed(6)}</TableCell>
            <TableCell>{formatCurrency(trade.price)}</TableCell>
            <TableCell>{formatCurrency(trade.total)}</TableCell>
            <TableCell>{formatDate(trade.timestamp)}</TableCell>
            <TableCell>
              {trade.executedBy === "bot" ? (
                <Bot className="h-4 w-4 text-blue-500" />
              ) : (
                <User className="h-4 w-4 text-purple-500" />
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
      {trades.length > 10 && (
        <TableCaption>
          Showing 10 most recent trades of {trades.length} total
        </TableCaption>
      )}
    </Table>
  );
}
