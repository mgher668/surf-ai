import * as React from "react";
import { cn } from "../../../lib/utils";
import { Button } from "./button";

type SidebarState = "expanded" | "collapsed";

interface SidebarContextValue {
  state: SidebarState;
  open: boolean;
  setOpen: (open: boolean) => void;
  toggleSidebar: () => void;
}

const SidebarContext = React.createContext<SidebarContextValue | null>(null);

function useSidebar(): SidebarContextValue {
  const context = React.useContext(SidebarContext);
  if (!context) {
    throw new Error("useSidebar must be used within a SidebarProvider.");
  }
  return context;
}

function SidebarProvider({
  defaultOpen = true,
  open: openProp,
  onOpenChange,
  className,
  style,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}): JSX.Element {
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(defaultOpen);
  const open = openProp ?? uncontrolledOpen;

  const setOpen = React.useCallback(
    (nextOpen: boolean) => {
      if (onOpenChange) {
        onOpenChange(nextOpen);
        return;
      }
      setUncontrolledOpen(nextOpen);
    },
    [onOpenChange]
  );

  const toggleSidebar = React.useCallback(() => {
    setOpen(!open);
  }, [open, setOpen]);

  const state: SidebarState = open ? "expanded" : "collapsed";
  const contextValue = React.useMemo(
    () => ({ state, open, setOpen, toggleSidebar }),
    [state, open, setOpen, toggleSidebar]
  );

  return (
    <SidebarContext.Provider value={contextValue}>
      <div
        data-slot="sidebar-wrapper"
        data-state={state}
        style={
          {
            "--sidebar-width": "236px",
            "--sidebar-width-icon": "56px",
            ...style
          } as React.CSSProperties
        }
        className={cn("group/sidebar-wrapper flex h-full min-h-0 w-full", className)}
        {...props}
      >
        {children}
      </div>
    </SidebarContext.Provider>
  );
}

function Sidebar({
  collapsible = "offcanvas",
  className,
  children,
  ...props
}: React.ComponentProps<"aside"> & {
  collapsible?: "offcanvas" | "icon" | "none";
}): JSX.Element {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";

  return (
    <aside
      data-slot="sidebar"
      data-state={state}
      data-collapsible={collapsed ? collapsible : ""}
      className={cn(
        "relative h-full shrink-0 overflow-hidden border-r border-border bg-card text-card-foreground transition-[width,border-color,box-shadow] duration-[220ms] ease-[cubic-bezier(0.22,1,0.36,1)]",
        collapsible === "none"
          ? "w-[var(--sidebar-width)]"
          : collapsed
            ? collapsible === "icon"
              ? "w-[var(--sidebar-width-icon)]"
              : "w-0 border-r-0"
            : "w-[var(--sidebar-width)]",
        className
      )}
      {...props}
    >
      {children}
    </aside>
  );
}

function SidebarInset({
  className,
  ...props
}: React.ComponentProps<"main">): JSX.Element {
  return (
    <main
      data-slot="sidebar-inset"
      className={cn("flex min-h-0 min-w-0 flex-1 flex-col bg-background", className)}
      {...props}
    />
  );
}

function SidebarTrigger({
  className,
  onClick,
  ...props
}: React.ComponentProps<typeof Button>): JSX.Element {
  const { toggleSidebar } = useSidebar();
  return (
    <Button
      data-slot="sidebar-trigger"
      type="button"
      variant="ghost"
      size="icon"
      className={cn("h-8 w-8", className)}
      onClick={(event) => {
        onClick?.(event);
        toggleSidebar();
      }}
      {...props}
    />
  );
}

export { Sidebar, SidebarInset, SidebarProvider, SidebarTrigger, useSidebar };
