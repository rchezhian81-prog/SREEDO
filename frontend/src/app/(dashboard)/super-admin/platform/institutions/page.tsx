import { redirect } from "next/navigation";

// Consolidated into the one common Tenant / Institution Management module.
export default function LegacyInstitutionsRedirect() {
  redirect("/super-admin/platform/tenants");
}
