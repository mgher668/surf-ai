import { defineManifest } from "@crxjs/vite-plugin";

export default defineManifest({
  manifest_version: 3,
  name: "__MSG_appName__",
  description: "__MSG_appDescription__",
  version: "0.1.0",
  default_locale: "en",
  action: {
    default_popup: "src/ui/popup/index.html"
  },
  options_page: "src/ui/settings/index.html",
  background: {
    service_worker: "src/background/index.ts",
    type: "module"
  },
  side_panel: {
    default_path: "src/ui/sidepanel/index.html"
  },
  permissions: ["storage", "scripting", "activeTab", "tabs", "contextMenus", "sidePanel"],
  host_permissions: ["<all_urls>", "http://127.0.0.1/*", "http://localhost/*"],
  commands: {
    "open-side-panel": {
      suggested_key: {
        default: "Alt+Shift+S"
      },
      description: "Open Surf AI side panel"
    },
    "quick-summarize": {
      suggested_key: {
        default: "Alt+Shift+Q"
      },
      description: "Quick summarize selected content"
    }
  },
  content_scripts: [
    {
      matches: ["<all_urls>"],
      js: ["src/content/index.ts"],
      run_at: "document_idle"
    }
  ]
});
