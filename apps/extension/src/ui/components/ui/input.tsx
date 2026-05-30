import * as React from "react";
import { cn } from "../../../lib/utils";

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type = "text", ...props }, ref) => {
    return (
      <input
        ref={ref}
        type={type}
        className={cn(
          "h-9 w-full rounded-lg border border-input bg-card/80 px-3 py-1 text-sm text-foreground shadow-[var(--surface-glow)] transition-[background-color,border-color,box-shadow] duration-200 ease-[var(--ease-surf)] placeholder:text-muted-foreground/75 focus-visible:border-ring/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/25 disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
        {...props}
      />
    );
  }
);
Input.displayName = "Input";

export { Input };
