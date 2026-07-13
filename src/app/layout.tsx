import type { Metadata, Viewport } from "next";
import { Fraunces, IBM_Plex_Mono } from "next/font/google";
import { AppProvider } from "@/lib/store";
import { AppShell } from "@/components/AppShell";
import "./globals.css";

const display = Fraunces({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const mono = IBM_Plex_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "Racha 108",
  description:
    "Apuestas ficticias de bajo riesgo · 11.11 AUD/hora · objetivo 108 seguidos",
  applicationName: "Racha 108",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Racha 108",
  },
  icons: {
    icon: [
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
  },
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = {
  themeColor: "#0c1412",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" className={`${display.variable} ${mono.variable} h-full`}>
      <body className="min-h-full antialiased">
        <AppProvider>
          <AppShell>{children}</AppShell>
        </AppProvider>
      </body>
    </html>
  );
}
