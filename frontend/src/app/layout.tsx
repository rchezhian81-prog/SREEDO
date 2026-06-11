import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SRE EDU OS",
  description: "School ERP — students, attendance, exams, fees and more",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
