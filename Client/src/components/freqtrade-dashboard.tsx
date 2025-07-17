// FreqTrade Dashboard Integration Component
import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { useDashboardFreqTrade } from '@/hooks/use-dashboard-freqtrade';

const formatCurrency = (amount: number) => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(amount);
};

export const FreqTradeDashboard: React.FC = () => {
  const freqTrade = useDashboardFreqTrade();

  if (freqTrade.portfolioLoading) {
    return (
      <Card className="w-full">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-gray-400 animate-pulse" />
            FreqTrade Bot Manager
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="animate-pulse space-y-4">
            <div className="h-4 bg-gray-200 rounded w-3/4"></div>
            <div className="h-4 bg-gray-200 rounded w-1/2"></div>
            <div className="h-4 bg-gray-200 rounded w-2/3"></div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!freqTrade.portfolio && !freqTrade.isConnected) {
    return (
      <Card className="w-full">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-red-500" />
            FreqTrade Bot Manager
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8">
            <p className="text-muted-foreground mb-4">
              {freqTrade.portfolioError || 'Unable to connect to FreqTrade service'}
            </p>
            <Button onClick={() => freqTrade.refreshData()} variant="outline">
              Retry Connection
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Connection Status & Portfolio Overview */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <div
              className={cn(
                "w-2 h-2 rounded-full",
                freqTrade.isConnected ? "bg-green-500" : "bg-red-500"
              )}
            />
            FreqTrade Portfolio
            {freqTrade.lastUpdate && (
              <span className="text-xs text-muted-foreground ml-auto">
                Updated: {freqTrade.lastUpdate.toLocaleTimeString()}
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {freqTrade.portfolio && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="text-center">
                <p className="text-sm text-muted-foreground">Portfolio Value</p>
                <p className="text-2xl font-bold">
                  {formatCurrency(freqTrade.portfolio.totalValue)}
                </p>
              </div>
              <div className="text-center">
                <p className="text-sm text-muted-foreground">Total P&L</p>
                <p className={cn(
                  "text-2xl font-bold",
                  freqTrade.portfolio.totalPnL >= 0 ? "text-green-600" : "text-red-600"
                )}>
                  {formatCurrency(freqTrade.portfolio.totalPnL)}
                </p>
              </div>
              <div className="text-center">
                <p className="text-sm text-muted-foreground">Active Bots</p>
                <p className="text-2xl font-bold">
                  {freqTrade.portfolio.activeBots}/{freqTrade.portfolio.botCount}
                </p>
              </div>
              <div className="text-center">
                <p className="text-sm text-muted-foreground">Daily P&L</p>
                <p className={cn(
                  "text-2xl font-bold",
                  freqTrade.portfolio.dailyPnL >= 0 ? "text-green-600" : "text-red-600"
                )}>
                  {formatCurrency(freqTrade.portfolio.dailyPnL)}
                </p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Active Bots */}
      <Card>
        <CardHeader>
          <CardTitle>Trading Bots</CardTitle>
        </CardHeader>
        <CardContent>
          {freqTrade.bots.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">
              No trading bots configured
            </p>
          ) : (
            <div className="space-y-4">
              {freqTrade.bots.map((bot) => (
                <div
                  key={bot.id}
                  className="flex items-center justify-between p-4 border rounded-lg"
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={cn(
                        "w-3 h-3 rounded-full",
                        bot.active ? "bg-green-500" : "bg-red-500"
                      )}
                    />
                    <div>
                      <h4 className="font-medium">{bot.name}</h4>
                      <p className="text-sm text-muted-foreground">
                        Status: {bot.status}
                      </p>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <p className="text-sm text-muted-foreground">Balance</p>
                      <p className="font-medium">{formatCurrency(bot.balance)}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm text-muted-foreground">P&L</p>
                      <p className={cn(
                        "font-medium",
                        bot.totalPnL >= 0 ? "text-green-600" : "text-red-600"
                      )}>
                        {formatCurrency(bot.totalPnL)}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm text-muted-foreground">Trades</p>
                      <p className="font-medium">{bot.openTrades} / {bot.closedTrades}</p>
                    </div>
                    
                    <Button
                      size="sm"
                      variant={bot.active ? "destructive" : "default"}
                      onClick={() => {
                        if (bot.active) {
                          freqTrade.stopBot(bot.id);
                        } else {
                          freqTrade.startBot(bot.id);
                        }
                      }}
                      disabled={!freqTrade.isConnected}
                    >
                      {bot.active ? "Stop" : "Start"}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Recent Trades */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Trades</CardTitle>
        </CardHeader>
        <CardContent>
          {freqTrade.recentTrades.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">
              No recent trades
            </p>
          ) : (
            <div className="space-y-2">
              {freqTrade.recentTrades.slice(0, 10).map((trade, index) => (
                <div
                  key={trade.id || index}
                  className="flex items-center justify-between py-2 border-b last:border-b-0"
                >
                  <div className="flex items-center gap-3">
                    <Badge
                      variant={trade.type === "BUY" ? "default" : "destructive"}
                      className="text-xs"
                    >
                      {trade.type}
                    </Badge>
                    <span className="font-medium">{trade.symbol}</span>
                  </div>
                  
                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <p className="text-sm">{trade.amount}</p>
                      <p className="text-xs text-muted-foreground">Amount</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm">{formatCurrency(trade.price)}</p>
                      <p className="text-xs text-muted-foreground">Price</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-muted-foreground">{trade.timestamp}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};
