import { redirect } from "next/navigation";

export default function ConnectWhatsappPage() {
  redirect("/settings?tab=whatsapp");
}
