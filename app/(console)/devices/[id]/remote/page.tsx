import { notFound } from "next/navigation";
import { RemoteConsole } from "@/components/remote-console";
import { requireUser } from "@/lib/auth";
import { getDeviceDetail } from "@/lib/data";

export default async function RemoteDevicePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const data = await getDeviceDetail(user, id);
  if (!data) notFound();
  return <RemoteConsole device={data.device} canRemote={user.permissionKeys.includes("remote.control")} />;
}
