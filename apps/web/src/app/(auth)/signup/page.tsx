import { Suspense } from "react";
import { SignupForm } from "./signup-form";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function SignupPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-2xl">Confere.ia</CardTitle>
          <CardDescription>
            Gestão de importações com análise documental por IA
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Suspense fallback={null}>
            <SignupForm />
          </Suspense>
        </CardContent>
      </Card>
    </main>
  );
}
