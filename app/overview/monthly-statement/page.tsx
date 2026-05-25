'use client';

import { useState, useMemo, useRef, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AppShell } from '@/components/layout/AppShell';
import { Card, CardContent, CardHeader, CardTitle, CardAction, CardFooter } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { formatCompactUSD } from '@/lib/format/number';
import { getAddress } from 'viem';
import Link from 'next/link';
import { Info } from 'lucide-react';

interface TreasuryAssetBreakdown {
  USDC: { tokens: number; usd: number };
  cbBTC: { tokens: number; usd: number };
  WETH: { tokens: number; usd: number };
}

interface MonthlyStatementData {
  month: string;
  assets: TreasuryAssetBreakdown;
  vaultFees: TreasuryAssetBreakdown;
  miscellaneous: TreasuryAssetBreakdown;
  total: {
    tokens: number;
    usd: number;
  };
  vaultFeesTotal: {
    tokens: number;
    usd: number;
  };
  miscellaneousTotal: {
    tokens: number;
    usd: number;
  };
  isComplete: boolean;
}

interface VaultMonthlyData {
  vaultAddress: string;
  asset: 'USDC' | 'cbBTC' | 'WETH';
  version: 'v1' | 'v2';
  month: string;
  tokens: number;
  usd: number;
}

interface MonthlyStatementResponse {
  statements: MonthlyStatementData[];
}

interface VaultStatementResponse {
  vaults: VaultMonthlyData[];
}

interface DefiLlamaMonthlyData {
  month: string;
  grossProtocolRevenue: number;
  assetsYields: number;
  costOfRevenue: number;
  grossProfit: number;
  earnings: number;
}

interface DefiLlamaStatementResponse {
  statements: DefiLlamaMonthlyData[];
}

type YearFilter = '2025' | '2026' | 'all';
type ViewMode = 'byRevenue' | 'total' | 'byToken' | 'byVault';
type CurrencyMode = 'usd' | 'token';
type TabMode = 'treasury' | 'defillama';
type DefiLlamaViewMode = 'month' | 'quarter' | 'year';
type TreasuryPeriodMode = 'month' | 'quarter' | 'year';

// Vault address to name mapping
const VAULT_NAMES: Record<string, string> = {
  '0xf7e26fa48a568b8b0038e104dfd8abdf0f99074f': 'USDC V1',
  '0x89712980cb434ef5ae4ab29349419eb976b0b496': 'USDC V2',
  '0xaecc8113a7bd0cfaf7000ea7a31affd4691ff3e9': 'cbBTC V1',
  '0x99dcd0d75822ba398f13b2a8852b07c7e137ec70': 'cbBTC V2',
  '0x21e0d366272798da3a977feba699fcb91959d120': 'WETH V1',
  '0xd6dcad2f7da91fbb27bda471540d9770c97a5a43': 'WETH V2',
};

