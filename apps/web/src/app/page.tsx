import { redirect } from "next/navigation";
import { resolveAuthState } from "@/lib/auth";

export default async function HomePage() {
  const state = await resolveAuthState();
  if (state.status === "authenticated") redirect("/dashboard");
  if (state.status === "needs_onboarding") redirect("/onboarding");
  redirect("/login");
}
