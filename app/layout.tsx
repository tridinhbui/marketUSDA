import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "USDA Market Prices — Hogs & Turkey",
  description: "USDA negotiated hog prices (LM_HG217) and weekly turkey (AMS_3647).",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
