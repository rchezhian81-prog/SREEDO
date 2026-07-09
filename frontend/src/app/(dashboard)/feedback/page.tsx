import { redirect } from "next/navigation";

// PR-T7 — Feedback / grievances are now a tab in the unified Front Office hub.
// This route is kept as a redirect so existing links/bookmarks don't 404.
export default function FeedbackRedirect() {
  redirect("/front-office?tab=complaints");
}
