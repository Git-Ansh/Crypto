import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface QuickTradeProps {
  selectedCurrency: string;
  currentPrice: number;
  onBuy: (amount: number, currency: string) => void;
  onSell: (amount: number, currency: string) => void;
  balance: number;
  onTradeComplete: () => void;
}

export function QuickTrade({
  selectedCurrency,
  currentPrice,
  onBuy,
  onSell,
  balance,
  onTradeComplete,
}: QuickTradeProps) {
  const [amount, setAmount] = useState<string>("0.01");
  const [tradeTab, setTradeTab] = useState<string>("buy");

  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setAmount(e.target.value);
  };

  const handleQuickBuy = () => {
    const numAmount = parseFloat(amount);
    if (!isNaN(numAmount) && numAmount > 0) {
      onBuy(numAmount, selectedCurrency);
    }
  };

  const handleQuickSell = () => {
    const numAmount = parseFloat(amount);
    if (!isNaN(numAmount) && numAmount > 0) {
      onSell(numAmount, selectedCurrency);
    }
  };

  const totalValue = parseFloat(amount) * currentPrice;

  return (
    <Card>
      <CardHeader className="p-3 sm:p-4 pb-0">
        <CardTitle className="text-base sm:text-lg">Quick Trade</CardTitle>
      </CardHeader>
      <CardContent className="p-3 sm:p-4">
        <p className="text-xs sm:text-sm mb-3">
          Instantly buy or sell the currently selected currency.
        </p>

        <Tabs value={tradeTab} onValueChange={setTradeTab} className="w-full">
          <TabsList className="grid w-full grid-cols-2 mb-4">
            <TabsTrigger value="buy">Buy</TabsTrigger>
            <TabsTrigger value="sell">Sell</TabsTrigger>
          </TabsList>

          <TabsContent value="buy" className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="buy-amount">Amount ({selectedCurrency})</Label>
              <Input
                id="buy-amount"
                type="number"
                value={amount}
                onChange={handleAmountChange}
                step="0.001"
                min="0.001"
              />
              <div className="text-xs text-muted-foreground">
                ≈ ${totalValue.toFixed(2)} USD
              </div>
            </div>
            <Button className="w-full" onClick={handleQuickBuy}>
              Buy {selectedCurrency}
            </Button>
          </TabsContent>

          <TabsContent value="sell" className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="sell-amount">Amount ({selectedCurrency})</Label>
              <Input
                id="sell-amount"
                type="number"
                value={amount}
                onChange={handleAmountChange}
                step="0.001"
                min="0.001"
              />
              <div className="text-xs text-muted-foreground">
                ≈ ${totalValue.toFixed(2)} USD
              </div>
            </div>
            <Button
              className="w-full"
              variant="destructive"
              onClick={handleQuickSell}
            >
              Sell {selectedCurrency}
            </Button>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
