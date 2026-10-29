import { LoginForm } from "@/components/auth/login-form";
import { BrandMark } from "@/components/layout/brand";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function LoginPage() {
  return (
    <main className="relative flex min-h-screen items-center justify-center bg-background p-4">
      <div className="absolute right-4 top-4">
        <ThemeToggle />
      </div>
      <Card className="w-full max-w-sm">
        <CardHeader className="gap-3 px-6 pt-6">
          <div className="flex items-center gap-3">
            <BrandMark className="size-8 rounded-md [&_svg]:size-4" />
            <CardTitle className="text-2xl font-semibold tracking-tight">
              Confere AI
            </CardTitle>
          </div>
          <CardDescription>
            Gestão de importações com análise documental por IA
          </CardDescription>
        </CardHeader>
        <CardContent className="px-6 pb-6">
          <LoginForm />
        </CardContent>
      </Card>
    </main>
  );
}
