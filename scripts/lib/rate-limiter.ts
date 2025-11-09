/**
 * API Rate Limiter with monitoring, retries, and throttling
 *
 * Features:
 * - Automatic retry with exponential backoff
 * - Rate limit detection and handling
 * - Response time tracking
 * - Request rate monitoring
 * - Timeout protection
 */

export interface FetchResult {
  ticker: string;
  exchange: string;
  success: boolean;
  statusCode?: number;
  data?: any;
  error?: string;
  retryAfter?: number;
  responseTime: number;
}

export interface RateLimitMetrics {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  rateLimitHits: number;
  averageResponseTime: number;
  requestsPerSecond: number;
  lastRateLimitTime?: number;
}

export class ApiRateLimiter {
  private metrics: RateLimitMetrics = {
    totalRequests: 0,
    successfulRequests: 0,
    failedRequests: 0,
    rateLimitHits: 0,
    averageResponseTime: 0,
    requestsPerSecond: 0,
  };

  private requestTimestamps: number[] = [];
  private isThrottled = false;
  private throttleUntil = 0;

  // Configuration
  private readonly maxRetries: number;
  private readonly requestTimeout: number;
  private readonly backoffMultiplier: number;

  constructor(options: {
    maxRetries?: number;
    requestTimeout?: number;
    backoffMultiplier?: number;
  } = {}) {
    this.maxRetries = options.maxRetries ?? 3;
    this.requestTimeout = options.requestTimeout ?? 10000; // 10 seconds
    this.backoffMultiplier = options.backoffMultiplier ?? 2;
  }

  async fetchWithRateLimit(
    url: string,
    ticker: string,
    exchange: string,
    retryCount = 0
  ): Promise<FetchResult> {
    const startTime = Date.now();

    // Check if we're in throttle mode
    if (this.isThrottled && Date.now() < this.throttleUntil) {
      const waitTime = this.throttleUntil - Date.now();
      console.log(`⏳ Throttled. Waiting ${waitTime}ms before retry...`);
      await this.sleep(waitTime);
      this.isThrottled = false;
    }

    this.metrics.totalRequests++;
    this.trackRequestRate();

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.requestTimeout);

      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);

      const responseTime = Date.now() - startTime;
      this.updateAverageResponseTime(responseTime);

      // Check for rate limiting
      if (response.status === 429) {
        return await this.handleRateLimit(response, url, ticker, exchange, retryCount, responseTime);
      }

      if (response.status === 503) {
        return await this.handleServiceUnavailable(url, ticker, exchange, retryCount, responseTime);
      }

      if (!response.ok) {
        this.metrics.failedRequests++;
        return {
          ticker,
          exchange,
          success: false,
          statusCode: response.status,
          error: `HTTP ${response.status}: ${response.statusText}`,
          responseTime,
        };
      }

      // Success!
      const data = await response.json();
      this.metrics.successfulRequests++;

      return {
        ticker,
        exchange,
        success: true,
        statusCode: response.status,
        data,
        responseTime,
      };
    } catch (error: any) {
      const responseTime = Date.now() - startTime;
      this.metrics.failedRequests++;

      if (error.name === "AbortError") {
        console.warn(`⏱️  Timeout for ${ticker}.${exchange} after ${this.requestTimeout}ms`);

        // Retry on timeout
        if (retryCount < this.maxRetries) {
          await this.sleep(1000 * Math.pow(this.backoffMultiplier, retryCount));
          return this.fetchWithRateLimit(url, ticker, exchange, retryCount + 1);
        }
      }

      // Log more details for debugging
      console.error(`   Error details: ${error.name} - ${error.message}`);
      if (error.cause) {
        console.error(`   Cause: ${error.cause}`);
      }

      return {
        ticker,
        exchange,
        success: false,
        error: `${error.name}: ${error.message}`,
        responseTime,
      };
    }
  }

  private async handleRateLimit(
    response: Response,
    url: string,
    ticker: string,
    exchange: string,
    retryCount: number,
    responseTime: number
  ): Promise<FetchResult> {
    this.metrics.rateLimitHits++;
    this.metrics.lastRateLimitTime = Date.now();

    // Check for Retry-After header
    const retryAfter = response.headers.get("Retry-After");
    const waitTime = retryAfter
      ? parseInt(retryAfter) * 1000
      : 5000 * Math.pow(this.backoffMultiplier, retryCount);

    console.warn(`🚫 Rate limit hit for ${ticker}.${exchange}`);
    console.warn(`   Retry-After: ${retryAfter || "not specified"}`);
    console.warn(`   Waiting ${waitTime}ms before retry...`);

    // Enter throttle mode
    this.isThrottled = true;
    this.throttleUntil = Date.now() + waitTime;

    if (retryCount < this.maxRetries) {
      await this.sleep(waitTime);
      return this.fetchWithRateLimit(url, ticker, exchange, retryCount + 1);
    }

    return {
      ticker,
      exchange,
      success: false,
      statusCode: 429,
      error: "Rate limit exceeded, max retries reached",
      retryAfter: waitTime,
      responseTime,
    };
  }

  private async handleServiceUnavailable(
    url: string,
    ticker: string,
    exchange: string,
    retryCount: number,
    responseTime: number
  ): Promise<FetchResult> {
    console.warn(`⚠️  Service unavailable for ${ticker}.${exchange}`);

    const waitTime = 2000 * Math.pow(this.backoffMultiplier, retryCount);

    if (retryCount < this.maxRetries) {
      await this.sleep(waitTime);
      return this.fetchWithRateLimit(url, ticker, exchange, retryCount + 1);
    }

    return {
      ticker,
      exchange,
      success: false,
      statusCode: 503,
      error: "Service unavailable, max retries reached",
      responseTime,
    };
  }

  private trackRequestRate() {
    const now = Date.now();
    this.requestTimestamps.push(now);

    // Keep only last 60 seconds of timestamps
    this.requestTimestamps = this.requestTimestamps.filter((t) => now - t < 60000);

    this.metrics.requestsPerSecond = this.requestTimestamps.length / 60;
  }

  private updateAverageResponseTime(responseTime: number) {
    const total = this.metrics.averageResponseTime * (this.metrics.totalRequests - 1);
    this.metrics.averageResponseTime = (total + responseTime) / this.metrics.totalRequests;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  getMetrics(): RateLimitMetrics {
    return { ...this.metrics };
  }

  printMetrics() {
    const m = this.metrics;
    const successRate = ((m.successfulRequests / m.totalRequests) * 100).toFixed(1);

    console.log("\n📊 Rate Limit Metrics:");
    console.log(`   Total Requests: ${m.totalRequests}`);
    console.log(`   ✅ Successful: ${m.successfulRequests} (${successRate}%)`);
    console.log(`   ❌ Failed: ${m.failedRequests}`);
    console.log(`   🚫 Rate Limits Hit: ${m.rateLimitHits}`);
    console.log(`   ⏱️  Avg Response Time: ${m.averageResponseTime.toFixed(0)}ms`);
    console.log(`   🚀 Requests/sec (last 60s): ${m.requestsPerSecond.toFixed(2)}`);

    if (m.lastRateLimitTime) {
      const timeSince = Date.now() - m.lastRateLimitTime;
      console.log(`   ⏰ Last Rate Limit: ${(timeSince / 1000).toFixed(0)}s ago`);
    }
  }

  resetMetrics() {
    this.metrics = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      rateLimitHits: 0,
      averageResponseTime: 0,
      requestsPerSecond: 0,
    };
    this.requestTimestamps = [];
  }
}
