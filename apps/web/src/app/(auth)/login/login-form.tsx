"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { ensureUserTenant } from "@/lib/tenant";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ChevronRight, ArrowLeft } from "lucide-react";

type Step = "email" | "password";

export function LoginForm() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [userExists, setUserExists] = useState<boolean | null>(null);

  async function handleEmailSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const response = await fetch("/api/auth/check-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Erro ao verificar email");
      }

      if (data.exists) {
        // Usuário existe, vai para senha
        setUserExists(true);
        setStep("password");
      } else {
        // Usuário não existe, redireciona para cadastro
        router.push(`/signup?email=${encodeURIComponent(email)}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao verificar email");
    } finally {
      setLoading(false);
    }
  }

  async function handlePasswordSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setLoading(true);

    const supabase = getSupabaseBrowserClient();

    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (signInError) throw signInError;

      await ensureUserTenant(supabase, email.split("@")[0] || "Minha empresa");

      router.push("/dashboard");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao entrar");
    } finally {
      setLoading(false);
    }
  }

  function handleBackClick() {
    setStep("email");
    setPassword("");
    setError(null);
  }

  return (
    <div className="space-y-4">
      {step === "email" ? (
        <form onSubmit={handleEmailSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email" className="text-sm font-medium">
              E-mail
            </Label>
            <Input
              id="email"
              type="email"
              required
              autoComplete="email"
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="voce@empresa.com.br"
              disabled={loading}
              className="text-base"
            />
          </div>

          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}

          <Button
            type="submit"
            className="w-full group"
            disabled={loading || !email}
            size="lg"
          >
            {loading ? "Verificando..." : "Continuar"}
            {!loading && (
              <ChevronRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1" />
            )}
          </Button>
        </form>
      ) : (
        <form onSubmit={handlePasswordSubmit} className="space-y-4">
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="text-xs text-muted-foreground">Conectando como</p>
              <p className="text-sm font-medium">{email}</p>
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
            <Label htmlFor="password" className="text-sm font-medium">
              Senha
            </Label>
            <Input
              id="password"
              type="password"
              required
              minLength={6}
              autoComplete="current-password"
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={loading}
              className="text-base"
            />
          </div>

          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}

          <Button
            type="submit"
            className="w-full group"
            disabled={loading || !password}
            size="lg"
          >
            {loading ? "Entrando..." : "Entrar"}
            {!loading && (
              <ChevronRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1" />
            )}
          </Button>
        </form>
      )}
    </div>
  );
}
