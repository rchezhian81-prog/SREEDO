import { redirect } from "next/navigation";

// PR-T7 — Lost & Found is now a tab in the unified Front Office hub. This route
// is kept as a redirect so existing links/bookmarks don't 404.
export default function LostFoundRedirect() {
  redirect("/front-office?tab=lost-found");
}
