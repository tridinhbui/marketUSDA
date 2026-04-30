import type { Metadata } from "next";
import "./globals.css";
import { TriggerGithubSync } from "@/components/TriggerGithubSync";

export const metadata: Metadata = {
  title: "USDA Market Prices",
  description: "USDA MPR daily hog prices and weekly turkey & pork retail prices.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <TriggerGithubSync />
      </body>
    </html>
  );
}
