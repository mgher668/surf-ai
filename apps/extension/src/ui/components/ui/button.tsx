import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../../lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-semibold tracking-[-0.01em] transition-[background-color,border-color,color,box-shadow,filter,transform] duration-200 ease-[var(--ease-surf)] active:translate-y-px active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:translate-y-0 disabled:scale-100 disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground shadow-[var(--shadow-surface)] hover:brightness-[0.96]",
        secondary:
          "border border-border/70 bg-secondary text-secondary-foreground shadow-[var(--surface-glow)] hover:bg-secondary/80",
        outline:
          "border border-input bg-card/80 text-foreground shadow-[var(--surface-glow)] hover:border-ring/45 hover:bg-accent hover:text-accent-foreground",
        ghost: "text-foreground/78 hover:bg-accent hover:text-accent-foreground",
        destructive: "bg-destructive text-destructive-foreground shadow-[var(--shadow-surface)] hover:brightness-[0.96]"
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 rounded-[6px] px-3 text-xs",
        icon: "h-8 w-8 p-0"
      }
    },
    defaultVariants: {
      variant: "default",
      size: "default"
    }
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };
