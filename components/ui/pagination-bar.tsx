'use client';

import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * Table pager (`Showing X–Y of Z` + arrows), shared by paginated tables.
 * `page` is 0-based. `showEdges` adds first / last buttons for long lists.
 */
export function PaginationBar({
  page,
  totalPages,
  total,
  pageSize,
  onPage,
  showEdges = false,
}: {
  page: number;
  totalPages: number;
  total: number;
  pageSize: number;
  onPage: (p: number) => void;
  showEdges?: boolean;
}) {
  if (total <= pageSize) return null;
  const rangeStart = page * pageSize + 1;
  const rangeEnd = Math.min(total, (page + 1) * pageSize);
  return (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
      <span className="min-w-0">
        Showing {rangeStart}–{rangeEnd} of {total}
      </span>
      <div className="flex items-center gap-1">
        {showEdges && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onPage(0)}
            disabled={page === 0}
            aria-label="First page"
            className="h-9 w-9 touch-manipulation p-0 sm:h-7 sm:w-7"
          >
            <ChevronsLeft className="h-3.5 w-3.5" />
          </Button>
        )}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onPage(Math.max(0, page - 1))}
          disabled={page === 0}
          aria-label="Previous page"
          className="h-9 w-9 touch-manipulation p-0 sm:h-7 sm:w-7"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </Button>
        <span className="min-w-[3.5rem] text-center tabular-nums">
          {page + 1} / {totalPages}
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onPage(Math.min(totalPages - 1, page + 1))}
          disabled={page >= totalPages - 1}
          aria-label="Next page"
          className="h-9 w-9 touch-manipulation p-0 sm:h-7 sm:w-7"
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </Button>
        {showEdges && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onPage(totalPages - 1)}
            disabled={page >= totalPages - 1}
            aria-label="Last page"
            className="h-9 w-9 touch-manipulation p-0 sm:h-7 sm:w-7"
          >
            <ChevronsRight className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
    </div>
  );
}
