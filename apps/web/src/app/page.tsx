"use no-store";

import { redirect } from "next/navigation";
import { resolveAuthState } from "@/lib/auth";

export default async function HomePage() {
  try {
    const state = await resolveAuthState();
    redirect(state.status === "authenticated" ? "/analise" : "/login");
  } catch (error) {
    // Se houver erro ao resolver estado de auth, redireciona para login
    redirect("/login");
  }
}
