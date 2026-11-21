import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Story Group Review",
  description: "Локальная проверка групп сюжетов и публикаций человеком.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
