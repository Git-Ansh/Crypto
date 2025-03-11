import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { BrowserRouter } from "react-router-dom";
import { AuthProvider } from "./contexts/AuthContext";
import { ThemeProvider } from "./components/theme-provider";
import { Toaster } from "sonner";
import "./index.css";
import { env } from "./lib/config";

// Log environment information during startup
console.log(
  `Application running in ${
    env.isProduction ? "production" : "development"
  } mode`
);
console.log(`API URL: ${env.apiUrl}`);
console.log(`Client URL: ${env.clientUrl}`);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <ThemeProvider defaultTheme="system" storageKey="theme">
        <AuthProvider>
          <App />
          <Toaster position="top-right" />
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  </React.StrictMode>
);
