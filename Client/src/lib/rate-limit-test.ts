/**
 * Rate Limiting Test Script
 * Use this in browser console to test the enhanced SSE service
 */

export const testRateLimitHandling = () => {
  console.log('🧪 Testing FreqTrade SSE Rate Limit Handling');
  
  if (typeof window !== 'undefined' && (window as any).freqTradeSSEService) {
    const service = (window as any).freqTradeSSEService;
    
    console.log('📊 Current service state:');
    console.log('- Connection status:', service.getConnectionStatus());
    console.log('- Reconnect attempts:', service.reconnectAttempts);
    console.log('- Consecutive rate limits:', service.consecutiveRateLimits);
    console.log('- Rate limit backoff:', service.rateLimitBackoff + 'ms');
    
    // Test manual reconnection
    console.log('🔄 Testing manual reconnection...');
    service.disconnect();
    
    setTimeout(() => {
      service.connect().catch((error: any) => {
        console.log('❌ Expected rate limit error:', error);
      });
    }, 1000);
    
    return service;
  } else {
    console.error('FreqTrade SSE Service not found in window object');
    return null;
  }
};

// Add to window for easy browser console access
if (typeof window !== 'undefined') {
  (window as any).testRateLimitHandling = testRateLimitHandling;
}