export default function MonthlyStatementPage() {
  const [activeTab, setActiveTab] = useState<TabMode>('treasury');
  const [yearFilter, setYearFilter] = useState<YearFilter>('all');
  const [viewMode, setViewMode] = useState<ViewMode>('byRevenue');
  const [currencyMode, setCurrencyMode] = useState<CurrencyMode>('usd');
  const [treasuryPeriodMode, setTreasuryPeriodMode] = useState<TreasuryPeriodMode>('month');
  const [defiLlamaViewMode, setDefiLlamaViewMode] = useState<DefiLlamaViewMode>('month');
  const [isCurrencyDropdownOpen, setIsCurrencyDropdownOpen] = useState(false);
  const [isYearDropdownOpen, setIsYearDropdownOpen] = useState(false);
  const [isViewModeDropdownOpen, setIsViewModeDropdownOpen] = useState(false);
  const [isTreasuryPeriodDropdownOpen, setIsTreasuryPeriodDropdownOpen] = useState(false);
  const [isDefiLlamaViewModeDropdownOpen, setIsDefiLlamaViewModeDropdownOpen] = useState(false);
  const [tooltipVisible, setTooltipVisible] = useState<string | null>(null);
  const currencyDropdownRef = useRef<HTMLDivElement>(null);
  const yearDropdownRef = useRef<HTMLDivElement>(null);
  const viewModeDropdownRef = useRef<HTMLDivElement>(null);
  const treasuryPeriodDropdownRef = useRef<HTMLDivElement>(null);
  const defiLlamaViewModeDropdownRef = useRef<HTMLDivElement>(null);

  const { data, isLoading, error } = useQuery<MonthlyStatementResponse>({
    queryKey: ['monthly-statement'],
    queryFn: async () => {
      const response = await fetch('/api/monthly-statement-morphoql', {
        credentials: 'omit',
      });
      if (!response.ok) throw new Error('Failed to fetch monthly statement');
      return response.json();
    },
  });

  const { data: vaultData, isLoading: isVaultDataLoading } = useQuery<VaultStatementResponse>({
    queryKey: ['monthly-statement-vaults'],
    queryFn: async () => {
      const response = await fetch('/api/monthly-statement-morphoql?perVault=true', {
        credentials: 'omit',
      });
      if (!response.ok) throw new Error('Failed to fetch vault statement');
      return response.json();
    },
    enabled: viewMode === 'byVault' && activeTab === 'treasury',
  });

  const { data: defiLlamaData, isLoading: isDefiLlamaLoading, error: defiLlamaError } = useQuery<DefiLlamaStatementResponse>({
    queryKey: ['monthly-statement-defillama'],
    queryFn: async () => {
      const response = await fetch('/api/monthly-statement-defillama', {
        credentials: 'omit',
      });
      if (!response.ok) throw new Error('Failed to fetch DefiLlama statement');
      return response.json();
    },
    enabled: activeTab === 'defillama',
  });

  const formatMonth = (monthKey: string, periodMode?: TreasuryPeriodMode) => {
    // Handle period keys (Q1, Q2, etc. or year-only)
    if (monthKey.includes('Q')) {
      const [year, quarter] = monthKey.split('-Q');
      return `Q${quarter} ${year}`;
    }
    if (/^\d{4}$/.test(monthKey)) {
      // Year-only format
      return monthKey;
    }
    // Regular month format
    const [year, month] = monthKey.split('-');
    const date = new Date(parseInt(year), parseInt(month) - 1, 1);
    return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  };

  // Filter statements by year
  const filteredStatements = useMemo(() => {
    const allStatements = data?.statements || [];
    if (yearFilter === 'all') return allStatements;
    
    return allStatements.filter(statement => {
      const [year] = statement.month.split('-');
      return year === yearFilter;
    });
  }, [data?.statements, yearFilter]);

  // Filter DefiLlama statements by year and start from November 2025
  const filteredDefiLlamaStatements = useMemo(() => {
    const allStatements = defiLlamaData?.statements || [];
    
    // Filter to start from November 2025 (2025-11)
    const filtered = allStatements.filter(statement => {
      const [year, month] = statement.month.split('-');
      const yearNum = parseInt(year);
      const monthNum = parseInt(month);
      
      // Include if year is 2025 and month is November (11) or later, or year is 2026 or later
      if (yearNum > 2025) return true;
      if (yearNum === 2025 && monthNum >= 11) return true;
      return false;
    });
    
    // Then apply year filter if not 'all'
    if (yearFilter === 'all') return filtered;
    
    return filtered.filter(statement => {
      const [year] = statement.month.split('-');
      return year === yearFilter;
    });
  }, [defiLlamaData?.statements, yearFilter]);

  // Filter vault data by year
  const filteredVaultData = useMemo(() => {
    const allVaults = vaultData?.vaults || [];
    if (yearFilter === 'all') return allVaults;
    
    return allVaults.filter(vault => {
      const [year] = vault.month.split('-');
      return year === yearFilter;
    });
  }, [vaultData?.vaults, yearFilter]);

  // Format token amount with specific decimals per asset
  const formatTokenAmount = (amount: number, asset: 'USDC' | 'cbBTC' | 'WETH'): string => {
    const decimals = asset === 'USDC' ? 6 : 8; // USDC: 6 decimals, cbBTC/WETH: 8 decimals
    
    if (amount === 0) return `0.${'0'.repeat(decimals)} ${asset}`;
    
    // Use Intl.NumberFormat for proper formatting
    const formatted = new Intl.NumberFormat('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
      useGrouping: true,
    }).format(amount);
    
    return `${formatted} ${asset}`;
  };

  // Format amount based on currency mode
  const formatAmount = (assetData: { tokens: number; usd: number }, asset: 'USDC' | 'cbBTC' | 'WETH'): string => {
    if (currencyMode === 'token') {
      return formatTokenAmount(assetData.tokens, asset);
    }
    return formatCompactUSD(assetData.usd);
  };

  // Close dropdowns and tooltips when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (currencyDropdownRef.current && !currencyDropdownRef.current.contains(event.target as Node)) {
        setIsCurrencyDropdownOpen(false);
      }
      if (yearDropdownRef.current && !yearDropdownRef.current.contains(event.target as Node)) {
        setIsYearDropdownOpen(false);
      }
      if (viewModeDropdownRef.current && !viewModeDropdownRef.current.contains(event.target as Node)) {
        setIsViewModeDropdownOpen(false);
      }
      if (treasuryPeriodDropdownRef.current && !treasuryPeriodDropdownRef.current.contains(event.target as Node)) {
        setIsTreasuryPeriodDropdownOpen(false);
      }
      if (defiLlamaViewModeDropdownRef.current && !defiLlamaViewModeDropdownRef.current.contains(event.target as Node)) {
        setIsDefiLlamaViewModeDropdownOpen(false);
      }
      // Close tooltips when clicking outside
      const target = event.target as HTMLElement;
      if (!target.closest('[data-tooltip-container]')) {
        setTooltipVisible(null);
      }
    };

    if (isCurrencyDropdownOpen || isYearDropdownOpen || isViewModeDropdownOpen || isTreasuryPeriodDropdownOpen || isDefiLlamaViewModeDropdownOpen || tooltipVisible) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isCurrencyDropdownOpen, isYearDropdownOpen, isViewModeDropdownOpen, isTreasuryPeriodDropdownOpen, isDefiLlamaViewModeDropdownOpen, tooltipVisible]);

  const yearOptions: { value: YearFilter; label: string }[] = [
    { value: '2025', label: '2025' },
    { value: '2026', label: '2026' },
    { value: 'all', label: 'All' },
  ];

  const viewModeOptions: { value: ViewMode; label: string }[] = [
    { value: 'byRevenue', label: 'By Revenue' },
    { value: 'total', label: 'Total' },
    { value: 'byToken', label: 'By Token' },
    { value: 'byVault', label: 'By Vault' },
  ];

  const currencyOptions: { value: CurrencyMode; label: string }[] = [
    { value: 'usd', label: 'USD' },
    { value: 'token', label: 'Token' },
  ];

  const treasuryPeriodModeOptions: { value: TreasuryPeriodMode; label: string }[] = [
    { value: 'month', label: 'By Month' },
    { value: 'quarter', label: 'By Quarter' },
    { value: 'year', label: 'By Year' },
  ];

  const defiLlamaViewModeOptions: { value: DefiLlamaViewMode; label: string }[] = [
    { value: 'month', label: 'Month' },
    { value: 'quarter', label: 'Quarter' },
    { value: 'year', label: 'Year' },
  ];

  const getCurrencyLabel = (value: CurrencyMode) => {
    return currencyOptions.find(opt => opt.value === value)?.label || 'USD';
  };

  const getYearLabel = (value: YearFilter) => {
    return yearOptions.find(opt => opt.value === value)?.label || 'All';
  };

  const getViewModeLabel = (value: ViewMode) => {
    return viewModeOptions.find(opt => opt.value === value)?.label || 'By Revenue';
  };

  const getTreasuryPeriodModeLabel = (value: TreasuryPeriodMode) => {
    return treasuryPeriodModeOptions.find(opt => opt.value === value)?.label || 'By Month';
  };

  const getDefiLlamaViewModeLabel = (value: DefiLlamaViewMode) => {
    return defiLlamaViewModeOptions.find(opt => opt.value === value)?.label || 'Month';
  };

  // Check if a period is complete (works for both treasury and defillama)
  const isPeriodComplete = (periodKey: string, periodMode?: TreasuryPeriodMode | DefiLlamaViewMode): boolean => {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1; // JavaScript months are 0-indexed, convert to 1-indexed
    
    // Check if it's a month format (YYYY-MM)
    if (/^\d{4}-\d{2}$/.test(periodKey)) {
      const [year, month] = periodKey.split('-').map(Number);
      // Compare year and month directly to avoid timezone issues
      if (currentYear > year) return true;
      if (currentYear < year) return false;
      // Same year - check if current month is past the period month
      return currentMonth > month;
    } 
    // Check if it's a quarter format (YYYY-Q1, YYYY-Q2, etc.)
    else if (periodKey.includes('-Q')) {
      const [year, quarter] = periodKey.split('-Q').map((v, i) => i === 0 ? parseInt(v) : parseInt(v));
      const quarterEndMonth = quarter * 3; // Q1 ends in March (month 3), Q2 in June (6), etc.
      // Compare year and quarter end month directly
      if (currentYear > year) return true;
      if (currentYear < year) return false;
      // Same year - check if current month is past the quarter end month
      return currentMonth > quarterEndMonth;
    } 
    // Check if it's a year format (YYYY)
    else if (/^\d{4}$/.test(periodKey)) {
      const year = parseInt(periodKey);
      // Simply compare years
      return currentYear > year;
    }
    
    // Default: if we can't parse it, assume it's complete
    return true;
  };

  // Aggregate treasury statements by period (month, quarter, year)
  const mergeAssetBreakdown = (
    a: TreasuryAssetBreakdown,
    b: TreasuryAssetBreakdown
  ): TreasuryAssetBreakdown => ({
    USDC: { tokens: a.USDC.tokens + b.USDC.tokens, usd: a.USDC.usd + b.USDC.usd },
    cbBTC: { tokens: a.cbBTC.tokens + b.cbBTC.tokens, usd: a.cbBTC.usd + b.cbBTC.usd },
    WETH: { tokens: a.WETH.tokens + b.WETH.tokens, usd: a.WETH.usd + b.WETH.usd },
  });

  const aggregatedStatements = useMemo(() => {
    if (treasuryPeriodMode === 'month') {
      // For month mode, check if each month is complete
      return filteredStatements.map(statement => ({
        ...statement,
        isComplete: isPeriodComplete(statement.month, treasuryPeriodMode),
      }));
    }

    const aggregated = new Map<string, MonthlyStatementData>();

    filteredStatements.forEach(statement => {
      const [year, month] = statement.month.split('-').map(Number);
      let periodKey: string;

      if (treasuryPeriodMode === 'quarter') {
        const quarter = Math.ceil(month / 3);
        periodKey = `${year}-Q${quarter}`;
      } else {
        // year
        periodKey = year.toString();
      }

      const existing = aggregated.get(periodKey);
      const periodIsComplete = isPeriodComplete(periodKey, treasuryPeriodMode);
      
      if (existing) {
        const assets = mergeAssetBreakdown(existing.assets, statement.assets);
        const vaultFees = mergeAssetBreakdown(existing.vaultFees, statement.vaultFees);
        const miscellaneous = mergeAssetBreakdown(existing.miscellaneous, statement.miscellaneous);
        aggregated.set(periodKey, {
          month: periodKey,
          assets,
          vaultFees,
          miscellaneous,
          total: {
            tokens: existing.total.tokens + statement.total.tokens,
            usd: existing.total.usd + statement.total.usd,
          },
          vaultFeesTotal: {
            tokens: existing.vaultFeesTotal.tokens + statement.vaultFeesTotal.tokens,
            usd: existing.vaultFeesTotal.usd + statement.vaultFeesTotal.usd,
          },
          miscellaneousTotal: {
            tokens: existing.miscellaneousTotal.tokens + statement.miscellaneousTotal.tokens,
            usd: existing.miscellaneousTotal.usd + statement.miscellaneousTotal.usd,
          },
          isComplete: periodIsComplete,
        });
      } else {
        aggregated.set(periodKey, { ...statement, month: periodKey, isComplete: periodIsComplete });
      }
    });

    return Array.from(aggregated.values()).sort((a, b) => {
      if (treasuryPeriodMode === 'year') {
        return a.month.localeCompare(b.month);
      }
      // For quarters, sort by year then quarter
      const [yearA, quarterA] = a.month.split('-Q').map((v, i) => i === 0 ? parseInt(v) : parseInt(v));
      const [yearB, quarterB] = b.month.split('-Q').map((v, i) => i === 0 ? parseInt(v) : parseInt(v));
      if (yearA !== yearB) return yearA - yearB;
      return quarterA - quarterB;
    });
  }, [filteredStatements, treasuryPeriodMode]);

  const statements = aggregatedStatements;
  const grandTotalUSD = statements.reduce((sum, s) => sum + s.total.usd, 0);
  const grandVaultFeesUSD = statements.reduce((sum, s) => sum + s.vaultFeesTotal.usd, 0);
  const grandMiscUSD = statements.reduce((sum, s) => sum + s.miscellaneousTotal.usd, 0);

  // Aggregate vault data by period if needed
  const aggregatedVaultData = useMemo(() => {
    if (treasuryPeriodMode === 'month') {
      return filteredVaultData;
    }

    const aggregated = new Map<string, VaultMonthlyData[]>();

    filteredVaultData.forEach(vault => {
      const [year, month] = vault.month.split('-').map(Number);
      let periodKey: string;

      if (treasuryPeriodMode === 'quarter') {
        const quarter = Math.ceil(month / 3);
        periodKey = `${year}-Q${quarter}`;
      } else {
        // year
        periodKey = year.toString();
      }

      if (!aggregated.has(periodKey)) {
        aggregated.set(periodKey, []);
      }

      const existing = aggregated.get(periodKey)!.find(v => 
        v.vaultAddress.toLowerCase() === vault.vaultAddress.toLowerCase()
      );

      if (existing) {
        existing.tokens += vault.tokens;
        existing.usd += vault.usd;
      } else {
        aggregated.get(periodKey)!.push({
          ...vault,
          month: periodKey,
        });
      }
    });

    return Array.from(aggregated.values()).flat();
  }, [filteredVaultData, treasuryPeriodMode]);

  // Get unique periods from aggregated vault data
  const vaultMonths = useMemo(() => {
    const periods = new Set(aggregatedVaultData.map(v => v.month));
    return Array.from(periods).sort((a, b) => {
      if (treasuryPeriodMode === 'year') {
        return a.localeCompare(b);
      }
      if (treasuryPeriodMode === 'quarter') {
        const [yearA, quarterA] = a.split('-Q').map((v, i) => i === 0 ? parseInt(v) : parseInt(v));
        const [yearB, quarterB] = b.split('-Q').map((v, i) => i === 0 ? parseInt(v) : parseInt(v));
        if (yearA !== yearB) return yearA - yearB;
        return quarterA - quarterB;
      }
      return a.localeCompare(b);
    });
  }, [aggregatedVaultData, treasuryPeriodMode]);

  // Get unique vault addresses (normalized to lowercase)
  // Ordered: USDC V1, cbBTC V1, WETH V1, USDC V2, cbBTC V2, WETH V2
  const vaultAddresses = useMemo(() => {
    const addresses = new Set(aggregatedVaultData.map(v => v.vaultAddress.toLowerCase()));
    const addressArray = Array.from(addresses);
    
    // Define the desired order
    const order: string[] = [
      '0xf7e26fa48a568b8b0038e104dfd8abdf0f99074f', // USDC V1
      '0xaecc8113a7bd0cfaf7000ea7a31affd4691ff3e9', // cbBTC V1
      '0x21e0d366272798da3a977feba699fcb91959d120', // WETH V1
      '0x89712980cb434ef5ae4ab29349419eb976b0b496', // USDC V2
      '0x99dcd0d75822ba398f13b2a8852b07c7e137ec70', // cbBTC V2
      '0xd6dcad2f7da91fbb27bda471540d9770c97a5a43', // WETH V2
    ];
    
    // Sort by the defined order, with any unknown addresses at the end
    return addressArray.sort((a, b) => {
      const indexA = order.indexOf(a);
      const indexB = order.indexOf(b);
      
      // If both are in the order, sort by their position
      if (indexA !== -1 && indexB !== -1) {
        return indexA - indexB;
      }
      // If only A is in the order, A comes first
      if (indexA !== -1) return -1;
      // If only B is in the order, B comes first
      if (indexB !== -1) return 1;
      // If neither is in the order, sort alphabetically
      return a.localeCompare(b);
    });
  }, [aggregatedVaultData]);

  // Group vault data by period
  const vaultDataByMonth = useMemo(() => {
    const grouped: Record<string, VaultMonthlyData[]> = {};
    aggregatedVaultData.forEach(vault => {
      if (!grouped[vault.month]) {
        grouped[vault.month] = [];
      }
      grouped[vault.month].push(vault);
    });
    return grouped;
  }, [aggregatedVaultData]);

  // Calculate totals for vault view
  const vaultTotals = useMemo(() => {
    const totals: Record<string, { tokens: number; usd: number }> = {};
    vaultAddresses.forEach(addr => {
      totals[addr] = { tokens: 0, usd: 0 };
      aggregatedVaultData.forEach(vault => {
        if (vault.vaultAddress.toLowerCase() === addr) {
          totals[addr].tokens += vault.tokens;
          totals[addr].usd += vault.usd;
        }
      });
    });
    return totals;
  }, [vaultAddresses, aggregatedVaultData]);

  const isLoadingData = activeTab === 'treasury' 
    ? (isLoading || (viewMode === 'byVault' && isVaultDataLoading))
    : isDefiLlamaLoading;

  // Aggregate DefiLlama data by period (month, quarter, year)
  const aggregatedDefiLlamaData = useMemo(() => {
    if (defiLlamaViewMode === 'month') {
      return filteredDefiLlamaStatements;
    }

    const aggregated = new Map<string, DefiLlamaMonthlyData>();

    filteredDefiLlamaStatements.forEach(statement => {
      const [year, month] = statement.month.split('-').map(Number);
      let periodKey: string;

      if (defiLlamaViewMode === 'quarter') {
        const quarter = Math.ceil(month / 3);
        periodKey = `${year}-Q${quarter}`;
      } else {
        // year
        periodKey = year.toString();
      }

      const existing = aggregated.get(periodKey);
      if (existing) {
        aggregated.set(periodKey, {
          month: periodKey,
          grossProtocolRevenue: existing.grossProtocolRevenue + statement.grossProtocolRevenue,
          assetsYields: existing.assetsYields + statement.assetsYields,
          costOfRevenue: existing.costOfRevenue + statement.costOfRevenue,
          grossProfit: existing.grossProfit + statement.grossProfit,
          earnings: existing.earnings + statement.earnings,
        });
      } else {
        aggregated.set(periodKey, { ...statement, month: periodKey });
      }
    });

    return Array.from(aggregated.values()).sort((a, b) => {
      if (defiLlamaViewMode === 'year') {
        return a.month.localeCompare(b.month);
      }
      // For quarters, sort by year then quarter
      const [yearA, quarterA] = a.month.split('-Q').map((v, i) => i === 0 ? parseInt(v) : parseInt(v));
      const [yearB, quarterB] = b.month.split('-Q').map((v, i) => i === 0 ? parseInt(v) : parseInt(v));
      if (yearA !== yearB) return yearA - yearB;
      return quarterA - quarterB;
    });
  }, [filteredDefiLlamaStatements, defiLlamaViewMode]);

  // Format period label
  const formatPeriod = (periodKey: string) => {
    if (defiLlamaViewMode === 'month') {
      return formatMonth(periodKey);
    } else if (defiLlamaViewMode === 'quarter') {
      const [year, quarter] = periodKey.split('-Q');
      return `Q${quarter} ${year}`;
    } else {
      return periodKey;
    }
  };

  // Calculate totals for DefiLlama view
  const defiLlamaTotals = useMemo(() => {
    return aggregatedDefiLlamaData.reduce((acc, s) => ({
      grossProtocolRevenue: acc.grossProtocolRevenue + s.grossProtocolRevenue,
      assetsYields: acc.assetsYields + s.assetsYields,
      costOfRevenue: acc.costOfRevenue + s.costOfRevenue,
      grossProfit: acc.grossProfit + s.grossProfit,
      earnings: acc.earnings + s.earnings,
    }), {
      grossProtocolRevenue: 0,
      assetsYields: 0,
      costOfRevenue: 0,
      grossProfit: 0,
      earnings: 0,
    });
  }, [aggregatedDefiLlamaData]);

  // Tooltip component for column headers
  const InfoTooltip = ({ id, content }: { id: string; content: string }) => {
    const isVisible = tooltipVisible === id;
    return (
      <div className="relative inline-block" data-tooltip-container>
        <button
          type="button"
          className="inline-flex items-center justify-center focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2 rounded"
          onMouseEnter={() => setTooltipVisible(id)}
          onMouseLeave={() => setTooltipVisible(null)}
          onClick={() => setTooltipVisible(isVisible ? null : id)}
          aria-label="More information"
        >
          <Info className="h-4 w-4 text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 transition-colors" />
        </button>
        {isVisible && (
          <div className="absolute right-0 top-6 z-50 w-64 rounded-md border bg-white p-2 text-xs text-slate-900 shadow-lg dark:bg-slate-800 dark:border-slate-700 dark:text-slate-200 whitespace-normal">
            {content}
          </div>
        )}
      </div>
    );
  };

  return (
    <AppShell
      title="Monthly Income Statement"
      description={
        activeTab === 'treasury' ? (
        <>
          Monthly revenue from November 1st, 2025 for our{' '}
          <Link
            href="https://debank.com/profile/0x057fd8b961eb664baa647a5c7a6e9728faba266a"
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 hover:text-blue-800 underline dark:text-blue-400 dark:hover:text-blue-300"
          >
            Treasury wallet
          </Link>
          . Vault fees exclude capital deposited or transferred into vault positions (shown as Miscellaneous Revenue).<br />
          <span className="text-sm text-slate-600 dark:text-slate-400">
            Revenue flows periodically when vaults have activity.
          </span>
        </>
        ) : (
          <>
            Monthly revenue breakdown by asset from November 1st, 2025 onwards through{' '}
            <Link
              href="https://defillama.com/protocol/muscadine"
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 hover:text-blue-800 underline dark:text-blue-400 dark:hover:text-blue-300"
            >
              DefiLlama API
            </Link>
            .<br />
            <span className="text-sm text-slate-600 dark:text-slate-400">
              Protocol calculations are rounded to the nearest dollar.
            </span>
          </>
        )
      }
    >
      <div className="space-y-6">
          <Card>
          <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as TabMode)}>
            <CardHeader>
              <div className="flex flex-col gap-4 mb-4 sm:flex-row sm:items-center sm:justify-between">
                <TabsList className="w-fit shrink-0">
                  <TabsTrigger value="treasury">By Treasury Wallet</TabsTrigger>
                  <TabsTrigger value="defillama">DefiLlama</TabsTrigger>
                </TabsList>
                <CardAction className="min-w-0 w-full sm:w-auto">
                  <div className="flex flex-wrap items-center gap-2">
                    {/* Currency Dropdown - only for treasury tab, shown first */}
                    {activeTab === 'treasury' && (viewMode === 'byToken' || viewMode === 'byVault') && (
                      <div className="relative" ref={currencyDropdownRef}>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setIsCurrencyDropdownOpen(!isCurrencyDropdownOpen)}
                          className="min-w-[100px] justify-between"
                        >
                          {getCurrencyLabel(currencyMode)}
                          <svg
                            className={`ml-2 h-4 w-4 transition-transform ${isCurrencyDropdownOpen ? 'rotate-180' : ''}`}
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                          </svg>
                        </Button>
                        {isCurrencyDropdownOpen && (
                          <div className="absolute right-0 mt-1 w-full min-w-[100px] rounded-md border bg-white text-slate-900 shadow-lg dark:bg-slate-800 dark:border-slate-700 dark:text-slate-200 z-10">
                            {currencyOptions.map((option) => (
                              <button
                                key={option.value}
                                onClick={() => {
                                  setCurrencyMode(option.value);
                                  setIsCurrencyDropdownOpen(false);
                                }}
                                className={`w-full text-left px-4 py-2 text-sm hover:bg-slate-100 dark:hover:bg-slate-700 first:rounded-t-md last:rounded-b-md ${
                                  currencyMode === option.value
                                    ? 'bg-slate-100 dark:bg-slate-700 font-medium'
                                    : ''
                                }`}
                              >
                                {option.label}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                    {/* View Mode Dropdown - only for treasury tab */}
                    {activeTab === 'treasury' && (
                      <div className="relative" ref={viewModeDropdownRef}>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setIsViewModeDropdownOpen(!isViewModeDropdownOpen)}
                          className="min-w-[120px] justify-between"
                        >
                          {getViewModeLabel(viewMode)}
                          <svg
                            className={`ml-2 h-4 w-4 transition-transform ${isViewModeDropdownOpen ? 'rotate-180' : ''}`}
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                          </svg>
                        </Button>
                        {isViewModeDropdownOpen && (
                          <div className="absolute left-0 mt-1 w-full min-w-[120px] rounded-md border bg-white text-slate-900 shadow-lg dark:bg-slate-800 dark:border-slate-700 dark:text-slate-200 z-10">
                            {viewModeOptions.map((option) => (
                              <button
                                key={option.value}
                                onClick={() => {
                                  setViewMode(option.value);
                                  setIsViewModeDropdownOpen(false);
                                }}
                                className={`w-full text-left px-4 py-2 text-sm hover:bg-slate-100 dark:hover:bg-slate-700 first:rounded-t-md last:rounded-b-md ${
                                  viewMode === option.value
                                    ? 'bg-slate-100 dark:bg-slate-700 font-medium'
                                    : ''
                                }`}
                              >
                                {option.label}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                    {/* Treasury Period Mode Dropdown - only for treasury tab */}
                    {activeTab === 'treasury' && (
                      <div className="relative" ref={treasuryPeriodDropdownRef}>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setIsTreasuryPeriodDropdownOpen(!isTreasuryPeriodDropdownOpen)}
                          className="min-w-[140px] justify-between"
                        >
                          {getTreasuryPeriodModeLabel(treasuryPeriodMode)}
                          <svg
                            className={`ml-2 h-4 w-4 transition-transform ${isTreasuryPeriodDropdownOpen ? 'rotate-180' : ''}`}
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                          </svg>
                        </Button>
                        {isTreasuryPeriodDropdownOpen && (
                          <div className="absolute left-0 mt-1 w-full min-w-[140px] rounded-md border bg-white text-slate-900 shadow-lg dark:bg-slate-800 dark:border-slate-700 dark:text-slate-200 z-10">
                            {treasuryPeriodModeOptions.map((option) => (
                              <button
                                key={option.value}
                                onClick={() => {
                                  setTreasuryPeriodMode(option.value);
                                  setIsTreasuryPeriodDropdownOpen(false);
                                }}
                                className={`w-full text-left px-4 py-2 text-sm hover:bg-slate-100 dark:hover:bg-slate-700 first:rounded-t-md last:rounded-b-md ${
                                  treasuryPeriodMode === option.value
                                    ? 'bg-slate-100 dark:bg-slate-700 font-medium'
                                    : ''
                                }`}
                              >
                                {option.label}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                    {/* Year Filter Dropdown - shown for both tabs, last */}
                    <div className="relative" ref={yearDropdownRef}>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setIsYearDropdownOpen(!isYearDropdownOpen)}
                        className="min-w-[100px] justify-between"
                      >
                        {getYearLabel(yearFilter)}
                        <svg
                          className={`ml-2 h-4 w-4 transition-transform ${isYearDropdownOpen ? 'rotate-180' : ''}`}
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </Button>
                      {isYearDropdownOpen && (
                        <div className="absolute right-0 mt-1 w-full min-w-[100px] rounded-md border bg-white text-slate-900 shadow-lg dark:bg-slate-800 dark:border-slate-700 dark:text-slate-200 z-10">
                          {yearOptions.map((option) => (
                            <button
                              key={option.value}
                              onClick={() => {
                                setYearFilter(option.value);
                                setIsYearDropdownOpen(false);
                              }}
                              className={`w-full text-left px-4 py-2 text-sm hover:bg-slate-100 dark:hover:bg-slate-700 first:rounded-t-md last:rounded-b-md ${
                                yearFilter === option.value
                                  ? 'bg-slate-100 dark:bg-slate-700 font-medium'
                                  : ''
                              }`}
                            >
                              {option.label}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    {/* DefiLlama View Mode Dropdown */}
                    {activeTab === 'defillama' && (
                      <div className="relative" ref={defiLlamaViewModeDropdownRef}>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setIsDefiLlamaViewModeDropdownOpen(!isDefiLlamaViewModeDropdownOpen)}
                          className="min-w-[120px] justify-between"
                        >
                          {getDefiLlamaViewModeLabel(defiLlamaViewMode)}
                          <svg
                            className={`ml-2 h-4 w-4 transition-transform ${isDefiLlamaViewModeDropdownOpen ? 'rotate-180' : ''}`}
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                          </svg>
                        </Button>
                        {isDefiLlamaViewModeDropdownOpen && (
                          <div className="absolute left-0 mt-1 w-full min-w-[120px] rounded-md border bg-white text-slate-900 shadow-lg dark:bg-slate-800 dark:border-slate-700 dark:text-slate-200 z-10">
                            {defiLlamaViewModeOptions.map((option) => (
                              <button
                                key={option.value}
                                onClick={() => {
                                  setDefiLlamaViewMode(option.value);
                                  setIsDefiLlamaViewModeDropdownOpen(false);
                                }}
                                className={`w-full text-left px-4 py-2 text-sm hover:bg-slate-100 dark:hover:bg-slate-700 first:rounded-t-md last:rounded-b-md ${
                                  defiLlamaViewMode === option.value
                                    ? 'bg-slate-100 dark:bg-slate-700 font-medium'
                                    : ''
                                }`}
                              >
                                {option.label}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </CardAction>
              </div>
              </CardHeader>
              <CardContent>
              <TabsContent value="treasury" className="mt-0">
              <div className="mt-4">
                {isLoadingData ? (
                  <Skeleton className="h-64 w-full" />
                ) : error ? (
                  <div className="flex items-center justify-center h-64 text-red-600 dark:text-red-400">
                    Failed to load monthly statement data
                  </div>
                ) : (viewMode === 'byRevenue' && statements.length === 0) ||
                    (viewMode === 'total' && statements.length === 0) || 
                    (viewMode === 'byToken' && statements.length === 0) ||
                    (viewMode === 'byVault' && vaultMonths.length === 0) ? (
                  <div className="flex items-center justify-center h-64 text-slate-500 dark:text-slate-400">
                    No data available for the specified period
                  </div>
                ) : (
                <div className="overflow-x-auto">
                  {viewMode === 'byRevenue' && (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-[200px]">Month</TableHead>
                          <TableHead className="text-right">From Vaults (USD)</TableHead>
                          <TableHead className="text-right">Miscellaneous Income (USD)</TableHead>
                          <TableHead className="text-right font-semibold">Total (USD)</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                      {statements.map((statement) => (
                        <TableRow key={statement.month}>
                          <TableCell className="font-medium">
                            {formatMonth(statement.month, treasuryPeriodMode)}
                            {!isPeriodComplete(statement.month, treasuryPeriodMode) && (
                              <span className="ml-2 text-amber-500">*</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            {formatCompactUSD(statement.vaultFeesTotal.usd)}
                          </TableCell>
                          <TableCell className="text-right">
                            {formatCompactUSD(statement.miscellaneousTotal.usd)}
                          </TableCell>
                          <TableCell className="text-right font-semibold">
                            {formatCompactUSD(statement.total.usd)}
                          </TableCell>
                        </TableRow>
                      ))}
                        <TableRow className="bg-slate-50 dark:bg-slate-800 font-semibold">
                          <TableCell className="font-semibold">Total</TableCell>
                          <TableCell className="text-right font-semibold">
                            {formatCompactUSD(grandVaultFeesUSD)}
                          </TableCell>
                          <TableCell className="text-right font-semibold">
                            {formatCompactUSD(grandMiscUSD)}
                          </TableCell>
                          <TableCell className="text-right font-semibold">
                            {formatCompactUSD(grandTotalUSD)}
                          </TableCell>
                        </TableRow>
                      </TableBody>
                    </Table>
                  )}

                  {viewMode === 'total' && (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-[200px]">Month</TableHead>
                          <TableHead className="text-right font-semibold">Total Revenue (USD)</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                      {statements.map((statement) => (
                        <TableRow key={statement.month}>
                          <TableCell className="font-medium">
                            {formatMonth(statement.month, treasuryPeriodMode)}
                            {!isPeriodComplete(statement.month, treasuryPeriodMode) && (
                              <span className="ml-2 text-amber-500">*</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right font-semibold">
                            {formatCompactUSD(statement.total.usd)}
                          </TableCell>
                        </TableRow>
                      ))}
                        <TableRow className="bg-slate-50 dark:bg-slate-800 font-semibold">
                          <TableCell className="font-semibold">Total</TableCell>
                          <TableCell className="text-right font-semibold">
                            {formatCompactUSD(grandTotalUSD)}
                          </TableCell>
                        </TableRow>
                      </TableBody>
                    </Table>
                  )}

                  {viewMode === 'byToken' && (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[200px]">Month</TableHead>
                        <TableHead className="text-right">
                            {currencyMode === 'usd' ? 'USDC Revenue' : 'USDC'}
                        </TableHead>
                        <TableHead className="text-right">
                            {currencyMode === 'usd' ? 'cbBTC Revenue' : 'cbBTC'}
                        </TableHead>
                        <TableHead className="text-right">
                            {currencyMode === 'usd' ? 'WETH Revenue' : 'WETH'}
                        </TableHead>
                        <TableHead className="text-right font-semibold">
                            {currencyMode === 'usd' ? 'Total Revenue' : 'Total (USD)'}
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {statements.map((statement) => (
                        <TableRow key={statement.month}>
                          <TableCell className="font-medium">
                            {formatMonth(statement.month, treasuryPeriodMode)}
                            {!isPeriodComplete(statement.month, treasuryPeriodMode) && (
                              <span className="ml-2 text-amber-500">*</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            {formatAmount(statement.vaultFees.USDC, 'USDC')}
                          </TableCell>
                          <TableCell className="text-right">
                            {formatAmount(statement.vaultFees.cbBTC, 'cbBTC')}
                          </TableCell>
                          <TableCell className="text-right">
                            {formatAmount(statement.vaultFees.WETH, 'WETH')}
                          </TableCell>
                          <TableCell className="text-right font-semibold">
                            {formatCompactUSD(statement.total.usd)}
                          </TableCell>
                        </TableRow>
                      ))}
                      <TableRow className="bg-slate-50 dark:bg-slate-800 font-semibold">
                        <TableCell className="font-semibold">Total</TableCell>
                        <TableCell className="text-right font-semibold">
                            {currencyMode === 'usd' 
                              ? formatCompactUSD(statements.reduce((sum, s) => sum + s.vaultFees.USDC.usd, 0))
                              : formatTokenAmount(statements.reduce((sum, s) => sum + s.vaultFees.USDC.tokens, 0), 'USDC')
                          }
                        </TableCell>
                        <TableCell className="text-right font-semibold">
                            {currencyMode === 'usd' 
                              ? formatCompactUSD(statements.reduce((sum, s) => sum + s.vaultFees.cbBTC.usd, 0))
                              : formatTokenAmount(statements.reduce((sum, s) => sum + s.vaultFees.cbBTC.tokens, 0), 'cbBTC')
                          }
                        </TableCell>
                        <TableCell className="text-right font-semibold">
                            {currencyMode === 'usd' 
                              ? formatCompactUSD(statements.reduce((sum, s) => sum + s.vaultFees.WETH.usd, 0))
                              : formatTokenAmount(statements.reduce((sum, s) => sum + s.vaultFees.WETH.tokens, 0), 'WETH')
                          }
                        </TableCell>
                        <TableCell className="text-right font-semibold">
                          {formatCompactUSD(grandTotalUSD)}
                        </TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                  )}

                  {viewMode === 'byVault' && (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-[200px]">Month</TableHead>
                          {vaultAddresses.map((addr) => (
                            <TableHead key={addr} className="text-right">
                              {VAULT_NAMES[addr.toLowerCase()] || `${addr.slice(0, 6)}...${addr.slice(-4)}`}
                            </TableHead>
                          ))}
                          <TableHead className="text-right font-semibold">
                            {currencyMode === 'usd' ? 'Total Revenue' : 'Total (USD)'}
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {vaultMonths.map((month) => {
                          const monthVaults = vaultDataByMonth[month] || [];
                          const monthTotalUSD = monthVaults.reduce((sum, v) => sum + v.usd, 0);
                          return (
                            <TableRow key={month}>
                            <TableCell className="font-medium">
                              {formatMonth(month, treasuryPeriodMode)}
                              {!isPeriodComplete(month, treasuryPeriodMode) && (
                                <span className="ml-2 text-amber-500">*</span>
                              )}
                            </TableCell>
                              {vaultAddresses.map((addr) => {
                                const vaultData = monthVaults.find(v => v.vaultAddress.toLowerCase() === addr);
                                return (
                                  <TableCell key={addr} className="text-right">
                                    {vaultData 
                                      ? (currencyMode === 'usd' 
                                          ? formatCompactUSD(vaultData.usd)
                                          : formatTokenAmount(vaultData.tokens, vaultData.asset))
                                      : '-'
                                    }
                                  </TableCell>
                                );
                              })}
                              <TableCell className="text-right font-semibold">
                                {formatCompactUSD(monthTotalUSD)}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                        <TableRow className="bg-slate-50 dark:bg-slate-800 font-semibold">
                          <TableCell className="font-semibold">Total</TableCell>
                          {vaultAddresses.map((addr) => (
                            <TableCell key={addr} className="text-right font-semibold">
                              {currencyMode === 'usd'
                                ? formatCompactUSD(vaultTotals[addr]?.usd || 0)
                                : (() => {
                                    const vault = filteredVaultData.find(v => v.vaultAddress.toLowerCase() === addr);
                                    return vault 
                                      ? formatTokenAmount(vaultTotals[addr]?.tokens || 0, vault.asset)
                                      : '-';
                                  })()
                              }
                            </TableCell>
                          ))}
                          <TableCell className="text-right font-semibold">
                            {formatCompactUSD(
                              vaultAddresses.reduce((sum, addr) => sum + (vaultTotals[addr]?.usd || 0), 0)
                            )}
                          </TableCell>
                        </TableRow>
                      </TableBody>
                    </Table>
                  )}
                </div>
                )}
              </div>
            </TabsContent>
            <TabsContent value="defillama" className="mt-0">
              <div className="mt-4">
                {isLoadingData ? (
                  <Skeleton className="h-64 w-full" />
                ) : defiLlamaError ? (
                  <div className="flex items-center justify-center h-64 text-red-600">
                    Failed to load DefiLlama statement data
                  </div>
                ) : aggregatedDefiLlamaData.length === 0 ? (
                  <div className="flex items-center justify-center h-64 text-slate-500 dark:text-slate-400">
                    No data available for the specified period
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-[200px]">
                            {defiLlamaViewMode === 'month' ? 'Month' : defiLlamaViewMode === 'quarter' ? 'Quarter' : 'Year'}
                          </TableHead>
                          <TableHead className="text-right">
                            <div className="flex items-center justify-end gap-1">
                              Gross Protocol Revenue
                              <InfoTooltip 
                                id="grossProtocolRevenue" 
                                content="Total yields from deposited assets in all curated vaults." 
                              />
                            </div>
                          </TableHead>
                          <TableHead className="text-right">
                            <div className="flex items-center justify-end gap-1">
                              Cost of Revenue
                              <InfoTooltip 
                                id="costOfRevenue" 
                                content="Yields are distributed to vaults depositors/investors." 
                              />
                            </div>
                          </TableHead>
                          <TableHead className="text-right">
                            <div className="flex items-center justify-end gap-1">
                              Total Revenue
                              <InfoTooltip 
                                id="totalRevenue" 
                                content="Yields are collected by curators." 
                              />
                            </div>
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {aggregatedDefiLlamaData.map((statement) => (
                          <TableRow key={statement.month}>
                            <TableCell className="font-medium">
                              {formatPeriod(statement.month)}
                              {!isPeriodComplete(statement.month, defiLlamaViewMode) && (
                                <span className="ml-2 text-amber-500">*</span>
                              )}
                            </TableCell>
                            <TableCell className="text-right">
                              {formatCompactUSD(statement.grossProtocolRevenue)}
                            </TableCell>
                            <TableCell className="text-right">
                              {formatCompactUSD(statement.costOfRevenue)}
                            </TableCell>
                            <TableCell className="text-right">
                              {formatCompactUSD(statement.grossProfit)}
                            </TableCell>
                          </TableRow>
                        ))}
                        <TableRow className="bg-slate-50 dark:bg-slate-800 font-semibold">
                          <TableCell className="font-semibold">Total</TableCell>
                          <TableCell className="text-right font-semibold">
                            {formatCompactUSD(defiLlamaTotals.grossProtocolRevenue)}
                          </TableCell>
                          <TableCell className="text-right font-semibold">
                            {formatCompactUSD(defiLlamaTotals.costOfRevenue)}
                          </TableCell>
                          <TableCell className="text-right font-semibold">
                            {formatCompactUSD(defiLlamaTotals.grossProfit)}
                          </TableCell>
                        </TableRow>
                      </TableBody>
                    </Table>
                  </div>
                )}
              </div>
            </TabsContent>
              </CardContent>
          </Tabs>
            </Card>
      </div>
    </AppShell>
  );
}
