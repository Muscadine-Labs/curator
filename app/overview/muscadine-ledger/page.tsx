'use client';

import { useState, useMemo, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AppShell } from '@/components/layout/AppShell';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { formatCompactUSD } from '@/lib/format/number';
import { Alert } from '@/components/ui/alert';
import { Filter, ChevronDown, ChevronUp } from 'lucide-react';
import { logger } from '@/lib/utils/logger';
import { apiFetch } from '@/lib/data/api-fetch';
import {
  MUSCADINE_LEDGER_SHEET_GIDS,
  MUSCADINE_LEDGER_SHEET_IDS,
  MUSCADINE_LEDGER_SHEET_NAMES,
  getMuscadineLedgerYears,
} from '@/lib/constants';

interface GoogleSheetsData {
  rows: Array<Record<string, string>>;
}

type LedgerState = 'Georgia' | 'Wyoming';

export default function MuscadineLedgerPage() {
  const [activeTab, setActiveTab] = useState<'view' | 'edit'>('view');
  const [selectedState, setSelectedState] = useState<LedgerState>('Georgia'); // Default to Georgia
  const [sheetName, setSheetName] = useState<string>('All'); // Default to All
  const [selectedYear, setSelectedYear] = useState<string>('2026'); // Default to 2026
  const [showFilters, setShowFilters] = useState(false);
  const [visibleColumns, setVisibleColumns] = useState<Record<string, boolean>>({});
  const [expensesVisibleColumns, setExpensesVisibleColumns] = useState<Record<string, boolean>>({});
  const [incomeVisibleColumns, setIncomeVisibleColumns] = useState<Record<string, boolean>>({});

  const availableYears = useMemo(
    () => getMuscadineLedgerYears(selectedState),
    [selectedState]
  );

  useEffect(() => {
    if (availableYears.length > 0 && !availableYears.includes(selectedYear)) {
      setSelectedYear(availableYears[0]!);
    }
  }, [availableYears, selectedYear]);

  // Get the current sheet ID based on selected state and year
  const currentSheetId =
    MUSCADINE_LEDGER_SHEET_IDS[selectedState]?.[selectedYear] ?? '';

  // Fetch Expenses and Income sheets when "All" is selected
  const { data: allSheetsData, isLoading: isAllSheetsLoading } = useQuery<Record<string, GoogleSheetsData>>({
    queryKey: ['google-sheets-all', currentSheetId, selectedState],
    queryFn: async () => {
      const results: Record<string, GoogleSheetsData> = {};
      await Promise.all(
        MUSCADINE_LEDGER_SHEET_NAMES.map(async (name) => {
          try {
            const params = new URLSearchParams({ sheetId: currentSheetId, sheetName: name });
            const response = await apiFetch(`/api/google-sheets?${params.toString()}`, {
              credentials: 'omit',
            });
            if (response.ok) {
              results[name] = await response.json();
            }
          } catch (error) {
            logger.error(`Failed to fetch ${name}`, error instanceof Error ? error : new Error(String(error)));
          }
        })
      );
      return results;
    },
    enabled: activeTab === 'view' && sheetName === 'All',
  });

  // Fetch single sheet when specific sheet is selected
  const { data: singleSheetData, isLoading: isSingleSheetLoading, error: singleSheetError } = useQuery<GoogleSheetsData>({
    queryKey: ['google-sheets', currentSheetId, sheetName, selectedState],
    queryFn: async () => {
      const params = new URLSearchParams({ sheetId: currentSheetId });
      if (sheetName && sheetName !== 'All') {
        params.append('sheetName', sheetName);
      }
      const response = await apiFetch(`/api/google-sheets?${params.toString()}`, {
        credentials: 'omit',
      });
      if (!response.ok) throw new Error('Failed to fetch Google Sheets data');
      return response.json();
    },
    enabled: activeTab === 'view' && sheetName !== 'All',
  });

  const sheetsError = singleSheetError;

  // Combine data based on selection
  const sheetsData = useMemo(() => {
    if (sheetName === 'All' && allSheetsData) {
      // For "All", combine Expenses and Income
      const allRows: Array<Record<string, string>> = [];
      if (allSheetsData['Expenses']?.rows) {
        allRows.push(...allSheetsData['Expenses'].rows);
      }
      if (allSheetsData['Income']?.rows) {
        allRows.push(...allSheetsData['Income'].rows);
      }
      return { rows: allRows };
    }
    return singleSheetData;
  }, [sheetName, allSheetsData, singleSheetData]);

  // Separate Expenses and Income data for "All" view
  const expensesData = useMemo(() => {
    if (sheetName !== 'All' || !allSheetsData) return null;
    return allSheetsData['Expenses'];
  }, [sheetName, allSheetsData]);

  const incomeData = useMemo(() => {
    if (sheetName !== 'All' || !allSheetsData) return null;
    return allSheetsData['Income'];
  }, [sheetName, allSheetsData]);

  // Get column headers for Expenses
  const expensesColumnHeaders = useMemo(() => {
    if (!expensesData?.rows || expensesData.rows.length === 0) return [];
    return Object.keys(expensesData.rows[0]);
  }, [expensesData]);

  // Get column headers for Income
  const incomeColumnHeaders = useMemo(() => {
    if (!incomeData?.rows || incomeData.rows.length === 0) return [];
    return Object.keys(incomeData.rows[0]);
  }, [incomeData]);

  const isSheetsLoading = sheetName === 'All' ? isAllSheetsLoading : isSingleSheetLoading;

  // Helper to check if date matches year (handles various formats)
  const dateMatchesYear = (dateStr: string, year: number): boolean => {
    if (!dateStr) return false;
    // Handle YYYY-MM-DD format
    if (dateStr.startsWith(year.toString())) return true;
    // Handle other formats that might contain the year
    if (dateStr.includes(`-${year}-`) || dateStr.includes(`/${year}/`) || dateStr.includes(`/${year}`)) return true;
    return false;
  };

  // Helper function to check if a row is a valid data row (not a header, total, or empty row)
  const isValidDataRow = (row: Record<string, string>): boolean => {
    // Skip rows that are clearly totals or summaries
    const dateStr = (row.Date || row.date || '').toLowerCase();
    const vendorStr = (row.Vendor || row.vendor || '').toLowerCase();
    const descriptionStr = (row.Description || row.description || '').toLowerCase();
    
    // Skip if date contains "total" or similar keywords
    if (dateStr.includes('total') || dateStr.includes('gross') || dateStr.includes('net')) {
      return false;
    }
    
    // Skip if vendor or description contains "total" or "gross"
    if (vendorStr.includes('total') || descriptionStr.includes('total') || 
        vendorStr.includes('gross') || descriptionStr.includes('gross')) {
      return false;
    }
    
    // Skip empty rows (no date and no vendor)
    if (!dateStr && !vendorStr) {
      return false;
    }
    
    return true;
  };

  // Filter data by selected year
  const filterYear = parseInt(selectedYear);
  const filteredYearData = useMemo(() => {
    if (!sheetsData?.rows) return [];
    return sheetsData.rows.filter((row) => {
      // First check if it's a valid data row
      if (!isValidDataRow(row)) return false;
      
      const dateStr = row.Date || row.date || '';
      if (!dateStr) return false;
      // Check if date matches selected year
      return dateMatchesYear(dateStr, filterYear);
    });
  }, [sheetsData, filterYear]);

  // Filter Expenses data by year
  const filteredExpensesData = useMemo(() => {
    if (!expensesData?.rows) return [];
    return expensesData.rows.filter((row) => {
      if (!isValidDataRow(row)) return false;
      const dateStr = row.Date || row.date || '';
      return dateMatchesYear(dateStr, filterYear);
    });
  }, [expensesData, filterYear]);

  // Filter Income data by year
  const filteredIncomeData = useMemo(() => {
    if (!incomeData?.rows) return [];
    return incomeData.rows.filter((row) => {
      if (!isValidDataRow(row)) return false;
      const dateStr = row.Date || row.date || '';
      return dateMatchesYear(dateStr, filterYear);
    });
  }, [incomeData, filterYear]);

  // Helper function to parse amount from row, handling various column name formats
  const parseAmount = (row: Record<string, string>): number => {
    // Try different possible column names (case-insensitive search)
    let amountStr = '';
    const rowKeys = Object.keys(row);
    
    // Find amount column (case-insensitive)
    for (const key of rowKeys) {
      const keyLower = key.toLowerCase();
      if (keyLower.includes('amount') && (keyLower.includes('usd') || keyLower.includes('$'))) {
        amountStr = row[key];
        break;
      }
    }
    
    // Fallback to common variations
    if (!amountStr) {
      amountStr = row['Amount (USD)'] || row['Amount'] || row['amount'] || row['Amount(USD)'] || row['Amount USD'] || '0';
    }
    
    if (!amountStr || amountStr === '' || amountStr === 'N/A') return 0;
    
    // Remove any currency symbols, commas, and whitespace
    const cleaned = amountStr.toString().replace(/[$,\s]/g, '').trim();
    const parsed = parseFloat(cleaned);
    return isNaN(parsed) ? 0 : parsed;
  };

  // Calculate summary metrics - Business Ledger = Expenses + Income
  const summaryMetrics = useMemo(() => {
    if (!allSheetsData || sheetName !== 'All') {
      return { netRevenue: 0, netExpenses: 0, grossProfit: 0 };
    }

    let netRevenue = 0;
    let netExpenses = 0;

    // Calculate Net Revenue from Income sheet (all entries are income)
    const incomeData = allSheetsData['Income'];
    if (incomeData?.rows) {
      incomeData.rows.forEach((row) => {
        if (!isValidDataRow(row)) return;
        
        const dateStr = row.Date || row.date || '';
        if (dateStr && dateMatchesYear(dateStr, filterYear)) {
          const amount = parseAmount(row);
          // Add all valid amounts (income)
          netRevenue += amount;
        }
      });
    }

    // Calculate Net Expenses from Expenses sheet (all entries are expenses)
    const expensesData = allSheetsData['Expenses'];
    if (expensesData?.rows) {
      expensesData.rows.forEach((row) => {
        if (!isValidDataRow(row)) return;
        
        const dateStr = row.Date || row.date || '';
        if (dateStr && dateMatchesYear(dateStr, filterYear)) {
          const amount = parseAmount(row);
          // Add all valid amounts (expenses are positive values representing money spent)
          netExpenses += amount;
        }
      });
    }

    // Net Total = Net Revenue - Net Expenses
    // Income adds, Expenses subtracts
    const netTotal = netRevenue - netExpenses;

    return { netRevenue, netExpenses, grossProfit: netTotal };
  }, [allSheetsData, sheetName, filterYear]);

  // Get column headers from first row
  const columnHeaders = useMemo(() => {
    if (!sheetsData?.rows || sheetsData.rows.length === 0) return [];
    return Object.keys(sheetsData.rows[0]);
  }, [sheetsData]);

  // Initialize visible columns with defaults based on sheet type
  // Only set defaults for columns that haven't been configured yet
  useEffect(() => {
    if (columnHeaders.length === 0) return;
    
    // Check if we need to initialize defaults for any current columns
    const needsInitialization = columnHeaders.some(header => visibleColumns[header] === undefined);
    
    if (needsInitialization) {
      const defaultVisible: Record<string, boolean> = { ...visibleColumns };
      
      // Determine default columns based on sheet type
      const isIncomeSheet = sheetName === 'Income';
      
      columnHeaders.forEach((header) => {
        // Only set defaults for columns that haven't been set yet
        if (defaultVisible[header] === undefined) {
          const headerLower = header.toLowerCase();
          const isDate = headerLower.includes('date');
          const isAmount = headerLower.includes('amount') || headerLower.includes('usd');
          
          if (isIncomeSheet) {
            // For Income sheet: Date, Token, Source, Amount (USD)
            const isToken = headerLower.includes('token');
            const isSource = headerLower.includes('source');
            defaultVisible[header] = isDate || isToken || isSource || isAmount;
          } else {
            // For other sheets (All, Expenses, etc.): Date, Vendor, Amount (USD)
            const isVendor = headerLower.includes('vendor');
            defaultVisible[header] = isDate || isVendor || isAmount;
          }
        }
      });
      
      setVisibleColumns(defaultVisible);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columnHeaders, sheetName]);

  // Get filtered column headers based on visibility
  // If column hasn't been explicitly set, default to visible (true)
  const filteredColumnHeaders = useMemo(() => {
    return columnHeaders.filter((header) => {
      const visibility = visibleColumns[header];
      // If not set, default to visible; otherwise use the set value
      return visibility === undefined ? true : visibility !== false;
    });
  }, [columnHeaders, visibleColumns]);

  // Get filtered Expenses column headers
  const filteredExpensesColumnHeaders = useMemo(() => {
    return expensesColumnHeaders.filter((header) => {
      const visibility = expensesVisibleColumns[header];
      return visibility === undefined ? true : visibility !== false;
    });
  }, [expensesColumnHeaders, expensesVisibleColumns]);

  // Get filtered Income column headers
  const filteredIncomeColumnHeaders = useMemo(() => {
    return incomeColumnHeaders.filter((header) => {
      const visibility = incomeVisibleColumns[header];
      return visibility === undefined ? true : visibility !== false;
    });
  }, [incomeColumnHeaders, incomeVisibleColumns]);

  // Initialize Expenses column visibility defaults
  useEffect(() => {
    if (expensesColumnHeaders.length === 0) return;
    const needsInit = expensesColumnHeaders.some(h => expensesVisibleColumns[h] === undefined);
    if (needsInit) {
      const defaultVisible: Record<string, boolean> = { ...expensesVisibleColumns };
      expensesColumnHeaders.forEach((header) => {
        if (defaultVisible[header] === undefined) {
          const headerLower = header.toLowerCase();
          const isDate = headerLower.includes('date');
          const isVendor = headerLower.includes('vendor');
          const isAmount = headerLower.includes('amount') || headerLower.includes('usd');
          defaultVisible[header] = isDate || isVendor || isAmount;
        }
      });
      setExpensesVisibleColumns(defaultVisible);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expensesColumnHeaders]);

  // Initialize Income column visibility defaults
  useEffect(() => {
    if (incomeColumnHeaders.length === 0) return;
    const needsInit = incomeColumnHeaders.some(h => incomeVisibleColumns[h] === undefined);
    if (needsInit) {
      const defaultVisible: Record<string, boolean> = { ...incomeVisibleColumns };
      incomeColumnHeaders.forEach((header) => {
        if (defaultVisible[header] === undefined) {
          const headerLower = header.toLowerCase();
          const isDate = headerLower.includes('date');
          const isToken = headerLower.includes('token');
          const isSource = headerLower.includes('source');
          const isAmount = headerLower.includes('amount') || headerLower.includes('usd');
          defaultVisible[header] = isDate || isToken || isSource || isAmount;
        }
      });
      setIncomeVisibleColumns(defaultVisible);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incomeColumnHeaders]);

  // Calculate totals separately for Expenses and Income
  const expensesTotal = useMemo(() => {
    if (!filteredExpensesData || filteredExpensesData.length === 0) return 0;
    let total = 0;
    filteredExpensesData.forEach((row) => {
      const amount = parseAmount(row);
      if (amount > 0) {
        total -= amount; // Expenses subtract (negative)
      }
    });
    return total;
  }, [filteredExpensesData]);

  const incomeTotal = useMemo(() => {
    if (!filteredIncomeData || filteredIncomeData.length === 0) return 0;
    let total = 0;
    filteredIncomeData.forEach((row) => {
      const amount = parseAmount(row);
      if (amount > 0) {
        total += amount; // Income adds (positive)
      }
    });
    return total;
  }, [filteredIncomeData]);

  // Calculate total for current sheet view (for non-"All" views)
  // Income adds (positive), Expenses subtracts (negative)
  const sheetTotal = useMemo(() => {
    if (sheetName === 'All') return 0; // Not used for "All" view
    if (!filteredYearData || filteredYearData.length === 0) return 0;
    
    let total = 0;
    filteredYearData.forEach((row) => {
      const amount = parseAmount(row);
      if (amount > 0) {
        if (sheetName === 'Income') {
          total += amount;
        } else if (sheetName === 'Expenses') {
          total -= amount;
        }
      }
    });
    
    return total;
  }, [filteredYearData, sheetName]);

  // Get the Google Sheets embed URL (memoized to avoid recalculation)
  const embedUrl = useMemo(() => {
    if (sheetName === 'All') {
      return `https://docs.google.com/spreadsheets/d/${currentSheetId}/edit?usp=sharing`;
    }
    const gid = MUSCADINE_LEDGER_SHEET_GIDS[sheetName] || '0';
    return `https://docs.google.com/spreadsheets/d/${currentSheetId}/edit?usp=sharing#gid=${gid}`;
  }, [sheetName, currentSheetId]);

  return (
    <AppShell
      title="Muscadine Ledger"
      description="Business ledger with treasury wallet revenue tracking and Google Sheets integration."
    >
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <CardTitle className="text-lg sm:text-xl">{selectedYear} {selectedState} Business Ledger</CardTitle>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={selectedState}
                  onChange={(e) => setSelectedState(e.target.value as LedgerState)}
                  className="px-3 py-2 text-sm border border-slate-300 rounded-md dark:bg-slate-800 dark:border-slate-700 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="Georgia">Georgia</option>
                  <option value="Wyoming">Wyoming</option>
                </select>
                <select
                  value={selectedYear}
                  onChange={(e) => {
                    setSelectedYear(e.target.value);
                    // Don't reset visible columns when year changes - preserve user's filter choices
                  }}
                  className="px-3 py-2 text-sm border border-slate-300 rounded-md dark:bg-slate-800 dark:border-slate-700 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {availableYears.map((year) => (
                    <option key={year} value={year}>{year}</option>
                  ))}
                </select>
                <select
                  value={sheetName}
                  onChange={(e) => setSheetName(e.target.value)}
                  className="w-full sm:w-auto px-3 py-2 text-sm border border-slate-300 rounded-md dark:bg-slate-800 dark:border-slate-700 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="All">All</option>
                  <option value="Expenses">Expenses</option>
                  <option value="Income">Income</option>
                </select>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as 'view' | 'edit')}>
              <TabsList className="mb-4">
                <TabsTrigger value="view">View ({selectedYear})</TabsTrigger>
                <TabsTrigger value="edit">Edit</TabsTrigger>
              </TabsList>

              <TabsContent value="view">
                {isSheetsLoading ? (
                  <Skeleton className="h-64 w-full" />
                ) : sheetsError ? (
                  <Alert className="bg-red-50 border-red-200 text-red-800 dark:bg-red-900/20 dark:border-red-800 dark:text-red-200">
                    Error loading Google Sheets: {sheetsError instanceof Error ? sheetsError.message : 'Unknown error'}
                  </Alert>
                ) : sheetName === 'All' ? (
                  // Show separate Expenses and Income sections for "All"
                  <>
                    {/* Column Filters for "All" view */}
                    <div className="mb-4">
                      <button
                        onClick={() => setShowFilters(!showFilters)}
                        className="flex items-center gap-2 w-full sm:w-auto px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
                      >
                        <Filter className="h-4 w-4" />
                        <span>Column Filters</span>
                        {showFilters ? (
                          <ChevronUp className="h-4 w-4 ml-auto" />
                        ) : (
                          <ChevronDown className="h-4 w-4 ml-auto" />
                        )}
                      </button>
                      {showFilters && (
                        <div className="mt-3 space-y-4">
                          {/* Expenses Filters */}
                          {expensesColumnHeaders.length > 0 && (
                            <div className="p-4 bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-200 dark:border-red-800">
                              <div className="text-xs font-semibold text-red-700 dark:text-red-300 mb-3 uppercase tracking-wide">
                                Expenses Columns
                              </div>
                              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                                {expensesColumnHeaders.map((header) => (
                                  <label
                                    key={header}
                                    className="flex items-center gap-2 cursor-pointer text-sm text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100"
                                  >
                                    <input
                                      type="checkbox"
                                      checked={expensesVisibleColumns[header] !== false}
                                      onChange={(e) => {
                                        setExpensesVisibleColumns((prev) => ({
                                          ...prev,
                                          [header]: e.target.checked,
                                        }));
                                      }}
                                      className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-700"
                                    />
                                    <span className="truncate">{header}</span>
                                  </label>
                                ))}
                              </div>
                            </div>
                          )}
                          {/* Income Filters */}
                          {incomeColumnHeaders.length > 0 && (
                            <div className="p-4 bg-green-50 dark:bg-green-900/20 rounded-lg border border-green-200 dark:border-green-800">
                              <div className="text-xs font-semibold text-green-700 dark:text-green-300 mb-3 uppercase tracking-wide">
                                Income Columns
                              </div>
                              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                                {incomeColumnHeaders.map((header) => (
                                  <label
                                    key={header}
                                    className="flex items-center gap-2 cursor-pointer text-sm text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100"
                                  >
                                    <input
                                      type="checkbox"
                                      checked={incomeVisibleColumns[header] !== false}
                                      onChange={(e) => {
                                        setIncomeVisibleColumns((prev) => ({
                                          ...prev,
                                          [header]: e.target.checked,
                                        }));
                                      }}
                                      className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-700"
                                    />
                                    <span className="truncate">{header}</span>
                                  </label>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Expenses Section */}
                    {filteredExpensesData && filteredExpensesData.length > 0 && (
                      <div className="mb-8">
                        <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-4">Expenses</h3>
                        <div className="overflow-x-auto -mx-4 sm:mx-0">
                          <div className="inline-block min-w-full align-middle">
                            <Table>
                              <TableHeader>
                                <TableRow className="bg-red-50 dark:bg-red-900/20">
                                  {filteredExpensesColumnHeaders.map((header) => (
                                    <TableHead key={header} className="whitespace-nowrap">
                                      {header}
                                    </TableHead>
                                  ))}
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {filteredExpensesData.map((row, index) => (
                                  <TableRow key={index} className="bg-red-50/50 dark:bg-red-900/10 hover:bg-red-100/50 dark:hover:bg-red-900/20">
                                    {filteredExpensesColumnHeaders.map((header) => (
                                      <TableCell key={header} className="whitespace-nowrap">
                                        {String(row[header] || '')}
                                      </TableCell>
                                    ))}
                                  </TableRow>
                                ))}
                                {/* Expenses Total Row */}
                                {filteredExpensesColumnHeaders.some(h => h.toLowerCase().includes('amount')) && (
                                  <TableRow className="bg-red-100 dark:bg-red-900/30 font-semibold">
                                    {filteredExpensesColumnHeaders.map((header) => {
                                      const headerLower = header.toLowerCase();
                                      if (headerLower.includes('amount') || headerLower.includes('usd')) {
                                        return (
                                          <TableCell key={header} className="whitespace-nowrap text-right font-semibold">
                                            <span className="text-red-600 dark:text-red-400">
                                              {formatCompactUSD(Math.abs(expensesTotal))}
                                            </span>
                                          </TableCell>
                                        );
                                      } else if (headerLower.includes('date')) {
                                        return (
                                          <TableCell key={header} className="whitespace-nowrap font-semibold">
                                            Total
                                          </TableCell>
                                        );
                                      } else {
                                        return <TableCell key={header} className="whitespace-nowrap"></TableCell>;
                                      }
                                    })}
                                  </TableRow>
                                )}
                              </TableBody>
                            </Table>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Income Section */}
                    {filteredIncomeData && filteredIncomeData.length > 0 && (
                      <div>
                        <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-4">Income</h3>
                        <div className="overflow-x-auto -mx-4 sm:mx-0">
                          <div className="inline-block min-w-full align-middle">
                            <Table>
                              <TableHeader>
                                <TableRow className="bg-green-50 dark:bg-green-900/20">
                                  {filteredIncomeColumnHeaders.map((header) => (
                                    <TableHead key={header} className="whitespace-nowrap">
                                      {header}
                                    </TableHead>
                                  ))}
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {filteredIncomeData.map((row, index) => (
                                  <TableRow key={index} className="bg-green-50/50 dark:bg-green-900/10 hover:bg-green-100/50 dark:hover:bg-green-900/20">
                                    {filteredIncomeColumnHeaders.map((header) => (
                                      <TableCell key={header} className="whitespace-nowrap">
                                        {String(row[header] || '')}
                                      </TableCell>
                                    ))}
                                  </TableRow>
                                ))}
                                {/* Income Total Row */}
                                {filteredIncomeColumnHeaders.some(h => h.toLowerCase().includes('amount')) && (
                                  <TableRow className="bg-green-100 dark:bg-green-900/30 font-semibold">
                                    {filteredIncomeColumnHeaders.map((header) => {
                                      const headerLower = header.toLowerCase();
                                      if (headerLower.includes('amount') || headerLower.includes('usd')) {
                                        return (
                                          <TableCell key={header} className="whitespace-nowrap text-right font-semibold">
                                            <span className="text-green-600 dark:text-green-400">
                                              +{formatCompactUSD(incomeTotal)}
                                            </span>
                                          </TableCell>
                                        );
                                      } else if (headerLower.includes('date')) {
                                        return (
                                          <TableCell key={header} className="whitespace-nowrap font-semibold">
                                            Total
                                          </TableCell>
                                        );
                                      } else {
                                        return <TableCell key={header} className="whitespace-nowrap"></TableCell>;
                                      }
                                    })}
                                  </TableRow>
                                )}
                              </TableBody>
                            </Table>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Show message if no data */}
                    {(!filteredExpensesData || filteredExpensesData.length === 0) && 
                     (!filteredIncomeData || filteredIncomeData.length === 0) && (
                      <div className="flex items-center justify-center h-64 text-slate-500 dark:text-slate-400">
                        No data available for {selectedYear}
                      </div>
                    )}

                    {/* Summary Metrics for "All" view */}
                    <div className="mt-6 grid grid-cols-1 sm:grid-cols-3 gap-4">
                      <div className="p-4 bg-slate-50 dark:bg-slate-800 rounded-lg">
                        <div className="text-sm text-slate-600 dark:text-slate-400 mb-1">Net Revenue</div>
                        <div className="text-xl sm:text-2xl font-semibold text-green-600 dark:text-green-400">
                          {formatCompactUSD(summaryMetrics.netRevenue)}
                        </div>
                      </div>
                      <div className="p-4 bg-slate-50 dark:bg-slate-800 rounded-lg">
                        <div className="text-sm text-slate-600 dark:text-slate-400 mb-1">Net Expenses</div>
                        <div className="text-xl sm:text-2xl font-semibold text-red-600 dark:text-red-400">
                          {formatCompactUSD(summaryMetrics.netExpenses)}
                        </div>
                      </div>
                      <div className="p-4 bg-slate-50 dark:bg-slate-800 rounded-lg">
                        <div className="text-sm text-slate-600 dark:text-slate-400 mb-1">Net Total</div>
                        <div className={`text-xl sm:text-2xl font-semibold ${
                          summaryMetrics.grossProfit >= 0 
                            ? 'text-green-600 dark:text-green-400' 
                            : 'text-red-600 dark:text-red-400'
                        }`}>
                          {formatCompactUSD(summaryMetrics.grossProfit)}
                        </div>
                      </div>
                    </div>
                  </>
                ) : (
                  // Single sheet view (not "All")
                  !filteredYearData || filteredYearData.length === 0 ? (
                    <div className="flex items-center justify-center h-64 text-slate-500 dark:text-slate-400">
                      No data available for {selectedYear}
                    </div>
                  ) : (
                  <>
                    {/* Column Filters */}
                    <div className="mb-4">
                      <button
                        onClick={() => setShowFilters(!showFilters)}
                        className="flex items-center gap-2 w-full sm:w-auto px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
                      >
                        <Filter className="h-4 w-4" />
                        <span>Column Filters</span>
                        {showFilters ? (
                          <ChevronUp className="h-4 w-4 ml-auto" />
                        ) : (
                          <ChevronDown className="h-4 w-4 ml-auto" />
                        )}
                      </button>
                      {showFilters && (
                        <div className="mt-3 p-4 bg-slate-50 dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-700">
                          <div className="text-xs font-semibold text-slate-600 dark:text-slate-400 mb-3 uppercase tracking-wide">
                            Show Columns
                          </div>
                          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                            {columnHeaders.map((header) => (
                              <label
                                key={header}
                                className="flex items-center gap-2 cursor-pointer text-sm text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100"
                              >
                                <input
                                  type="checkbox"
                                  checked={visibleColumns[header] !== false}
                                  onChange={(e) => {
                                    setVisibleColumns((prev) => ({
                                      ...prev,
                                      [header]: e.target.checked,
                                    }));
                                  }}
                                  className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-700"
                                />
                                <span className="truncate">{header}</span>
                              </label>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Table */}
                    <div className="overflow-x-auto -mx-4 sm:mx-0">
                      <div className="inline-block min-w-full align-middle">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              {filteredColumnHeaders.map((header) => (
                                <TableHead key={header} className="whitespace-nowrap">
                                  {header}
                                </TableHead>
                              ))}
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {filteredYearData.map((row, index) => (
                              <TableRow key={index}>
                                {filteredColumnHeaders.map((header) => (
                                  <TableCell key={header} className="whitespace-nowrap">
                                    {String(row[header] || '')}
                                  </TableCell>
                                ))}
                              </TableRow>
                            ))}
                            {/* Total Row */}
                            {filteredColumnHeaders.some(h => h.toLowerCase().includes('amount')) && (
                              <TableRow className="bg-slate-50 dark:bg-slate-800 font-semibold">
                                {filteredColumnHeaders.map((header) => {
                                  const headerLower = header.toLowerCase();
                                  if (headerLower.includes('amount') || headerLower.includes('usd')) {
                                    return (
                                      <TableCell key={header} className="whitespace-nowrap text-right font-semibold">
                                        <span className={sheetTotal >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}>
                                          {sheetTotal >= 0 ? '+' : ''}{formatCompactUSD(sheetTotal)}
                                        </span>
                                      </TableCell>
                                    );
                                  } else if (headerLower.includes('date')) {
                                    return (
                                      <TableCell key={header} className="whitespace-nowrap font-semibold">
                                        Total
                                      </TableCell>
                                    );
                                  } else {
                                    return <TableCell key={header} className="whitespace-nowrap"></TableCell>;
                                  }
                                })}
                              </TableRow>
                            )}
                          </TableBody>
                        </Table>
                      </div>
                    </div>
                  </>
                  )
                )}
              </TabsContent>

              <TabsContent value="edit">
                <div className="w-full rounded-lg overflow-hidden border border-slate-200 dark:border-slate-700">
                  <div className="w-full" style={{ height: '600px', minHeight: '600px' }}>
                    <iframe
                      src={embedUrl}
                      width="100%"
                      height="100%"
                      style={{ border: 'none' }}
                      allowFullScreen
                      title={`Google Sheets - ${sheetName}`}
                      className="w-full h-full"
                    />
                  </div>
                </div>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
