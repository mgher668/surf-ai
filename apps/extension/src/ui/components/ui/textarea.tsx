import * as React from "react";
import { cn } from "../../../lib/utils";

const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.ComponentProps<"textarea">
>(({ className, ...props }, ref) => {
  return (
    <textarea
      ref={ref}
      className={cn(
        "min-h-[80px] w-full rounded-md border border-input bg-card/80 px-3 py-2 text-sm leading-relaxed text-foreground shadow-[var(--surface-glow)] transition-[background-color,border-color,box-shadow] duration-200 ease-[var(--ease-surf)] placeholder:text-muted-foreground/75 focus-visible:border-ring/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/25 disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    />
  );
});
Textarea.displayName = "Textarea";

export { Textarea };
