import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "USDA Market Prices",
  description: "USDA MPR daily hog prices and weekly turkey & pork retail prices.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
