/**
 * DefiLlama API Service
 * 
 * Fetches fees, revenue, and TVL data from DefiLlama for Muscadine vaults.
 */

import { EXTERNAL_API_TIMEOUT_MS } from '@/lib/constants';
import { logger } from '@/lib/utils/logger';

const DEFILLAMA_API_BASE = 'https://api.llama.fi';
const PROTOCOL_SLUG = 'muscadine';

export interface DefiLlamaFeesResponse {
  id: string;
  name: string;
  total24h: number | null;
  total7d: number | null;
  total30d: number | null;
  totalAllTime: number | null;
  totalDataChart: Array<[number, number]> | null; // [timestamp, dailyFees]
}

export interface DefiLlamaRevenueResponse {
  id: string;
  name: string;
  total24h: number | null;
  total7d: number | null;
  total30d: number | null;
  totalAllTime: number | null;
  totalDataChart: Array<[number, number]> | null; // [timestamp, dailyRevenue]
}

export interface DefiLlamaProtocolResponse {
  id: string;
  name: string;
  tvl: Array<{ date: number; totalLiquidityUSD: number }> | null;
  chainTvls: Record<string, { tvl: Array<{ date: number; totalLiquidityUSD: number }> }> | null;
  tokens?: Array<{ date: number; tokens: Record<string, number> }> | null;
  tokensInUsd?: Array<{ date: number; tokens: Record<string, number> }> | null;
}

export interface ChartData {
  date: string;
  value: number;
}

/**
 * Fetch fees summary from DefiLlama
 */
export async function fetchDefiLlamaFees(): Promise<DefiLlamaFeesResponse | null> {
  let timeoutId: NodeJS.Timeout | null = null;
  try {
    const controller = new AbortController();
    timeoutId = setTimeout(() => controller.abort(), EXTERNAL_API_TIMEOUT_MS);

    const response = await fetch(
      `${DEFILLAMA_API_BASE}/summary/fees/${PROTOCOL_SLUG}?dataType=dailyFees`,
      { 
        signal: controller.signal,
        headers: { 'Accept': 'application/json' },
      }
    );

    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }

    if (!response.ok) {
      logger.warn('DefiLlama fees API returned non-OK status', {
        status: response.status,
        statusText: response.statusText,
      });
      return null;
    }

    return await response.json() as DefiLlamaFeesResponse;
  } catch (error) {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    if (error instanceof Error && error.name === 'AbortError') {
      logger.warn('DefiLlama fees API request timed out');
    } else {
      logger.warn('Failed to fetch DefiLlama fees', {
        error: error instanceof Error ? error : new Error(String(error)),
      });
    }
    return null;
  }
}

/**
 * Fetch revenue summary from DefiLlama
 */
export async function fetchDefiLlamaRevenue(): Promise<DefiLlamaRevenueResponse | null> {
  let timeoutId: NodeJS.Timeout | null = null;
  try {
    const controller = new AbortController();
    timeoutId = setTimeout(() => controller.abort(), EXTERNAL_API_TIMEOUT_MS);

    const response = await fetch(
      `${DEFILLAMA_API_BASE}/summary/fees/${PROTOCOL_SLUG}?dataType=dailyRevenue`,
      { 
        signal: controller.signal,
        headers: { 'Accept': 'application/json' },
      }
    );

    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }

    if (!response.ok) {
      logger.warn('DefiLlama revenue API returned non-OK status', {
        status: response.status,
        statusText: response.statusText,
      });
      return null;
    }

    return await response.json() as DefiLlamaRevenueResponse;
  } catch (error) {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    if (error instanceof Error && error.name === 'AbortError') {
      logger.warn('DefiLlama revenue API request timed out');
    } else {
      logger.warn('Failed to fetch DefiLlama revenue', {
        error: error instanceof Error ? error : new Error(String(error)),
      });
    }
    return null;
  }
}

/**
 * Fetch protocol TVL data from DefiLlama
 */
