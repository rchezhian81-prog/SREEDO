# GoCampusOS Marketing Website — Plan

> PLANNING ONLY. The website is a **separate app** (never inside the dashboard
> bundle): static/SSG Next.js in `website/` (or its own repo), served by the
> existing nginx on the marketing hostname. Zero coupling to app code; deploys
> independently; cannot touch tenant data.

## 1. Sitemap & page briefs

| Page | Brief |
|---|---|
| **Home** | Positioning: "One ERP. School and College editions." Hero (real product shot), 3 proof pillars (governed RBAC/audit · School↔College engine · read-only AI copilot), module strip, CTA = Book a demo. |
| **School ERP** | Mode-true tour in school nouns (Classes/Sections/Report Cards): admissions→attendance→fees→exams→PTM→portal. |
| **College ERP** | Same tour in college nouns (Departments/Programs/Semesters/Grade Sheets), violet accent. |
| **Features / Modules** | 30-module grid (from the roadmap table), each with one screenshot + 3 bullets; filter School/College. |
| **AI Copilot** | The trust story: read-only, permission-scoped, tenant-isolated, audited, off-by-default; screenshots incl. the refusal/disabled states — honesty as a feature. |
| **Security** | RBAC + job-roles, tenant isolation, audit trail, masked exports, backups/rollback deploys, DPDP posture (source: docs/SECURITY.md, DPDP_COMPLIANCE.md). No claims beyond what code proves. |
| **Pricing** | Package tiers (already modeled in Super Admin subscriptions/packages); per-student/year framing; "talk to us" for enterprise. |
| **Demo request** | Short form (name, institution, type, size, phone/email) → email + stored enquiry; calendly-style link optional. |
| **Contact** | Email/phone/address + form. |
| **Help / Docs** | Public subset of the T10 corpus (getting-started + selected articles), rendered from the same markdown-ish content — single source of truth. |
| **Status** | Simple public status page backed by `/health` polling (green/degraded + incident notes), on a status subdomain. |

## 2. Stack & deploy

Next.js SSG (output: export) + the same design tokens (copied, not imported);
Tailwind; no client data fetching except the status widget and demo form POST.
Deploy: nginx vhost `www.` → static dir; build in CI on the website path only;
**never** part of `scripts/deploy.sh` app rebuild. Analytics: privacy-light
(Plausible-class), cookie-banner-free if possible.

## 3. SEO basics

Per-page title/meta/OG + JSON-LD (Organization, Product, FAQ); one H1/page;
sitemap.xml + robots.txt; canonical URLs; image alt text; LCP image <100KB,
static-rendered text (SSG gives this free); fast-host headers via nginx
(cache-control, compression).

## 4. Screenshot / demo requirements

- All shots from the **seeded demo tenant** (DEMO-TENANT-SPEC.md) — real
  product, realistic names, **no fake mockups, no lorem, no invented numbers**.
- Captured via the existing Playwright smoke pipeline (deviceScaleFactor 2)
  for pixel-consistent re-captures after PX3; both modes; light + dark pairs
  for the hero; phone-frame portal shots for parent flows (after T8.1/T9.1).
- 60–90s product tour video per edition, recorded on the demo tenant.

## 5. Sequencing

Build AFTER PX3 (so screenshots show final polish) and after T8.1/T9.1 (parent
flows are marketing material). Copy drafts can start anytime from this doc.
