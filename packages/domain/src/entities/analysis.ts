export const SEVERITIES = ["info", "warning", "critical"] as const;

export type Severity = (typeof SEVERITIES)[number];

export const ANALYSIS_TYPES = [
  "comparison",
  "product_match",
  "validation",
] as const;

export type AnalysisType = (typeof ANALYSIS_TYPES)[number];

export interface Finding {
  field: string;
  message: string;
  severity: Severity;
  expected?: string | number | null;
  actual?: string | number | null;
  suggestion?: string | null;
}

export interface AnalysisResult {
  id: string;
  importId: string;
  tenantId: string;
  analysisType: AnalysisType;
  findings: Finding[];
  severity: Severity;
  createdAt: Date;
}

export function worstSeverity(findings: Finding[]): Severity {
  if (findings.some((f) => f.severity === "critical")) return "critical";
  if (findings.some((f) => f.severity === "warning")) return "warning";
  return "info";
}
