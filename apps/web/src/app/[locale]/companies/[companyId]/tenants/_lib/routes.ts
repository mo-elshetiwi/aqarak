export interface TenantRoute {
  locale: string;
  companyId: string;
  tenantId: string;
}
export interface ReviewRoute extends TenantRoute {
  documentId: string;
  versionId: string;
}
export function tenantPath(route: TenantRoute): string {
  return `/${route.locale}/companies/${encodeURIComponent(route.companyId)}/tenants/${encodeURIComponent(route.tenantId)}`;
}
export function reviewPath(route: ReviewRoute): string {
  return `${tenantPath(route)}/documents/${encodeURIComponent(route.documentId)}/versions/${encodeURIComponent(route.versionId)}/review`;
}
