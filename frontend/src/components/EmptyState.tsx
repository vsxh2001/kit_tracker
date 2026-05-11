import type { LucideIcon } from "lucide-react";
import { cn } from "../lib/utils";

interface Props {
  icon: LucideIcon;
  heading: string;
  body?: string;
  cta?: { label: string; onClick?: () => void; href?: string };
  className?: string;
}

export function EmptyState({ icon: Icon, heading, body, cta, className }: Props) {
  return (
    <div className={cn("flex flex-col items-center justify-center py-12 px-4 text-center", className)}>
      <Icon className="h-12 w-12 text-muted-foreground/60 mb-4" />
      <h3 className="text-base font-semibold mb-1">{heading}</h3>
      {body && <p className="text-sm text-muted-foreground mb-4 max-w-sm">{body}</p>}
      {cta && (
        cta.href
          ? <a href={cta.href} className="inline-flex items-center justify-center rounded-md text-sm font-medium bg-indigo-600 text-white px-4 py-2 hover:bg-indigo-700 transition-colors">{cta.label}</a>
          : <button onClick={cta.onClick} className="inline-flex items-center justify-center rounded-md text-sm font-medium bg-indigo-600 text-white px-4 py-2 hover:bg-indigo-700 transition-colors">{cta.label}</button>
      )}
    </div>
  );
}
