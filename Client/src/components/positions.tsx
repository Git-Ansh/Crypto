import React from "react";
import { ArrowUp, ArrowDown } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

interface Position {
  _id: string;
  symbol: string;
  amount: number;
  averageEntryPrice: number;
  currentPrice: number;
  profitLoss: number;
  profitLossPercentage: number;
  lastUpdated: string;
}

interface PositionsProps {
  positions: Position[];
  loading?: boolean;
  onPositionUpdate: () => Promise<void>;
  onTradeComplete: () => void;
}

export function Positions({
  positions,
  loading,
  onPositionUpdate,
  onTradeComplete,
}: PositionsProps) {
  // Ensure positions is always an array
  const positionsArray = Array.isArray(positions) ? positions : [];

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(value);
  };

  const formatPercentage = (value: number) => {
    return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
  };

  return (
    <div className="w-full overflow-auto">
      {positionsArray.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground">
          No open positions
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Asset</TableHead>
              <TableHead>Amount</TableHead>
              <TableHead>Entry Price</TableHead>
              <TableHead>Current Price</TableHead>
              <TableHead>P/L</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {positionsArray.map((position) => (
              <TableRow key={position._id}>
                <TableCell className="font-medium text-xs py-2">
                  {position.symbol}
                </TableCell>
                <TableCell className="text-xs py-2">
                  {position.amount.toFixed(6)}
                </TableCell>
                <TableCell className="text-xs py-2">
                  {formatCurrency(position.averageEntryPrice)}
                </TableCell>
                <TableCell className="text-xs py-2">
                  {formatCurrency(position.currentPrice)}
                </TableCell>
                <TableCell className="text-right text-xs py-2">
                  <div
                    className={cn(
                      "flex items-center justify-end gap-1",
                      position.profitLoss >= 0
                        ? "text-green-600"
                        : "text-red-600"
                    )}
                  >
                    {position.profitLoss >= 0 ? (
                      <ArrowUp className="h-3 w-3" />
                    ) : (
                      <ArrowDown className="h-3 w-3" />
                    )}
                    <span>
                      {formatPercentage(position.profitLossPercentage)}
                    </span>
                  </div>
                  <div
                    className={cn(
                      "text-[10px]",
                      position.profitLoss >= 0
                        ? "text-green-600"
                        : "text-red-600"
                    )}
                  >
                    {formatCurrency(position.profitLoss)}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
