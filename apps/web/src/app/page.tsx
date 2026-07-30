import { redirect } from "next/navigation";
import { getAuthContextOrNull } from "@/lib/auth";

export default async function HomePage() {
  const ctx = await getAuthContextOrNull();
  redirect(ctx ? "/dashboard" : "/login");
}
