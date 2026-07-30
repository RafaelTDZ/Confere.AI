import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Confere.ia — Gestao de Importacoes com IA",
  description:
    "Analise automatica de Invoice, Packing List e BL com inteligencia artificial",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
