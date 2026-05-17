import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import { AppStateProvider } from "./context/AppStateContext";
import "./styles.css";

const qc = new QueryClient();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={qc}>
      <AppStateProvider>
        <App />
      </AppStateProvider>
    </QueryClientProvider>
  </React.StrictMode>
);
