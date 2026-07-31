import { redirect } from "next/navigation";
import { resolveAuthState } from "@/lib/auth";

export default async function HomePage() {
  const state = await resolveAuthState();
  redirect(state.status === "authenticated" ? "/analise" : "/login");
}
