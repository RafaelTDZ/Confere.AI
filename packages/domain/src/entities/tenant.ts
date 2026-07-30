export const MEMBER_ROLES = [
  "owner",
  "admin",
  "operator",
  "viewer",
] as const;

export type MemberRole = (typeof MEMBER_ROLES)[number];

export interface Tenant {
  id: string;
  name: string;
  documentCnpj: string | null;
  createdAt: Date;
}

export interface TenantMember {
  tenantId: string;
  userId: string;
  role: MemberRole;
  createdAt: Date;
}

const WRITE_ROLES: MemberRole[] = ["owner", "admin", "operator"];

export function canWrite(role: MemberRole): boolean {
  return WRITE_ROLES.includes(role);
}

export function canManageMembers(role: MemberRole): boolean {
  return role === "owner" || role === "admin";
}

export interface AuditLog {
  id: string;
  tenantId: string;
  userId: string | null;
  entity: string;
  entityId: string;
  action: string;
  beforeState: Record<string, unknown> | null;
  afterState: Record<string, unknown> | null;
  createdAt: Date;
}
