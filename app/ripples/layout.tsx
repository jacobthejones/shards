import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "growth — after the field",
  description: "Regrow the field with the balls that cleared it.",
};

export const dynamic = "force-static";

export default function RipplesLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return children;
}
