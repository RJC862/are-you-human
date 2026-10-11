import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Are You Human? — Live Deepfake & Filter Liveness Verification",
  description:
    "Prove you are a real, present human on camera — not a deepfake, AI avatar, or AR filter. An embeddable third-party human-verification authenticator.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
