"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CircleAlert, Loader2 } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  formatNcmInput,
  normalizeNcmCode,
} from "@/lib/documents/ncms-shared";
import { cn } from "@/lib/utils";

export function NcmForm({
  ncmId,
  code = "",
  description = "",
  canEdit,
}: {
  ncmId?: string;
  code?: string;
  description?: string;
  canEdit: boolean;
}) {
  const router = useRouter();
  const isEdit = Boolean(ncmId);
  const [codeValue, setCodeValue] = useState(() => formatNcmInput(code));
  const [descriptionValue, setDescriptionValue] = useState(description);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!canEdit) return;
    setError(null);
    setLoading(true);

    try {
      const res = await fetch(isEdit ? `/api/ncms/${ncmId}` : "/api/ncms", {
        method: isEdit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: normalizeNcmCode(codeValue),
          description: descriptionValue,
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        throw new Error(data.error || "Falha ao salvar NCM");
      }
      router.push("/ncm?saved=ok");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro inesperado");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Dados da NCM</CardTitle>
          <CardDescription>
            {canEdit
              ? "Informe o código NCM/HS e a descrição."
              : "Seu perfil só permite visualizar esta NCM."}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="space-y-2">
            <Label htmlFor="ncm-code">Código</Label>
            <Input
              id="ncm-code"
              value={codeValue}
              required
              disabled={loading || !canEdit}
              inputMode="numeric"
              autoComplete="off"
              placeholder="0000.00.00"
              onChange={(event) =>
                setCodeValue(formatNcmInput(event.target.value))
              }
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ncm-description">Descrição</Label>
            <Input
              id="ncm-description"
              value={descriptionValue}
              required
              disabled={loading || !canEdit}
              onChange={(event) => setDescriptionValue(event.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      {error && (
        <p className="flex items-center gap-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <CircleAlert className="h-4 w-4 shrink-0" />
          {error}
        </p>
      )}

      <div className="flex justify-end gap-2">
        <Link
          href="/ncm"
          className={cn(buttonVariants({ variant: "outline" }))}
        >
          Voltar
        </Link>
        {canEdit ? (
          <Button type="submit" disabled={loading}>
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Salvando...
              </>
            ) : (
              "Salvar"
            )}
          </Button>
        ) : null}
      </div>
    </form>
  );
}
