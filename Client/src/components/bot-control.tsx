import React from "react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface BotConfig {
  active: boolean;
  strategy: string;
  riskLevel: number;
  tradesPerDay: number;
  autoRebalance: boolean;
  dcaEnabled: boolean;
}

interface BotControlProps {
  config: BotConfig | null;
  onUpdate: () => Promise<void>;
}

export function BotControl({ config, onUpdate }: BotControlProps) {
  // Use config properties inside the component
  const {
    active = false,
    strategy = "Aggressive Growth",
    riskLevel = 50,
    tradesPerDay = 8,
    autoRebalance = true,
    dcaEnabled = true,
  } = config || {};

  // Handle updates
  const handleToggleActive = () => {
    // Update logic here
    onUpdate();
  };

  // Other handlers similarly
  const handleStrategyChange = (newStrategy: string) => {
    onUpdate();
  };

  const handleRiskLevelChange = (newRiskLevel: number) => {
    onUpdate();
  };

  const handleTradesPerDayChange = (newTradesPerDay: number) => {
    onUpdate();
  };

  const handleAutoRebalanceChange = (newAutoRebalance: boolean) => {
    onUpdate();
  };

  const handleDCAEnabledChange = (newDCAEnabled: boolean) => {
    onUpdate();
  };

  return (
    <Card>
      <CardHeader className="p-3 sm:p-4 pb-0 sm:pb-0">
        <CardTitle className="text-base sm:text-lg">Bot Control</CardTitle>
      </CardHeader>
      <CardContent className="p-3 sm:p-4">
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <Label htmlFor="bot-active">Bot Active</Label>
            <Switch
              id="bot-active"
              checked={active}
              onCheckedChange={handleToggleActive}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="strategy">Trading Strategy</Label>
            <select
              id="strategy"
              value={strategy}
              onChange={(e) => handleStrategyChange(e.target.value)}
              className="w-full p-2 rounded-md border border-input bg-background"
            >
              <option value="Conservative">Conservative</option>
              <option value="Balanced">Balanced</option>
              <option value="Aggressive Growth">Aggressive Growth</option>
              <option value="Momentum">Momentum</option>
              <option value="DCA">Dollar Cost Averaging</option>
            </select>
          </div>

          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <Label htmlFor="risk-level">Risk Level</Label>
              <span className="text-xs font-medium">{riskLevel}%</span>
            </div>
            <Slider
              id="risk-level"
              min={10}
              max={90}
              step={10}
              value={[riskLevel]}
              onValueChange={(value) => handleRiskLevelChange(value[0])}
            />
          </div>

          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <Label htmlFor="trades-per-day">Trades Per Day</Label>
              <span className="text-xs font-medium">{tradesPerDay}</span>
            </div>
            <Slider
              id="trades-per-day"
              min={1}
              max={20}
              step={1}
              value={[tradesPerDay]}
              onValueChange={(value) => handleTradesPerDayChange(value[0])}
            />
          </div>

          <div className="flex items-center justify-between">
            <Label htmlFor="auto-rebalance">Auto Rebalance</Label>
            <Switch
              id="auto-rebalance"
              checked={autoRebalance}
              onCheckedChange={handleAutoRebalanceChange}
            />
          </div>

          <div className="flex items-center justify-between">
            <Label htmlFor="dca-enabled">DCA Enabled</Label>
            <Switch
              id="dca-enabled"
              checked={dcaEnabled}
              onCheckedChange={handleDCAEnabledChange}
            />
          </div>

          <Button
            className="w-full"
            variant={active ? "destructive" : "default"}
            onClick={handleToggleActive}
          >
            {active ? "Stop Bot" : "Start Bot"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
