"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/stores/auth-store";
import { useModeStore, type CampusMode } from "@/stores/mode-store";
import { Icon } from "@/components/icons";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";

type Choice = {
  mode: CampusMode;
  title: string;
  blurb: string;
  features: string[];
  icon: "school" | "graduation";
  tile: string;
  ring: string;
};

const CHOICES: Choice[] = [
  {
    mode: "school",
    title: "School",
    blurb: "K–12 — classes, sections, timetables & report cards.",
    features: ["Classes & sections", "Daily & period attendance", "Exams & report cards"],
    icon: "school",
    tile: "from-[#4f8cff] to-[#1e40af] shadow-[0_12px_28px_rgb(37_99_235_/_0.45)]",
    ring: "focus-visible:ring-brand-400 hover:border-brand-300",
  },
  {
    mode: "college",
    title: "College",
    blurb: "Higher-ed — departments, programs, semesters & GPA.",
    features: ["Departments & programs", "Semesters & credits", "Enrollments & GPA results"],
    icon: "graduation",
    tile: "from-[#8b5cf6] to-[#6d28d9] shadow-[0_12px_28px_rgb(124_58_237_/_0.45)]",
    ring: "focus-visible:ring-violet-400 hover:border-violet-300",
  },
];

export default function SelectCampusPage() {
  const router = useRouter();
  const accessToken = useAuthStore((s) => s.accessToken);
  const setMode = useModeStore((s) => s.setMode);

  // Already signed in? Skip the chooser.
  useEffect(() => {
    if (accessToken) router.replace("/dashboard");
  }, [accessToken, router]);

  const choose = (mode: CampusMode) => {
    setMode(mode);
    router.push("/login");
  };

  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-app p-6">
      {/* soft brand glows */}
      <div className="pointer-events-none absolute -top-40 left-1/4 h-80 w-[34rem] -translate-x-1/2 rounded-full bg-brand-500/15 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-40 right-1/4 h-80 w-[34rem] translate-x-1/2 rounded-full bg-violet-500/15 blur-3xl" />

      <div className="absolute right-5 top-5">
        <LanguageSwitcher />
      </div>

      <div className="relative w-full max-w-3xl">
        <div className="mb-9 text-center">
          <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-[#4f8cff] to-[#1e40af] text-white shadow-[0_10px_24px_rgb(37_99_235_/_0.45)]">
            <Icon name="cap" className="h-8 w-8" />
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight text-ink">
            Go<span className="text-brand-600 dark:text-brand-400">Campus</span>
          </h1>
          <p className="mt-2 text-sm text-muted">
            Welcome — choose your campus to continue.
          </p>
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          {CHOICES.map((c) => (
            <button
              key={c.mode}
              type="button"
              onClick={() => choose(c.mode)}
              className={`group relative flex flex-col items-start gap-4 rounded-3xl border border-line bg-surface p-6 text-left shadow-card transition hover:-translate-y-1 hover:shadow-pop focus:outline-none focus-visible:ring-2 ${c.ring}`}
            >
              <div
                className={`grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br text-white ${c.tile}`}
              >
                <Icon name={c.icon} className="h-8 w-8" />
              </div>
              <div>
                <div className="flex items-center gap-2 text-xl font-extrabold text-ink">
                  {c.title}
                  <Icon
                    name="arrowRight"
                    className="h-5 w-5 -translate-x-1 text-muted opacity-0 transition group-hover:translate-x-0 group-hover:opacity-100"
                  />
                </div>
                <p className="mt-1 text-sm text-muted">{c.blurb}</p>
              </div>
              <ul className="mt-1 space-y-1.5">
                {c.features.map((f) => (
                  <li
                    key={f}
                    className="flex items-center gap-2 text-xs font-medium text-faint"
                  >
                    <Icon name="check" className="h-3.5 w-3.5 text-emerald-500" />
                    {f}
                  </li>
                ))}
              </ul>
            </button>
          ))}
        </div>

        <p className="mt-8 text-center text-xs text-faint">
          You can switch campus anytime from the sign-in screen.
        </p>
      </div>
    </main>
  );
}
