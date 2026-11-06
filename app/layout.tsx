import type { Metadata } from "next";
import { ServiceWorkerRegistrar } from "@/components/service-worker-registrar";
import { I18nProvider } from "@/lib/i18n";
import "./globals.css";
import "./aurum.css";

const appDescription = "Aurum Studio — 位图/矢量转可打印 3D 徽章工作台";

function normalizeSiteUrl(value: string): string {
  if (value.startsWith("http://") || value.startsWith("https://")) {
    return value;
  }

  return `https://${value}`;
}

function getSiteUrl(): string {
  const explicitUrl = process.env.NEXT_PUBLIC_SITE_URL;

  if (explicitUrl) {
    return normalizeSiteUrl(explicitUrl);
  }

  const vercelUrl =
    process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL;

  if (vercelUrl) {
    return normalizeSiteUrl(vercelUrl);
  }

  return "http://localhost:3000";
}

export const metadata: Metadata = {
  metadataBase: new URL(getSiteUrl()),
  title: "Aurum Studio",
  description: appDescription,
  manifest: "/manifest.webmanifest",
  applicationName: "Aurum Studio",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: [
      {
        url: "/apple-touch-icon.png",
        sizes: "180x180",
        type: "image/png",
      },
    ],
  },
  openGraph: {
    title: "Aurum Studio",
    description: appDescription,
    siteName: "Aurum Studio",
    type: "website",
    images: [
      {
        url: "/og-image.jpg",
        width: 1200,
        height: 630,
        alt: "Aurum Studio",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Aurum Studio",
    description: appDescription,
    images: ["/og-image.jpg"],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Aurum Studio",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <I18nProvider>
          {children}
          <ServiceWorkerRegistrar />
        </I18nProvider>
      </body>
    </html>
  );
}
