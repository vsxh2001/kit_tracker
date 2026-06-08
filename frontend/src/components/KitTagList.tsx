import { parseTags } from "../services/kits";
import { cn } from "../lib/utils";

export function KitTagList({
  tags,
  className,
}: {
  tags: string | undefined;
  className?: string;
}) {
  const parsed = parseTags(tags);
  if (parsed.length === 0) return null;
  return (
    <div className={cn("flex flex-wrap gap-1", className)}>
      {[...parsed].sort().map((tag) => (
        <span
          key={tag}
          className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground"
        >
          {tag}
        </span>
      ))}
    </div>
  );
}
