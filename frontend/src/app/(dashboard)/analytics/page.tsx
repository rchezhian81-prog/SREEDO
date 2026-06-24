"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { BarChart, LineChart, DonutChart } from "@/components/charts";
import { ErrorNote, PageHeader, Spinner } from "@/components/ui";

interface Charts {
  enrollmentByClass: { label: string; value: number }[];
  attendanceTrend: { date: string; rate: number; present: number; total: number }[];
  feeCollectionByMonth: { month: string; amount: number }[];
  studentsByGender: { label: string; value: number }[];
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const shortMonth = (ym: string) => {
  const [, m] = ym.split("-");
  return MONTHS[Number(m) - 1] ?? ym;
};
const shortDay = (ymd: string) => ymd.slice(5); // MM-DD
const inr = (n: number) =>
  new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(n);

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-5">
      <h2 className="mb-4 text-sm font-semibold text-ink">{title}</h2>
      {children}
    </div>
  );
}

export default function AnalyticsPage() {
  const [charts, setCharts] = useState<Charts | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<Charts>("/dashboard/charts")
      .then(setCharts)
      .catch(() => setError("Could not load analytics."))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Spinner />;
  if (!charts) return <ErrorNote message={error ?? "No data"} />;

  return (
    <>
      <PageHeader title="Analytics" subtitle="Visual insights across your school" />

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Students by class">
          <BarChart data={charts.enrollmentByClass} />
        </Card>

        <Card title="Attendance — last 14 days">
          <LineChart
            data={charts.attendanceTrend.map((d) => ({ label: shortDay(d.date), value: d.rate }))}
          />
        </Card>

        <Card title="Fee collection — last 6 months">
          <BarChart
            data={charts.feeCollectionByMonth.map((d) => ({
              label: shortMonth(d.month),
              value: Math.round(d.amount),
            }))}
            format={(v) => `₹${inr(v)}`}
          />
        </Card>

        <Card title="Students by gender">
          <DonutChart data={charts.studentsByGender} />
        </Card>
      </div>
    </>
  );
}
