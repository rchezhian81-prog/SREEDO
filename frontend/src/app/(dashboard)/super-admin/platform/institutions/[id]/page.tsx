import { redirect } from "next/navigation";

// Consolidated into the one common Tenant / Institution Management module.
export default async function LegacyInstitutionDetailRedirect({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/super-admin/platform/tenants/${id}`);
}
