import { redirect } from "next/navigation";

// PR-T11.1 — the legacy GPT-4o assistant UI is retired in favour of the
// governed AI Copilot (permission- and feature-flag-gated, read-only,
// audited). This route is kept as a redirect so existing links/bookmarks
// don't 404; /copilot renders its own honest disabled state when the
// tenant's aiCopilot flag is off.
export default function AssistantRedirect() {
  redirect("/copilot");
}
