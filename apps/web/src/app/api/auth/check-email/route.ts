import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  try {
    const { email } = await request.json();

    if (!email || typeof email !== "string") {
      return NextResponse.json(
        { error: "Email é obrigatório" },
        { status: 400 },
      );
    }

    const normalized = email.trim().toLowerCase();
    if (!normalized.includes("@")) {
      return NextResponse.json({ error: "Email inválido" }, { status: 400 });
    }

    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc("email_registered", {
      p_email: normalized,
    });

    if (error) {
      console.error("[auth/check-email] RPC error:", error);
      return NextResponse.json(
        { error: "Erro ao verificar email" },
        { status: 500 },
      );
    }

    return NextResponse.json({ exists: Boolean(data) });
  } catch (error) {
    console.error("[auth/check-email] Error:", error);
    return NextResponse.json(
      { error: "Erro ao verificar email" },
      { status: 500 },
    );
  }
}
