import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "NAPLPS Converter",
  description: "Convert PNG images to NAPLPS (North American Presentation Layer Protocol Syntax) format. Modern web tool for retro graphics conversion.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
