import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "./App";
import "@fontsource-variable/google-sans/opsz.css";
import "./styles/globals.css";

const client = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
});
const root = document.getElementById("root");
if (!root) throw new Error("Missing renderer root");

// Charts cache text metrics by font string, so the face must be loaded first.
// A font failure is logged and never blanks the UI.
try {
  const sample = "Solar 0123456789 kWh";
  const faces = await Promise.all([
    document.fonts.load('400 14px "Google Sans Variable"', sample),
    document.fonts.load('600 14px "Google Sans Variable"', sample),
  ]);
  if (faces.some((face) => face.length === 0))
    console.error("Google Sans Variable failed to load");
} catch (error) {
  console.error("Google Sans Variable failed to load", error);
}

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={client}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
