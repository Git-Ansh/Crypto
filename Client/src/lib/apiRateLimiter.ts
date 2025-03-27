// Client/src/lib/apiRateLimiter.ts
type QueuedRequest = {
  execute: () => Promise<any>;
  resolve: (value: any) => void;
  reject: (reason: any) => void;
};

class ApiRateLimiter {
  private queue: QueuedRequest[] = [];
  private processing = false;
  private lastRequestTime = 0;
  private requestsThisMinute = 0;
  private readonly requestsPerMinuteLimit: number;
  private readonly minTimeBetweenRequests: number;

  constructor(requestsPerMinute = 100, minTimeBetweenRequestsMs = 100) {
    this.requestsPerMinuteLimit = requestsPerMinute;
    this.minTimeBetweenRequests = minTimeBetweenRequestsMs;

    // Reset counter every minute
    setInterval(() => {
      this.requestsThisMinute = 0;
    }, 60000);
  }

  async enqueue<T>(requestFn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push({
        execute: requestFn,
        resolve: resolve as (value: any) => void,
        reject,
      });

      if (!this.processing) {
        this.processQueue();
      }
    });
  }

  private async processQueue() {
    if (this.queue.length === 0) {
      this.processing = false;
      return;
    }

    this.processing = true;

    // Check if we've hit the rate limit
    if (this.requestsThisMinute >= this.requestsPerMinuteLimit) {
      console.warn('Rate limit reached. Waiting until next minute to continue.');
      setTimeout(() => this.processQueue(), 60000 - (Date.now() % 60000));
      return;
    }

    // Ensure minimum time between requests
    const now = Date.now();
    const timeToWait = Math.max(0, this.lastRequestTime + this.minTimeBetweenRequests - now);

    if (timeToWait > 0) {
      await new Promise(resolve => setTimeout(resolve, timeToWait));
    }

    const request = this.queue.shift();
    if (!request) {
      this.processQueue();
      return;
    }

    try {
      this.requestsThisMinute++;
      this.lastRequestTime = Date.now();
      const result = await request.execute();
      request.resolve(result);
    } catch (error) {
      request.reject(error);
    } finally {
      // Continue processing the queue
      setTimeout(() => this.processQueue(), 0);
    }
  }
}

// Create a singleton instance
export const coinApiRateLimiter = new ApiRateLimiter(
  process.env.NODE_ENV === 'production' ? 100 : 300, // 100 requests per minute in production, 300 in dev
  200 // Minimum 200ms between requests
);

export default coinApiRateLimiter;