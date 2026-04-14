import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "../common/base.css";
import "react-photo-view/dist/react-photo-view.css";

createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
