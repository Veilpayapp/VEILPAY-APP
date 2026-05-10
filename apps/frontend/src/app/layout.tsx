import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "VeilPay - Private Multi-Chain Payments",
  description: "Multi-chain privacy payment protocol",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
