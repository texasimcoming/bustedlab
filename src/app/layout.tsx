import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "BustedLab - See through any product",
  description: "Upload any product screenshot. We find the real wholesale price in seconds and show you exactly how much you're being overcharged.",
  openGraph: {
    title: "BustedLab - See through any product",
    description: "Upload any product screenshot. We find the real wholesale price in seconds.",
    type: "website",
  },
  icons: {
    icon: "/logo.svg",
    apple: "/logo.svg",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&family=Space+Grotesk:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
        {/* Lemon Squeezy checkout overlay */}
        <script src="https://assets.lemonsqueezy.com/lemon.js" defer></script>
      </head>
      <body>{children}</body>
    </html>
  );
}
