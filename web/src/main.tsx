import React from "react";
import ReactDOM from "react-dom/client";
import { ClerkProvider } from "@clerk/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import { AppStateProvider } from "./context/AppStateContext";
import "./styles.css";

const qc = new QueryClient();
const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
if (!publishableKey) {
  throw new Error("VITE_CLERK_PUBLISHABLE_KEY is required (see .env.example)");
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ClerkProvider publishableKey={publishableKey} afterSignOutUrl="/">
      <QueryClientProvider client={qc}>
        <AppStateProvider>
          <App />
        </AppStateProvider>
      </QueryClientProvider>
    </ClerkProvider>
  </React.StrictMode>
);