export async function fetchDefiLlamaProtocol(): Promise<DefiLlamaProtocolResponse | null> {
  let timeoutId: NodeJS.Timeout | null = null;
  try {
    const controller = new AbortController();
    timeoutId = setTimeout(() => controller.abort(), EXTERNAL_API_TIMEOUT_MS);

    const response = await fetch(
      `${DEFILLAMA_API_BASE}/protocol/${PROTOCOL_SLUG}`,
      { 
        signal: controller.signal,
        headers: { 'Accept': 'application/json' },
      }
    );

    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }

    if (!response.ok) {
      logger.warn('DefiLlama protocol API returned non-OK status', {
        status: response.status,
        statusText: response.statusText,
      });
      return null;
    }

    return await response.json() as DefiLlamaProtocolResponse;
  } catch (error) {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    if (error instanceof Error && error.name === 'AbortError') {
      logger.warn('DefiLlama protocol API request timed out');
    } else {
      logger.warn('Failed to fetch DefiLlama protocol', {
        error: error instanceof Error ? error : new Error(String(error)),
      });
    }
    return null;
  }
}

/**
 * Get daily fees chart data from DefiLlama
 */
export function getDailyFeesChart(response: DefiLlamaFeesResponse): ChartData[] {
  if (!response.totalDataChart || response.totalDataChart.length === 0) {
    return [];
  }

  return response.totalDataChart.map(([timestamp, dailyValue]) => ({
    date: new Date(timestamp * 1000).toISOString(),
    value: dailyValue || 0,
  }));
}

/**
 * Get cumulative fees chart data from DefiLlama
 */
export function getCumulativeFeesChart(response: DefiLlamaFeesResponse): ChartData[] {
  if (!response.totalDataChart || response.totalDataChart.length === 0) {
    return [];
  }

  let cumulative = 0;
  return response.totalDataChart.map(([timestamp, dailyValue]) => {
    cumulative += dailyValue || 0;
    return {
      date: new Date(timestamp * 1000).toISOString(),
      value: cumulative,
    };
  });
}

/**
 * Get daily revenue chart data from DefiLlama revenue API
 */
export function getDailyRevenueChart(response: DefiLlamaRevenueResponse): ChartData[] {
  if (!response.totalDataChart || response.totalDataChart.length === 0) {
    return [];
  }

  return response.totalDataChart.map(([timestamp, dailyValue]) => ({
    date: new Date(timestamp * 1000).toISOString(),
    value: dailyValue || 0,
  }));
}

/**
 * Get cumulative revenue chart data from DefiLlama revenue API
 */
export function getCumulativeRevenueChart(response: DefiLlamaRevenueResponse): ChartData[] {
  if (!response.totalDataChart || response.totalDataChart.length === 0) {
    return [];
  }

  let cumulative = 0;
  return response.totalDataChart.map(([timestamp, dailyValue]) => {
    cumulative += dailyValue || 0;
    return {
      date: new Date(timestamp * 1000).toISOString(),
      value: cumulative,
    };
  });
}

/**
 * Get daily inflows chart data
 * Formula: Inflows = Deposits - Withdrawals (net asset flow, excluding interest and price changes)
 * 
 * We calculate inflows by looking at token quantity changes and valuing them at previous day's prices.
 * This excludes both interest gains and price appreciation/depreciation.
 * 
 * Inflows = Σ(quantity_change × previous_day_price) for each token
 */
