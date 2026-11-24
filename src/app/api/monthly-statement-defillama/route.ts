import { NextResponse } from 'next/server';
import { handleApiError } from '@/lib/utils/error-handler';
import { createRateLimitMiddleware, RATE_LIMIT_REQUESTS_PER_MINUTE, MINUTE_MS } from '@/lib/utils/rate-limit';
import { mergeApiCacheHeaders } from '@/lib/api/response-cache';
import {
  STATEMENT_START_DATE,
} from '@/lib/morpho/treasury-statement';
import { monthKeyFromIsoDate, utcMonthsFrom, fromFirstNonZeroPeriod } from '@/lib/utils/utc-calendar';
import { 
  fetchDefiLlamaFees,
  fetchDefiLlamaRevenue,
  getDailyFeesChart,
  getDailyRevenueChart,
} from '@/lib/defillama/service';
import { unauthorizedUnlessAdmin } from '@/lib/auth/require-admin';

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
    const monthKey = monthKeyFromIsoDate(point.date);
    if (!/^\d{4}-\d{2}$/.test(monthKey)) continue;
    const current = monthlyMap.get(monthKey) || 0;
    monthlyMap.set(monthKey, current + point.value);
  }

  return monthlyMap;
}

function getAllMonths(): Array<{ year: number; month: number; key: string }> {
  return utcMonthsFrom(STATEMENT_START_DATE);
}

export async function GET(request: Request) {
  const denied = await unauthorizedUnlessAdmin(request);
  if (denied) return denied;
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

    const startDay = STATEMENT_START_DATE.toISOString().slice(0, 10);
    const filteredDailyFees = dailyFees.filter((point) => point.date.slice(0, 10) >= startDay);
    const filteredDailyRevenue = dailyRevenue.filter(
      (point) => point.date.slice(0, 10) >= startDay
    );

    // Aggregate by month
    const monthlyFees = aggregateByMonth(filteredDailyFees);
    const monthlyRevenue = aggregateByMonth(filteredDailyRevenue);

    // Get all months and create monthly statements
    const allMonths = getAllMonths();
    const monthlyData: MonthlyDefiLlamaData[] = [];

    for (const month of allMonths) {
      const assetsYields = monthlyFees.get(month.key) || 0; // Total yields generated
      const protocolRevenue = monthlyRevenue.get(month.key) || 0; // Curator / protocol take

      // Gross = all vault yields. Cost of revenue = yields paid to depositors.
      // Total Revenue (grossProfit) = DefiLlama protocol revenue — including 0.
      // Do not treat a 0 protocol-revenue report as "all fees go to the protocol";
      // that zeroed Cost of Revenue and inflated Total Revenue.
      const costOfRevenue = Math.max(assetsYields - protocolRevenue, 0);
      const grossProtocolRevenue = assetsYields;
      const grossProfit = protocolRevenue;

      monthlyData.push({
        month: month.key,
        grossProtocolRevenue,
        assetsYields,
        costOfRevenue,
        grossProfit,
        earnings: grossProfit,
      });
    }

    monthlyData.sort((a, b) => a.month.localeCompare(b.month));
    const statements = fromFirstNonZeroPeriod(
      monthlyData,
      (row) => row.assetsYields > 0 || row.grossProfit > 0
    );

    const responseHeaders = mergeApiCacheHeaders(rateLimitResult.headers, 300);

    return NextResponse.json({ statements }, { headers: responseHeaders });
  } catch (err) {
    const { error, statusCode } = handleApiError(err, 'Failed to fetch DefiLlama monthly statement');
    return NextResponse.json(error, { status: statusCode });
  }
}

