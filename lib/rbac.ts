import { db } from "./db";

export type SessionUser = {
  id: string;
  tenantId: string;
  name: string;
  email: string;
  roleName: string;
  roleKey: string;
  permissionKeys: string[];
  allOrganizations: boolean;
  organizationIds: string[];
};

export async function loadUser(userId: string): Promise<SessionUser | null> {
  const user = await db.user.findUnique({
    where: { id: userId },
    include: { role: { include: { permissions: { include: { permission: true } } } }, scopes: true },
  });
  if (!user?.active) return null;
  return {
    id: user.id,
    tenantId: user.tenantId,
    name: user.name,
    email: user.email,
    roleName: user.role.name,
    roleKey: user.role.systemKey,
    permissionKeys: user.role.permissions.map((item) => item.permission.key),
    allOrganizations: user.allOrganizations,
    organizationIds: user.scopes.map((scope) => scope.organizationId),
  };
}

export function assertPermission(user: SessionUser, permission: string) {
  if (!user.permissionKeys.includes(permission)) throw new AuthorizationError(`The ${user.roleName} role cannot perform this operation.`);
}

export function assertOrganization(user: SessionUser, organizationId: string) {
  if (!user.allOrganizations && !user.organizationIds.includes(organizationId)) throw new AuthorizationError("This organization is outside your assigned scope.");
}

export class AuthorizationError extends Error {
  status = 403;
}
