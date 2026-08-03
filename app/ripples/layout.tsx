import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "ripples — after the field",
  description: "A quiet wavefront study after the shards have gone still.",
};

export default function RipplesLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return children;
}