export function getDailyInflowsChart(
  protocolResponse: DefiLlamaProtocolResponse,
  feesResponse?: DefiLlamaFeesResponse | null
): ChartData[] {
  // Use token-based calculation if available (more accurate)
  if (protocolResponse.tokens && protocolResponse.tokensInUsd && protocolResponse.tokens.length >= 2) {
    const result: ChartData[] = [];
    
    // Sort by date to ensure correct order
    const sortedTokens = [...protocolResponse.tokens].sort((a, b) => a.date - b.date);
    const sortedTokensUsd = [...(protocolResponse.tokensInUsd || [])].sort((a, b) => a.date - b.date);
    
    for (let i = 1; i < sortedTokens.length; i++) {
      const prevTokens = sortedTokens[i - 1];
      const currTokens = sortedTokens[i];
      
      // Find corresponding USD values
      const prevTokensUsd = sortedTokensUsd.find(p => p.date === prevTokens.date);
      
      if (!prevTokensUsd) continue;
      
      // Calculate price per token on previous day
      const prices: Record<string, number> = {};
      Object.keys(prevTokens.tokens).forEach(token => {
        const quantity = prevTokens.tokens[token];
        const usdValue = prevTokensUsd.tokens[token];
        if (quantity > 0) {
          prices[token] = usdValue / quantity;
        }
      });
      
      // Calculate quantity changes and value at previous day's prices
      let inflows = 0;
      Object.keys(currTokens.tokens).forEach(token => {
        const currQuantity = currTokens.tokens[token];
        const prevQuantity = prevTokens.tokens[token] ?? 0; // Default to 0 if token didn't exist previously
        const quantityChange = currQuantity - prevQuantity;
        const price = prices[token] || 0;
        inflows += quantityChange * price;
      });
      
      // Inflows can be negative (net outflows when withdrawals > deposits)
      result.push({
        date: new Date(currTokens.date * 1000).toISOString(),
        value: inflows,
      });
    }
    
    return result;
  }
  
  // Fallback to TVL-based calculation if token data not available
  if (!protocolResponse.tvl || protocolResponse.tvl.length < 2) {
    return [];
  }

  // Create a map of daily fees (interest) by date for quick lookup
  const feesMap = new Map<number, number>();
  if (feesResponse?.totalDataChart) {
    feesResponse.totalDataChart.forEach(([timestamp, dailyFees]) => {
      // Normalize timestamp to start of day for matching
      const date = new Date(timestamp * 1000);
      date.setHours(0, 0, 0, 0);
      const dayTimestamp = Math.floor(date.getTime() / 1000);
      feesMap.set(dayTimestamp, (dailyFees || 0));
    });
  }

  const result: ChartData[] = [];

  for (let i = 1; i < protocolResponse.tvl.length; i++) {
    const prev = protocolResponse.tvl[i - 1];
    const curr = protocolResponse.tvl[i];
    
    // Normalize date to start of day for matching
    const currDate = new Date(curr.date * 1000);
    currDate.setHours(0, 0, 0, 0);
    const currDayTimestamp = Math.floor(currDate.getTime() / 1000);
    
    const tvlChange = curr.totalLiquidityUSD - prev.totalLiquidityUSD;
    const interest = feesMap.get(currDayTimestamp) || 0;
    
    // Inflows = Deposits - Withdrawals = TVL Change - Interest
    // Note: This doesn't account for price changes, so it's less accurate
    // Inflows can be negative (net outflows when withdrawals > deposits)
    const inflows = tvlChange - interest;
    
    result.push({
      date: new Date(curr.date * 1000).toISOString(),
      value: inflows,
    });
  }

  return result;
}

/**
 * Get cumulative inflows chart data
 * Formula: Inflows = Deposits - Withdrawals (net asset flow, excluding interest and price changes)
 * 
 * Uses token quantity changes valued at previous day's prices to calculate inflows.
 * Cumulative shows sum of all net flows over time (can be negative if cumulative outflows > cumulative inflows).
 */
export function getCumulativeInflowsChart(
  protocolResponse: DefiLlamaProtocolResponse,
  feesResponse?: DefiLlamaFeesResponse | null
): ChartData[] {
  // Get daily inflows first
  const dailyInflows = getDailyInflowsChart(protocolResponse, feesResponse);
  
  if (dailyInflows.length === 0) {
    return [];
  }
  
  // Calculate cumulative (sum of all net flows, can go negative)
  const result: ChartData[] = [];
  let cumulativeInflow = 0;
  
  for (const daily of dailyInflows) {
    cumulativeInflow += daily.value; // Can be negative for net outflows
    result.push({
      date: daily.date,
      value: cumulativeInflow,
    });
  }
  
  return result;
}
