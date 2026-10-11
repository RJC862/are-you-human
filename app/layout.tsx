import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Are You Human? — Live Liveness Check",
  description:
    "Prove you are a real, present human on camera with a quick randomized liveness challenge. 100% on-device (MediaPipe).",
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
