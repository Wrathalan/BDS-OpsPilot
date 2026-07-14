import { notFound } from "next/navigation";
import { SectionView } from "@/components/section-view";
import { requireUser } from "@/lib/auth";
import { getConsoleData } from "@/lib/data";

const sections = new Set(["overview", "organizations", "devices", "alerts", "patching", "automation", "tickets", "reports", "audit-log", "administration"]);

export default async function SectionPage({ params, searchParams }: { params: Promise<{ section: string }>; searchParams: Promise<{ search?: string }> }) {
  const { section } = await params;
  if (!sections.has(section)) notFound();
  const user = await requireUser();
  const [data, query] = await Promise.all([getConsoleData(user), searchParams]);
  return <SectionView section={section} data={data} user={user} initialSearch={query.search ?? ""} />;
}
