import { Suspense } from "react";
import MarketDashboard from "@/components/MarketDashboard";

export default function Page({ searchParams }: { searchParams: { tab?: string } }) {
  const tabQ = searchParams.tab;
  const initialTab =
    tabQ === "turkey" ? "turkey" : tabQ === "admin" ? "admin" : "hog";
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
