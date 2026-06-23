import { NextResponse } from 'next/server';
import { handleApiError } from '@/lib/utils/error-handler';
import { createRateLimitMiddleware, RATE_LIMIT_REQUESTS_PER_MINUTE, MINUTE_MS } from '@/lib/utils/rate-limit';
import { mergeApiCacheHeaders } from '@/lib/api/response-cache';
import { 
  fetchDefiLlamaFees,
  fetchDefiLlamaRevenue,
  getDailyFeesChart,
  getDailyRevenueChart,
} from '@/lib/defillama/service';

// Ensure Node.js runtime for API routes
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface MonthlyDefiLlamaData {
  month: string; // YYYY-MM format
  grossProtocolRevenue: number; // Total Assets Yields (total revenue generated from all vaults)
  assetsYields: number; // Total fees/interest generated
  costOfRevenue: number; // Interest paid to users (assetsYields - performanceFees)
  grossProfit: number; // Performance fees collected by curators (what protocol keeps)
  earnings: number; // Same as Gross Profit
}

/**
 * Aggregate daily data by month
 */
function aggregateByMonth(
  dailyData: Array<{ date: string; value: number }>
): Map<string, number> {
  const monthlyMap = new Map<string, number>();
  
  for (const point of dailyData) {
    const date = new Date(point.date);
    const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    const current = monthlyMap.get(monthKey) || 0;
    monthlyMap.set(monthKey, current + point.value);
  }
  
  return monthlyMap;
}

/**
 * Get all months from November 2025 to now
 */
function getAllMonths(): Array<{ year: number; month: number; key: string }> {
  const months: Array<{ year: number; month: number; key: string }> = [];
  const now = new Date();
  const start = new Date('2025-11-01'); // Start from November 2025
  
  let current = new Date(start.getFullYear(), start.getMonth(), 1);
  
  while (current <= now) {
    months.push({
      year: current.getFullYear(),
      month: current.getMonth() + 1,
      key: `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, '0')}`,
    });
    current = new Date(current.getFullYear(), current.getMonth() + 1, 1);
  }
  
  return months;
}

export async function GET(request: Request) {
  // Rate limiting
  const rateLimitMiddleware = createRateLimitMiddleware(
    RATE_LIMIT_REQUESTS_PER_MINUTE,
    MINUTE_MS
  );
  const rateLimitResult = rateLimitMiddleware(request);
  
  if (!rateLimitResult.allowed) {
    return NextResponse.json(
      { error: 'Rate limit exceeded. Please try again later.' },
      { 
        status: 429,
        headers: rateLimitResult.headers,
      }
    );
  }

  try {
    // Fetch DefiLlama fees and revenue data
    const [feesData, revenueData] = await Promise.all([
      fetchDefiLlamaFees(),
      fetchDefiLlamaRevenue(),
    ]);

    if (!feesData) {
      return NextResponse.json(
        { error: 'Failed to fetch DefiLlama fees data' },
        { status: 500 }
      );
    }

    if (!revenueData) {
      return NextResponse.json(
        { error: 'Failed to fetch DefiLlama revenue data' },
        { status: 500 }
      );
    }

    // Get daily fees (assets yields) and daily revenue (protocol share)
    const dailyFees = getDailyFeesChart(feesData);
    const dailyRevenue = getDailyRevenueChart(revenueData);

    // Filter daily data to start from November 2025
    const startDate = new Date('2025-11-01');
    const filteredDailyFees = dailyFees.filter(point => {
      const pointDate = new Date(point.date);
      return pointDate >= startDate;
    });
    const filteredDailyRevenue = dailyRevenue.filter(point => {
      const pointDate = new Date(point.date);
      return pointDate >= startDate;
    });

    // Aggregate by month
    const monthlyFees = aggregateByMonth(filteredDailyFees);
    const monthlyRevenue = aggregateByMonth(filteredDailyRevenue);

    // Get all months and create monthly statements
    const allMonths = getAllMonths();
    const monthlyData: MonthlyDefiLlamaData[] = [];

    for (const month of allMonths) {
      const assetsYields = monthlyFees.get(month.key) || 0; // Total yields generated
      const reportedProtocolRevenue = monthlyRevenue.get(month.key) || 0; // Reported protocol revenue

      // Use DefiLlama reported protocol revenue; if it's missing/zero, derive as Fees (all revenue goes to protocol)
      const protocolRevenue = reportedProtocolRevenue > 0 ? reportedProtocolRevenue : assetsYields;

      // Cost of revenue is Fees - ProtocolRevenue (what's left after protocol takes its share)
      const costOfRevenue = Math.max(assetsYields - protocolRevenue, 0);

      // Gross Protocol Revenue column in UI is the total yields generated (assetsYields)
      const grossProtocolRevenue = assetsYields;
      const grossProfit = protocolRevenue;

      // Only include months with data
      if (assetsYields > 0 || protocolRevenue > 0) {
        monthlyData.push({
          month: month.key,
          grossProtocolRevenue,
          assetsYields,
          costOfRevenue,
          grossProfit,
          earnings: grossProfit,
        });
      }
    }

    // Sort by month
    monthlyData.sort((a, b) => a.month.localeCompare(b.month));

    const responseHeaders = mergeApiCacheHeaders(rateLimitResult.headers, 300);

    return NextResponse.json({ statements: monthlyData }, { headers: responseHeaders });
  } catch (err) {
    const { error, statusCode } = handleApiError(err, 'Failed to fetch DefiLlama monthly statement');
    return NextResponse.json(error, { status: statusCode });
  }
}

