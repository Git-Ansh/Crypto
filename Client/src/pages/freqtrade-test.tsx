// FreqTrade Integration Test Page
import React from 'react';
import { FreqTradeDashboard } from '@/components/freqtrade-dashboard';
import { AppSidebar } from '@/components/app-sidebar';
import {
  SidebarProvider,
  SidebarInset,
  SidebarTrigger,
} from '@/components/ui/sidebar';
import { useIsMobile } from '@/hooks/use-mobile';
import { ModeToggle } from '@/components/mode-toggle';

export default function FreqTradeTestPage() {
  const isMobile = useIsMobile();

  return (
    <SidebarProvider defaultOpen={!isMobile}>
      <AppSidebar />
      <SidebarInset>
        <div className="w-full p-4 space-y-6">
          {/* Header */}
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-4">
              <SidebarTrigger />
              <h1 className="text-3xl font-bold">FreqTrade Bot Manager</h1>
            </div>
            <ModeToggle />
          </div>

          {/* FreqTrade Dashboard */}
          <FreqTradeDashboard />
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
