import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  try {
    const { email } = await request.json();

    if (!email) {
      return NextResponse.json(
        { error: "Email é obrigatório" },
        { status: 400 }
      );
    }

    const supabase = await createSupabaseServerClient();

    // Query a tabela auth.users para verificar se o email existe
    // Usando RPC ou consultando diretamente (Supabase não expõe isso por REST)
    // Alternativa: usar admin API para verificar
    // Por enquanto, vamos usar uma abordagem com signUp + erro esperado
    
    const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
      email,
      password: "dummy-check-" + Math.random(),
    });

    // Se o usuário já existe, Supabase retorna um erro
    if (signUpError?.message?.includes("already registered")) {
      console.log("[auth/check-email] Email já existe:", email);
      return NextResponse.json({ exists: true });
    }

    // Se não há erro e conseguiu criar usuário, é novo
    if (!signUpError && signUpData.user?.id) {
      // Limpar: fazer logout do usuário criado por acidente
      await supabase.auth.signOut();
      console.log("[auth/check-email] Novo usuário:", email);
      return NextResponse.json({ exists: false });
    }

    // Outros erros
    console.error("[auth/check-email] Erro inesperado:", signUpError);
    return NextResponse.json({ exists: false });
  } catch (error) {
    console.error("[auth/check-email] Error:", error);
    return NextResponse.json(
      { error: "Erro ao verificar email" },
      { status: 500 }
    );
  }
}
