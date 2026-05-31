import { Icon } from "@iconify/react/dist/offline";
import cogOutline from "@iconify-icons/mdi/cog-outline";
import openInNew from "@iconify-icons/mdi/open-in-new";
import menuIcon from "@iconify-icons/mdi/menu";
import sidebarModeIcon from "@iconify-icons/mdi/page-layout-sidebar-left";
import themeLightDark from "@iconify-icons/mdi/theme-light-dark";
import checkIcon from "@iconify-icons/mdi/check";
import type { UiSidebarMode, UiThemeMode } from "@surf-ai/shared";
import { type Locale, t } from "../../common/i18n";
import { Button } from "../../components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from "../../components/ui/dropdown-menu";

interface SidepanelTopbarProps {
  locale: Locale;
  sidebarMode: UiSidebarMode;
  themeMode: UiThemeMode;
  isSidebarVisible: boolean;
  onToggleSidebarPanel: () => void;
  onUpdateSidebarModeValue: (nextMode: UiSidebarMode) => void | Promise<void>;
  onUpdateThemeMode: (nextThemeMode: UiThemeMode) => void | Promise<void>;
  onOpenStandalonePage: () => void | Promise<void>;
  onOpenSettingsPage: () => void | Promise<void>;
  onDropdownOpenChange: (open: boolean) => void;
}

export function SidepanelTopbar({
  locale,
  sidebarMode,
  themeMode,
  isSidebarVisible,
  onToggleSidebarPanel,
  onUpdateSidebarModeValue,
  onUpdateThemeMode,
  onOpenStandalonePage,
  onOpenSettingsPage,
  onDropdownOpenChange
}: SidepanelTopbarProps): JSX.Element {
  return (
    <header className="surf-topbar">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className={`h-8 w-8 rounded-lg p-0 text-[hsl(var(--muted-foreground))] hover:bg-accent ${
          isSidebarVisible ? "bg-accent text-accent-foreground" : ""
        }`}
        title={t(locale, "toggleSidebar")}
        aria-label={t(locale, "toggleSidebar")}
        onClick={onToggleSidebarPanel}
      >
        <Icon icon={menuIcon} width={18} height={18} />
      </Button>
      <DropdownMenu onOpenChange={onDropdownOpenChange}>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 rounded-lg p-0 text-[hsl(var(--muted-foreground))] hover:bg-accent"
            title={t(locale, "sidebarMode")}
            aria-label={t(locale, "sidebarMode")}
          >
            <Icon icon={sidebarModeIcon} width={18} height={18} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-[156px]">
          <DropdownMenuItem onSelect={() => void onUpdateSidebarModeValue("docked")}>
            <Icon
              icon={checkIcon}
              width={16}
              height={16}
              className={sidebarMode === "docked" ? "opacity-100" : "opacity-0"}
            />
            <span>{t(locale, "sidebarModeDocked")}</span>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void onUpdateSidebarModeValue("overlay")}>
            <Icon
              icon={checkIcon}
              width={16}
              height={16}
              className={sidebarMode === "overlay" ? "opacity-100" : "opacity-0"}
            />
            <span>{t(locale, "sidebarModeOverlay")}</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <strong className="surf-topbar-title">{t(locale, "appTitle")}</strong>
      <DropdownMenu onOpenChange={onDropdownOpenChange}>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 rounded-lg p-0 text-[hsl(var(--muted-foreground))] hover:bg-accent"
            title={t(locale, "theme")}
            aria-label={t(locale, "theme")}
          >
            <Icon icon={themeLightDark} width={18} height={18} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[144px]">
          <DropdownMenuItem onSelect={() => void onUpdateThemeMode("system")}>
            <Icon
              icon={checkIcon}
              width={16}
              height={16}
              className={themeMode === "system" ? "opacity-100" : "opacity-0"}
            />
            <span>{t(locale, "themeSystem")}</span>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void onUpdateThemeMode("light")}>
            <Icon
              icon={checkIcon}
              width={16}
              height={16}
              className={themeMode === "light" ? "opacity-100" : "opacity-0"}
            />
            <span>{t(locale, "themeLight")}</span>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void onUpdateThemeMode("dark")}>
            <Icon
              icon={checkIcon}
              width={16}
              height={16}
              className={themeMode === "dark" ? "opacity-100" : "opacity-0"}
            />
            <span>{t(locale, "themeDark")}</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="h-8 w-8"
        onClick={() => void onOpenStandalonePage()}
        title={t(locale, "openStandalone")}
        aria-label={t(locale, "openStandalone")}
      >
        <Icon icon={openInNew} width={16} height={16} />
      </Button>
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="h-8 w-8"
        onClick={() => void onOpenSettingsPage()}
        title={t(locale, "openSettings")}
        aria-label={t(locale, "openSettings")}
      >
        <Icon icon={cogOutline} width={16} height={16} />
      </Button>
    </header>
  );
}
