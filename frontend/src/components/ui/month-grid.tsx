import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "./button";
import { MONTH_NAMES, DOW_LABELS, monthDays } from "./month-grid-utils";

interface MonthGridProps {
  year: number;
  month: number; // 0-based
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  renderCell: (day: Date | null, idx: number) => React.ReactNode;
  // optional caption shown between header and grid
  caption?: React.ReactNode;
}

export function MonthGrid({ year, month, onPrev, onNext, onToday, renderCell, caption }: MonthGridProps) {
  const cells = monthDays(year, month);
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={onPrev} aria-label="Previous month">
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <Button variant="outline" size="sm" onClick={onToday}>Today</Button>
        <Button variant="outline" size="sm" onClick={onNext} aria-label="Next month">
          <ChevronRight className="h-4 w-4" />
        </Button>
        <span className="text-sm font-medium ml-1">{MONTH_NAMES[month]} {year}</span>
      </div>
      {caption}
      <div className="rounded-lg border bg-white overflow-x-auto">
        <div className="grid grid-cols-7 border-b">
          {DOW_LABELS.map((d) => (
            <div
              key={d}
              className="py-2 text-center text-xs font-semibold uppercase tracking-wider text-muted-foreground border-r last:border-r-0"
            >
              {d}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {cells.map((day, idx) => renderCell(day, idx))}
        </div>
      </div>
    </div>
  );
}
