import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface JobsPaginationProps {
  page: number;
  totalPages: number;
  disabled: boolean;
  onPageChange: (page: number) => void;
}

function visiblePages(page: number, totalPages: number): number[] {
  const candidates = [1, page - 1, page, page + 1, totalPages]
    .filter((value, index, values) => value >= 1 && value <= totalPages && values.indexOf(value) === index)
    .sort((a, b) => a - b);

  return candidates;
}

export function JobsPagination({
  page,
  totalPages,
  disabled,
  onPageChange,
}: JobsPaginationProps) {
  if (totalPages <= 1) return null;

  const pages = visiblePages(page, totalPages);

  return (
    <nav aria-label="Jobs pagination" className="mt-6 flex flex-wrap items-center justify-between gap-4">
      <Button
        disabled={disabled || page <= 1}
        onClick={() => onPageChange(page - 1)}
        type="button"
        variant="outline"
      >
        <ChevronLeft aria-hidden="true" />
        Previous Jobs
      </Button>

      <div className="flex items-center gap-2">
        {pages.map((pageNumber, index) => {
          const previous = pages[index - 1];
          const gap = previous !== undefined && pageNumber - previous > 1;

          return (
            <span className="flex items-center gap-2" key={pageNumber}>
              {gap ? <span className="text-muted-foreground">…</span> : null}
              <Button
                aria-current={pageNumber === page ? 'page' : undefined}
                disabled={disabled}
                onClick={() => onPageChange(pageNumber)}
                size="icon"
                type="button"
                variant={pageNumber === page ? 'default' : 'outline'}
              >
                {pageNumber}
              </Button>
            </span>
          );
        })}
      </div>

      <Button
        disabled={disabled || page >= totalPages}
        onClick={() => onPageChange(page + 1)}
        type="button"
        variant="outline"
      >
        Next Jobs
        <ChevronRight aria-hidden="true" />
      </Button>
    </nav>
  );
}
