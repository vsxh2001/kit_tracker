import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors tracking-wide",
  {
    variants: {
      variant: {
        default: "border-transparent bg-indigo-600 text-white",
        secondary: "border-indigo-200/60 bg-indigo-50 text-indigo-700",
        destructive: "border-transparent bg-red-600 text-white",
        outline: "border-border text-foreground bg-transparent",
        success: "border-transparent bg-emerald-600 text-white",
        warning: "border-amber-200/60 bg-amber-50 text-amber-700",
        purple: "border-transparent bg-slate-600 text-white",
        gray: "border-slate-200/80 bg-slate-100 text-slate-500 line-through",
      },
    },
    defaultVariants: { variant: "default" },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge };
