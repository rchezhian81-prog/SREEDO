import { redirect } from "next/navigation";

// The legacy institution manager is retired. Super Admin home is the Platform
// dashboard; tenant/institution management lives under Platform → Tenants.
export default function SuperAdminHomeRedirect() {
  redirect("/super-admin/platform");
}
