import React, { useState, useEffect, useRef } from 'react';
import { TableRow, TableCell } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { freqTradeSSEService } from '@/lib/freqtrade-sse-service';

// Position data structure matching streaming client
interface Position {
  botId: string;
  pair: string;
  side: 'buy' | 'sell';
  amount: number;
  entryPrice: number;
  currentPrice: number;
  pnl: number;
  pnlPercent: number;
  mode: string;
  lastUpdate: string;
}

interface PositionsTableProps {
  isConnected: boolean;
}

export const PositionsTable: React.FC<PositionsTableProps> = ({ 
  isConnected
}) => {
  const [positions, setPositions] = useState<Position[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const lastPositionsRef = useRef<Map<string, any>>(new Map());

  // Fetch positions from API
  const fetchPositions = async () => {
    try {
      const positionsData = await freqTradeSSEService.fetchPositions();
      console.log('📈 Positions data received:', positionsData);
      
      if (Array.isArray(positionsData)) {
        setPositions(positionsData);
        setError(null);
      } else {
        console.warn('Invalid positions data format:', positionsData);
        setPositions([]);
      }
    } catch (err) {
      console.error('Failed to fetch positions:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch positions');
      setPositions([]);
    } finally {
      setLoading(false);
    }
  };

  // Set up SSE connection for real-time position updates
  useEffect(() => {
    if (!isConnected) return;

    console.log('🔌 Setting up positions SSE listeners...');

    // Subscribe to positions updates from the FreqTrade SSE service
    const unsubscribePositions = freqTradeSSEService.on('positions_update', (positionsData: Position[]) => {
      console.log('📈 Live positions update received:', positionsData);
      if (Array.isArray(positionsData)) {
        setPositions(positionsData);
        setError(null);
        setLoading(false);
      }
    });

    // Subscribe to portfolio updates which may contain position data
    const unsubscribePortfolio = freqTradeSSEService.on('portfolio_update', (data: any) => {
      // Check if portfolio data contains position information
      if (data.positions && Array.isArray(data.positions)) {
        console.log('📈 Positions from portfolio update:', data.positions);
        setPositions(data.positions);
        setError(null);
        setLoading(false);
      }
    });

    // Initial fetch
    fetchPositions();

    return () => {
      unsubscribePositions();
      unsubscribePortfolio();
    };
  }, [isConnected]);

  // Format currency
  const formatCurrency = (value: number, decimals: number = 4): string => {
    return `$${value.toFixed(decimals)}`;
  };

  // Check if position has changed
  const hasPositionChanged = (position: Position): boolean => {
    const posKey = `${position.botId}-${position.pair}`;
    const lastPos = lastPositionsRef.current.get(posKey);
    
    const hasChanged = !lastPos || 
      lastPos.currentPrice !== position.currentPrice || 
      lastPos.pnl !== position.pnl;
    
    if (hasChanged) {
      lastPositionsRef.current.set(posKey, {
        currentPrice: position.currentPrice,
        pnl: position.pnl,
        timestamp: Date.now()
      });
    }
    
    return hasChanged;
  };

  if (!isConnected) {
    return (
      <TableRow>
        <TableCell
          colSpan={10}
          className="text-center text-xs py-4 text-muted-foreground"
        >
          <div className="flex flex-col items-center gap-1">
            <div className="w-3 h-3 border-2 border-gray-300 border-t-transparent rounded-full animate-spin"></div>
            <span>Connecting to live data...</span>
          </div>
        </TableCell>
      </TableRow>
    );
  }

  if (loading) {
    return (
      <TableRow>
        <TableCell
          colSpan={10}
          className="text-center text-xs py-4 text-muted-foreground"
        >
          <div className="flex flex-col items-center gap-1">
            <div className="w-3 h-3 border-2 border-gray-300 border-t-transparent rounded-full animate-spin"></div>
            <span>Loading positions...</span>
          </div>
        </TableCell>
      </TableRow>
    );
  }

  if (error) {
    return (
      <TableRow>
        <TableCell
          colSpan={10}
          className="text-center text-xs py-4 text-red-500"
        >
          <div className="flex flex-col items-center gap-1">
            <span>❌ {error}</span>
            <button 
              onClick={fetchPositions}
              className="text-xs text-blue-500 hover:text-blue-700 underline"
            >
              Retry
            </button>
          </div>
        </TableCell>
      </TableRow>
    );
  }

  if (positions.length === 0) {
    return (
      <TableRow>
        <TableCell
          colSpan={10}
          className="text-center text-xs py-4 text-muted-foreground"
        >
          No active positions
        </TableCell>
      </TableRow>
    );
  }

  return (
    <>
      {positions.map((position) => {
        const isProfit = position.pnl >= 0;
        const pnlClass = isProfit 
          ? "text-green-600 dark:text-green-400" 
          : "text-red-600 dark:text-red-400";
        
        const hasChanged = hasPositionChanged(position);
        const updateTime = new Date().toLocaleTimeString();
        const priceChange = hasChanged ? '📈' : '';

        return (
          <TableRow 
            key={`${position.botId}-${position.pair}`}
            className={cn(
              hasChanged && "bg-green-50/50 dark:bg-green-950/20 animate-pulse"
            )}
            style={hasChanged ? { 
              background: 'linear-gradient(90deg, rgba(40,167,69,0.2) 0%, transparent 100%)',
              animation: 'pulse 1s ease-in-out'
            } : {}}
          >
            <TableCell className="text-xs py-2 font-medium">
              {position.botId || 'N/A'}
            </TableCell>
            <TableCell className="text-xs py-2 font-mono">
              {position.pair || 'N/A'}
            </TableCell>
            <TableCell className="text-xs py-2 capitalize">
              <Badge 
                variant={position.side === 'buy' ? 'default' : 'secondary'}
                className="text-[10px] px-1.5 py-0.5"
              >
                {position.side || 'N/A'}
              </Badge>
            </TableCell>
            <TableCell className="text-right text-xs py-2 font-mono">
              {position.amount?.toFixed(4) || '0.0000'}
            </TableCell>
            <TableCell className="text-right text-xs py-2 font-mono">
              {formatCurrency(position.entryPrice || 0)}
            </TableCell>
            <TableCell 
              className={cn(
                "text-right text-xs py-2 font-mono font-bold",
                hasChanged && "price-change"
              )}
              title={`Live market price - Last updated: ${updateTime}`}
            >
              <div className="flex items-center justify-end gap-1">
                {priceChange && <span>{priceChange}</span>}
                <span>{formatCurrency(position.currentPrice || 0)}</span>
                {hasChanged && (
                  <span className="text-green-500 text-[10px] animate-blink">🔴</span>
                )}
              </div>
            </TableCell>
            <TableCell 
              className={cn(
                "text-right text-xs py-2 font-mono font-bold",
                pnlClass,
                hasChanged && "pnl-change"
              )}
              title={`Calculated from live market price - Last updated: ${updateTime}`}
            >
              <div className="flex items-center justify-end gap-1">
                {hasChanged && (
                  <span className="text-blue-500 text-[10px]">🔄</span>
                )}
                <span>
                  {isProfit ? '+' : ''}{formatCurrency(position.pnl || 0, 2)}
                </span>
                {hasChanged && (
                  <span className="text-orange-500 text-[8px] animate-blink">⚡</span>
                )}
              </div>
            </TableCell>
            <TableCell className={cn("text-right text-xs py-2", pnlClass)}>
              {isProfit ? '+' : ''}{(position.pnlPercent || 0).toFixed(2)}%
            </TableCell>
            <TableCell className="text-center text-xs py-2">
              <Badge 
                variant="outline" 
                className="text-[10px] px-2 py-0.5 bg-green-500/10 text-green-600 border-green-500/20"
              >
                <div className="w-1.5 h-1.5 bg-green-500 rounded-full mr-1 animate-pulse"></div>
                DRY-RUN
              </Badge>
            </TableCell>
            <TableCell className="text-center text-xs py-2 text-muted-foreground">
              <div className="flex flex-col items-center">
                <span className="text-[10px]">
                  {hasChanged ? '🔄' : '⏸'} {updateTime}
                </span>
              </div>
            </TableCell>
          </TableRow>
        );
      })}
    </>
  );
};

export default PositionsTable;
