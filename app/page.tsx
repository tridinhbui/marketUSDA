import { Suspense } from "react";
import MarketDashboard from "@/components/MarketDashboard";

export default function Page({ searchParams }: { searchParams: { tab?: string } }) {
  const initialTab = searchParams.tab === "turkey" ? "turkey" : "hog";
  return (
    <Suspense
      fallback={
        <main className="shell">
          <p className="panel">Loading…</p>
        </main>
      }
    >
      <MarketDashboard initialTab={initialTab} />
    </Suspense>
  );
}
