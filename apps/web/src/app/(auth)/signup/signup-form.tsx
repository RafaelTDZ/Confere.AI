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
      const { error: signUpError } = await supabase.auth.signUp({
        email,
        password,
      });

      if (signUpError) throw signUpError;

      // Após signup bem-sucedido, tenta fazer login
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (signInError) throw signInError;

      // Salva os dados adicionais do usuário (nome e empresa)
      const response = await fetch("/api/auth/save-user-info", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName: fullName.trim(),
          companyName: companyName.trim(),
        }),
      });

      if (!response.ok) {
        console.error("Falha ao salvar informações do usuário");
      }

      router.push("/onboarding");
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
