import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "BTC/USDT Trading Dashboard",
  description: "Live SMA 25/99 crossover signals for BTCUSDT Futures",
  icons: { icon: "/favicon.ico" },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
