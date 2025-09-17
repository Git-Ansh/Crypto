// Strategy selector component for bot strategy management
import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { ChevronDown, Save, Loader2 } from 'lucide-react';
import { useStrategyManagement } from '@/hooks/use-strategy-management';
import { cn } from '@/lib/utils';

interface StrategySelectorProps {
  botInstanceId: string | null;
  onStrategyChange?: (newStrategy: string, success: boolean) => void;
  className?: string;
}

export const StrategySelector: React.FC<StrategySelectorProps> = ({ 
  botInstanceId, 
  onStrategyChange,
  className 
}) => {
  const { strategies, loading, error, getBotStrategy, updateBotStrategy, clearError } = useStrategyManagement();
  const [currentStrategy, setCurrentStrategy] = useState<string>('');
  const [selectedStrategy, setSelectedStrategy] = useState<string>('');
  const [updating, setUpdating] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  // Load current strategy when bot changes
  useEffect(() => {
    if (botInstanceId) {
      loadCurrentStrategy();
    } else {
      setCurrentStrategy('');
      setSelectedStrategy('');
      setHasChanges(false);
    }
  }, [botInstanceId]);

  // Update hasChanges when selection changes
  useEffect(() => {
    setHasChanges(selectedStrategy !== currentStrategy && selectedStrategy !== '');
  }, [selectedStrategy, currentStrategy]);

  const loadCurrentStrategy = async () => {
    if (!botInstanceId) return;
    
    try {
      console.log(`🎯 Loading current strategy for bot: ${botInstanceId}`);
      const botStrategy = await getBotStrategy(botInstanceId);
      if (botStrategy) {
        const current = botStrategy.current || '';
        setCurrentStrategy(current);
        setSelectedStrategy(current);
        console.log(`🎯 Current strategy for ${botInstanceId}: ${current}`);
      }
    } catch (err) {
      console.error('Failed to load current strategy:', err);
    }
  };

  const handleStrategySelection = (strategy: string) => {
    setSelectedStrategy(strategy);
    clearError();
  };

  const handleSaveChanges = async () => {
    if (!botInstanceId || !selectedStrategy || selectedStrategy === currentStrategy) {
      return;
    }

    setUpdating(true);
    try {
      console.log(`🎯 Saving strategy change: ${currentStrategy} → ${selectedStrategy}`);
      const result = await updateBotStrategy(botInstanceId, selectedStrategy);
      
      if (result && result.success) {
        setCurrentStrategy(selectedStrategy);
        setHasChanges(false);
        
        // Show success feedback
        onStrategyChange?.(selectedStrategy, true);
        
        // Optional: Show success notification
        console.log(`✅ Strategy updated successfully: ${result.message}`);
        if (result.strategy.restarted) {
          console.log('🔄 Bot was restarted with new strategy');
        }
      } else {
        console.error('❌ Strategy update failed:', result?.message || 'Unknown error');
        onStrategyChange?.(selectedStrategy, false);
      }
    } catch (err) {
      console.error('❌ Error updating strategy:', err);
      onStrategyChange?.(selectedStrategy, false);
    } finally {
      setUpdating(false);
    }
  };

  const handleDiscardChanges = () => {
    setSelectedStrategy(currentStrategy);
    setHasChanges(false);
    clearError();
  };

  if (!botInstanceId) {
    return (
      <div className={cn("space-y-2", className)}>
        <Label className="text-sm font-medium text-muted-foreground">
          Strategy
        </Label>
        <div className="w-full p-2 text-center text-sm text-muted-foreground border rounded-md bg-muted/50">
          Select a bot to manage strategy
        </div>
      </div>
    );
  }

  if (loading && strategies.length === 0) {
    return (
      <div className={cn("space-y-2", className)}>
        <Label className="text-sm font-medium">
          Strategy
        </Label>
        <div className="flex items-center justify-center gap-2 w-full p-2 text-sm text-muted-foreground border rounded-md">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading strategies...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={cn("space-y-2", className)}>
        <Label className="text-sm font-medium text-destructive">
          Strategy (Error)
        </Label>
        <div className="w-full p-2 text-sm text-destructive border border-destructive rounded-md bg-destructive/10">
          {error}
        </div>
      </div>
    );
  }

  return (
    <div className={cn("space-y-2", className)}>
      <Label className="text-sm font-medium">
        Strategy
        {currentStrategy && (
          <span className="ml-2 text-xs text-muted-foreground">
            Current: {currentStrategy}
          </span>
        )}
      </Label>
      
      <div className="space-y-2">
        {/* Strategy Selector */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              className="w-full flex justify-between items-center h-9"
              disabled={updating}
            >
              <span className="truncate">
                {selectedStrategy || currentStrategy || "Select strategy..."}
              </span>
              <ChevronDown className="h-4 w-4 opacity-50 flex-shrink-0" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-[280px] max-h-60 overflow-y-auto">
            {strategies.length === 0 ? (
              <DropdownMenuItem disabled>
                No strategies available
              </DropdownMenuItem>
            ) : (
              strategies.map((strategy) => (
                <DropdownMenuItem
                  key={strategy.name}
                  onClick={() => handleStrategySelection(strategy.name)}
                  className={cn(
                    "cursor-pointer",
                    selectedStrategy === strategy.name && "bg-accent"
                  )}
                >
                  <div className="flex flex-col items-start gap-1 w-full">
                    <span className="font-medium">{strategy.name}</span>
                    {strategy.description && (
                      <span className="text-xs text-muted-foreground line-clamp-2">
                        {strategy.description.split('\n')[0]}
                      </span>
                    )}
                  </div>
                </DropdownMenuItem>
              ))
            )}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Action Buttons */}
        {hasChanges && (
          <div className="flex gap-2">
            <Button
              onClick={handleSaveChanges}
              disabled={updating}
              size="sm"
              className="flex-1"
            >
              {updating ? (
                <>
                  <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="h-3 w-3 mr-1" />
                  Save Changes
                </>
              )}
            </Button>
            <Button
              onClick={handleDiscardChanges}
              disabled={updating}
              variant="outline"
              size="sm"
            >
              Cancel
            </Button>
          </div>
        )}

        {/* Strategy Description */}
        {selectedStrategy && (
          <div className="p-2 bg-muted/50 rounded-md">
            {(() => {
              const strategy = strategies.find(s => s.name === selectedStrategy);
              if (!strategy) return null;
              
              return (
                <div className="space-y-1">
                  <div className="text-xs font-medium text-muted-foreground">
                    {strategy.className}
                  </div>
                  {strategy.description && (
                    <div className="text-xs text-muted-foreground">
                      {strategy.description.split('\n').slice(0, 3).join(' ')}
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        )}
      </div>
    </div>
  );
};

export default StrategySelector;
