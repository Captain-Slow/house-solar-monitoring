import type { ReactNode } from "react";
import { Card } from "./ui/card";

/**
 * The full-window surface for the screens that replace the shell (loading, startup error, first
 * run, auth failed, TLS mismatch). Adapted from Motrix components/onboarding/onboarding-surface.tsx
 * (MIT). `pt-10` keeps the 40px drag strip of the root WindowChrome clear.
 */
export function OnboardingSurface({ children }: { children: ReactNode }) {
  return (
    <main
      data-slot="onboarding-surface"
      className="relative flex h-svh flex-col items-center justify-center overflow-hidden bg-[#161617] p-6 pt-10"
    >
      <Card className="w-full max-w-[560px] gap-4 p-6">{children}</Card>
    </main>
  );
}
