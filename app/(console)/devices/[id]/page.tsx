import { notFound } from "next/navigation";
import { DeviceDetail } from "@/components/device-detail";
import { requireUser } from "@/lib/auth";
import { getDeviceDetail } from "@/lib/data";

export default async function DevicePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const data = await getDeviceDetail(user, id);
  if (!data) notFound();
  return <DeviceDetail data={data} user={user} />;
}
