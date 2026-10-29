import type { ReactNode } from "react";
import { CircleAlert, CircleCheck, Info } from "lucide-react";
import { cn } from "@/lib/utils";

type NoticeTone = "success" | "warning" | "danger" | "info";

const TONES: Record<NoticeTone, { className: string; Icon: typeof Info }> = {
  success: {
    className: "bg-success-soft text-success-text",
    Icon: CircleCheck,
  },
  warning: {
    className: "bg-warning-soft text-warning-text",
    Icon: CircleAlert,
  },
  danger: {
    className: "bg-destructive-soft text-destructive-text",
    Icon: CircleAlert,
  },
  info: {
    className: "bg-primary-soft text-primary-text",
    Icon: Info,
  },
};

/** Faixa inline para sucesso, aviso, erro ou info. Texto sempre em `*-text`. */
export function Notice({
  tone,
  title,
  children,
  className,
}: {
  tone: NoticeTone;
  title?: string;
  children?: ReactNode;
  className?: string;
}) {
  const { className: toneClassName, Icon } = TONES[tone];
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      className={cn(
        "flex items-start gap-2 rounded-md px-4 py-3 text-sm",
        toneClassName,
        className,
      )}
    >
      <Icon aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0 space-y-2">
        {title ? <p className="font-medium">{title}</p> : null}
        {children ? <div>{children}</div> : null}
      </div>
    </div>
  );
}
