import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  try {
    const { fullName, companyName } = await request.json();

    if (!fullName || !companyName) {
      return NextResponse.json(
        { error: "Nome e empresa são obrigatórios" },
        { status: 400 }
      );
    }

    const supabase = await createSupabaseServerClient();

    // Obtém o usuário autenticado
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return NextResponse.json(
        { error: "Usuário não autenticado" },
        { status: 401 }
      );
    }

    // Obtém o tenant_id do JWT do usuário
    const { data: sessionData } = await supabase.auth.getSession();
    const tenantId = sessionData?.session?.user?.user_metadata?.tenant_id;

    if (!tenantId) {
      return NextResponse.json(
        { error: "Tenant não encontrado" },
        { status: 400 }
      );
    }

    // Atualiza os campos de nome e empresa na tabela tenant_members
    const { error: updateError } = await supabase
      .from("tenant_members")
      .update({
        full_name: fullName,
        company_name: companyName,
      })
      .eq("tenant_id", tenantId)
      .eq("user_id", user.id);

    if (updateError) {
      console.error("[save-user-info] Update error:", updateError);
      return NextResponse.json(
        { error: "Erro ao salvar informações" },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[save-user-info] Error:", error);
    return NextResponse.json(
      { error: "Erro ao salvar informações" },
      { status: 500 }
    );
  }
}
