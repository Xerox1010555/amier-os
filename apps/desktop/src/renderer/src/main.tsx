import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { applyTheme, getTheme } from "./themes";
import "./styles.css";

// settle the saved mood before anything paints (no first-paint flash)
applyTheme(getTheme());

const container = document.getElementById("root");
if (!container) throw new Error("root container missing");
createRoot(container).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
console.log("[ui] mounted");
