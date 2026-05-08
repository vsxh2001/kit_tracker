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
        destructive: "border-red-200/60 bg-red-50 text-red-700",
        outline: "border-border text-foreground bg-transparent",
        success: "border-emerald-200/60 bg-emerald-50 text-emerald-700",
        warning: "border-amber-200/60 bg-amber-50 text-amber-700",
        purple: "border-violet-200/60 bg-violet-50 text-violet-700",
        gray: "border-slate-200/80 bg-slate-100 text-slate-600",
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

export { Badge, badgeVariants };
