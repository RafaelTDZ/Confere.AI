"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ChevronRight, ArrowLeft } from "lucide-react";

export function SignupForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const emailParam = searchParams.get("email");
    if (emailParam) {
      setEmail(decodeURIComponent(emailParam));
    }
  }, [searchParams]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    if (!fullName.trim()) {
      setError("Nome completo é obrigatório");
      return;
    }

    if (!companyName.trim()) {
      setError("Nome da empresa é obrigatório");
      return;
    }

    if (password !== confirmPassword) {
      setError("As senhas não coincidem");
      return;
    }

    if (password.length < 6) {
      setError("A senha deve ter no mínimo 6 caracteres");
      return;
    }

    setLoading(true);
    const supabase = getSupabaseBrowserClient();

    try {
      const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
        email,
        password,
      });

      if (signUpError) {
        const message = signUpError.message.toLowerCase();
        if (
          message.includes("already registered") ||
          message.includes("already been registered") ||
          signUpError.code === "user_already_exists"
        ) {
          setError("Este e-mail já possui conta. Faça login para continuar.");
          return;
        }
        throw signUpError;
      }

      // Com confirmacao de e-mail desligada, a sessao ja vem no signUp.
      if (!signUpData.session) {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (signInError) throw signInError;
      }

      const { error: tenantError } = await supabase.rpc(
        "create_tenant_with_owner",
        { p_name: companyName.trim() },
      );
      if (tenantError) throw tenantError;

      const { data: refreshed, error: refreshError } =
        await supabase.auth.refreshSession();
      if (refreshError) throw refreshError;

      const tenantId = refreshed.session?.user?.app_metadata?.tenant_id as
        | string
        | undefined;
      const userId = refreshed.session?.user?.id;
      if (tenantId && userId) {
        await supabase
          .from("tenant_members")
          .update({
            full_name: fullName.trim(),
            company_name: companyName.trim(),
          })
          .eq("tenant_id", tenantId)
          .eq("user_id", userId);
      }

      router.push("/dashboard");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao criar conta");
    } finally {
      setLoading(false);
    }
  }

  function handleBackClick() {
    router.push("/login");
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="flex items-center justify-between mb-6">
        <div>
          <p className="text-xs text-muted-foreground">Criar conta</p>
          <p className="text-sm font-medium truncate">{email}</p>
        </div>
        <button
          type="button"
          onClick={handleBackClick}
          disabled={loading}
          className="text-muted-foreground hover:text-foreground transition-colors"
          title="Voltar"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
      </div>

      <div className="space-y-2">
        <Label htmlFor="full-name" className="text-sm font-medium">
          Nome Completo
        </Label>
        <Input
          id="full-name"
          type="text"
          required
          autoComplete="name"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          disabled={loading}
          className="text-base"
          placeholder="Seu nome completo"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="company-name" className="text-sm font-medium">
          Nome da Empresa
        </Label>
        <Input
          id="company-name"
          type="text"
          required
          autoComplete="organization"
          value={companyName}
          onChange={(e) => setCompanyName(e.target.value)}
          disabled={loading}
          className="text-base"
          placeholder="Nome da sua empresa"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="password" className="text-sm font-medium">
          Senha
        </Label>
        <Input
          id="password"
          type="password"
          required
          minLength={6}
          autoComplete="new-password"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={loading}
          className="text-base"
          placeholder="Mínimo 6 caracteres"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="confirm-password" className="text-sm font-medium">
          Confirmar Senha
        </Label>
        <Input
          id="confirm-password"
          type="password"
          required
          minLength={6}
          autoComplete="new-password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          disabled={loading}
          className="text-base"
          placeholder="Confirme sua senha"
        />
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Button
        type="submit"
        className="w-full group"
        disabled={loading || !fullName || !companyName || !password || !confirmPassword}
        size="lg"
      >
        {loading ? "Criando conta..." : "Criar conta"}
        {!loading && (
          <ChevronRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1" />
        )}
      </Button>
    </form>
  );
}
