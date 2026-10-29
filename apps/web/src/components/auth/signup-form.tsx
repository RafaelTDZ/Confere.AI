"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { ensureUserTenant, toUserFacingError } from "@/lib/auth/tenant";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ChevronRight, ArrowLeft } from "lucide-react";

export function SignupForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email] = useState(() => {
    const emailParam = searchParams.get("email");
    return emailParam ? decodeURIComponent(emailParam) : "";
  });
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    if (!fullName.trim()) {
      setError("Nome completo é obrigatório");
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
        options: {
          data: {
            full_name: fullName.trim(),
          },
        },
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

      if (!signUpData.session) {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (signInError) throw signInError;
      }

      await ensureUserTenant(supabase, fullName.trim());

      router.push("/analise");
      router.refresh();
    } catch (err) {
      setError(toUserFacingError(err, "Falha ao criar conta"));
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
          autoFocus
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          disabled={loading}
          className="text-base"
          placeholder="Seu nome completo"
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

      {error && <p className="text-sm text-destructive-text">{error}</p>}

      <Button
        type="submit"
        className="w-full group"
        disabled={loading || !fullName || !password || !confirmPassword}
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
