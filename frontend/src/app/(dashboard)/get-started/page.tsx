"use client";

import Link from "next/link";
import { PageHeader, Card } from "@/components/ui";
import { Icon, type IconName } from "@/components/icons";
import { useModeStore } from "@/stores/mode-store";
import { useTerms } from "@/lib/terms";

type Step = {
  icon: IconName;
  title: string;
  desc: string;
  href: string;
  cta: string;
};

export default function GetStartedPage() {
  const mode = useModeStore((s) => s.mode);
  const term = useTerms();
  const isCollege = mode === "college";

  const steps: Step[] = isCollege
    ? [
        {
          icon: "network",
          title: "Create departments",
          desc: "Set up the academic departments that own your programs.",
          href: "/college/departments",
          cta: "Departments",
        },
        {
          icon: "layers",
          title: "Add programs",
          desc: "Define the degree and diploma programs under each department.",
          href: "/college/programs",
          cta: "Programs",
        },
        {
          icon: "calendar",
          title: "Set up semesters",
          desc: "Create the semesters students are enrolled into.",
          href: "/college/semesters",
          cta: "Semesters",
        },
        {
          icon: "board",
          title: `Add ${term.teachers.toLowerCase()}`,
          desc: "Invite faculty members and record their specializations.",
          href: "/teachers",
          cta: term.teachers,
        },
        {
          icon: "userPlus",
          title: "Enroll students",
          desc: "Register students into programs, semesters and batches.",
          href: "/college/enrollments",
          cta: "Enrollments",
        },
        {
          icon: "gear",
          title: "Set up fees",
          desc: "Configure fee categories, schedules and fine rules.",
          href: "/fees/setup",
          cta: "Fee setup",
        },
      ]
    : [
        {
          icon: "school",
          title: `Create ${term.klassPlural.toLowerCase()} & ${term.sectionPlural.toLowerCase()}`,
          desc: "Set up your classes and the sections inside each one.",
          href: "/classes",
          cta: term.klassPlural,
        },
        {
          icon: "board",
          title: `Add ${term.teachers.toLowerCase()}`,
          desc: "Add your teaching staff and their subjects.",
          href: "/teachers",
          cta: term.teachers,
        },
        {
          icon: "cap",
          title: "Enroll students",
          desc: "Admit students and assign them to their sections.",
          href: "/students",
          cta: term.students,
        },
        {
          icon: "calendar",
          title: "Build the timetable",
          desc: "Create periods and generate the class timetable.",
          href: "/timetable",
          cta: "Timetable",
        },
        {
          icon: "gear",
          title: "Set up fees",
          desc: "Configure fee categories, schedules and fine rules.",
          href: "/fees/setup",
          cta: "Fee setup",
        },
      ];

  const tile = isCollege
    ? "bg-violet-500/12 text-violet-600 dark:text-violet-300"
    : "bg-brand-500/12 text-brand-600 dark:text-brand-300";
  const link = isCollege
    ? "text-violet-600 dark:text-violet-300"
    : "text-brand-600 dark:text-brand-300";

  return (
    <>
      <PageHeader
        title="Get started"
        subtitle={`A quick setup checklist for your ${
          isCollege ? "college" : "school"
        }.`}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        {steps.map((step, i) => (
          <Card key={step.href} className="flex items-start gap-4">
            <div
              className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl ${tile}`}
            >
              <Icon name={step.icon} className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-hover text-[11px] font-bold text-muted">
                  {i + 1}
                </span>
                <h3 className="font-bold text-ink">{step.title}</h3>
              </div>
              <p className="mt-1 text-sm text-muted">{step.desc}</p>
              <Link
                href={step.href}
                className={`mt-3 inline-flex items-center gap-1 text-sm font-semibold hover:underline ${link}`}
              >
                {step.cta}
                <Icon name="arrowRight" className="h-4 w-4" />
              </Link>
            </div>
          </Card>
        ))}
      </div>
    </>
  );
}
