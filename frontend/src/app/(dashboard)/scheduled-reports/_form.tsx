"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import {
  Button,
  Card,
  ErrorNote,
  Field,
  Input,
  Select,
  Spinner,
} from "@/components/ui";
import type {
  AccountUser,
  CustomReport,
  Paginated,
  ScheduleChannel,
  ScheduleExportFormat,
  ScheduleFrequency,
  ScheduledReport,
} from "@/types";

const DAYS_OF_WEEK = [
  { value: 0, label: "Sunday" },
  { value: 1, label: "Monday" },
  { value: 2, label: "Tuesday" },
  { value: 3, label: "Wednesday" },
  { value: 4, label: "Thursday" },
  { value: 5, label: "Friday" },
  { value: 6, label: "Saturday" },
];

const CHANNELS: { value: ScheduleChannel; label: string }[] = [
  { value: "in_app", label: "In-app" },
  { value: "email", label: "Email" },
];

export default function ScheduleForm({
  existing,
}: {
  existing?: ScheduledReport;
}) {
  const router = useRouter();

  const [reports, setReports] = useState<CustomReport[]>([]);
  const [users, setUsers] = useState<AccountUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Form state.
  const [reportId, setReportId] = useState(existing?.reportId ?? "");
  const [name, setName] = useState(existing?.name ?? "");
  const [frequency, setFrequency] = useState<ScheduleFrequency>(
    existing?.frequency ?? "daily"
  );
  const [dayOfWeek, setDayOfWeek] = useState<number>(existing?.dayOfWeek ?? 1);
  const [dayOfMonth, setDayOfMonth] = useState<string>(
    existing?.dayOfMonth != null ? String(existing.dayOfMonth) : "1"
  );
  const [runTime, setRunTime] = useState(existing?.runTime ?? "08:00");
  const [timezone, setTimezone] = useState(existing?.timezone ?? "UTC");
  const [recipients, setRecipients] = useState<string[]>(
    existing?.recipients ?? []
  );
  const [channels, setChannels] = useState<ScheduleChannel[]>(
    existing?.channels ?? ["in_app"]
  );
  const [exportFormat, setExportFormat] = useState<ScheduleExportFormat>(
    existing?.exportFormat ?? "csv"
  );
  const [enabled, setEnabled] = useState(existing?.enabled ?? true);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Load the saved reports + users for the pickers.
  useEffect(() => {
    setLoading(true);
    setLoadError(null);
    Promise.all([
      api.get<CustomReport[]>("/custom-reports"),
      api
        .get<Paginated<AccountUser>>("/users?limit=200")
        .then((result) => result.data)
        .catch((err) => {
          console.error("Failed to load users", err);
          return [] as AccountUser[];
        }),
    ])
      .then(([reportList, userList]) => {
        setReports(reportList);
        setUsers(userList);
      })
      .catch((err) =>
        setLoadError(
          err instanceof ApiError ? err.message : "Failed to load form data"
        )
      )
      .finally(() => setLoading(false));
  }, []);

  const sortedUsers = useMemo(
    () =>
      [...users].sort((a, b) =>
        a.fullName.localeCompare(b.fullName)
      ),
    [users]
  );

  const toggleRecipient = (id: string) =>
    setRecipients((prev) =>
      prev.includes(id) ? prev.filter((r) => r !== id) : [...prev, id]
    );

  const toggleChannel = (value: ScheduleChannel) =>
    setChannels((prev) =>
      prev.includes(value)
        ? prev.filter((c) => c !== value)
        : [...prev, value]
    );

  const onSubmit = async () => {
    setSaveError(null);
    if (!reportId) {
      setSaveError("Choose a saved report to schedule");
      return;
    }
    if (!name.trim()) {
      setSaveError("Enter a schedule name");
      return;
    }
    if (!/^\d{2}:\d{2}$/.test(runTime)) {
      setSaveError("Enter a run time as HH:MM");
      return;
    }
    if (frequency === "monthly") {
      const day = Number(dayOfMonth);
      if (!Number.isInteger(day) || day < 1 || day > 31) {
        setSaveError("Day of month must be between 1 and 31");
        return;
      }
    }

    const body = {
      reportId,
      name: name.trim(),
      frequency,
      runTime,
      timezone: timezone.trim() || "UTC",
      dayOfWeek: frequency === "weekly" ? dayOfWeek : null,
      dayOfMonth: frequency === "monthly" ? Number(dayOfMonth) : null,
      recipients,
      channels,
      exportFormat,
      enabled,
    };

    setSaving(true);
    try {
      if (existing) {
        await api.patch<ScheduledReport>(
          `/scheduled-reports/${existing.id}`,
          body
        );
      } else {
        await api.post<ScheduledReport>("/scheduled-reports", body);
      }
      router.push("/scheduled-reports");
    } catch (err) {
      setSaveError(
        err instanceof ApiError ? err.message : "Failed to save schedule"
      );
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <Spinner />;
  if (loadError) return <ErrorNote message={loadError} />;

  return (
    <div className="space-y-6">
      {/* Report & schedule */}
      <Card>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">
          Report & schedule
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Saved report">
            <Select
              value={reportId}
              onChange={(event) => setReportId(event.target.value)}
            >
              <option value="">— Choose a saved report —</option>
              {reports.map((report) => (
                <option key={report.id} value={report.id}>
                  {report.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Schedule name">
            <Input
              placeholder="e.g. Weekly attendance digest"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
          <Field label="Frequency">
            <Select
              value={frequency}
              onChange={(event) =>
                setFrequency(event.target.value as ScheduleFrequency)
              }
            >
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </Select>
          </Field>
          {frequency === "weekly" && (
            <Field label="Day of week">
              <Select
                value={String(dayOfWeek)}
                onChange={(event) => setDayOfWeek(Number(event.target.value))}
              >
                {DAYS_OF_WEEK.map((day) => (
                  <option key={day.value} value={day.value}>
                    {day.label}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          {frequency === "monthly" && (
            <Field label="Day of month">
              <Input
                type="number"
                min={1}
                max={31}
                value={dayOfMonth}
                onChange={(event) => setDayOfMonth(event.target.value)}
              />
            </Field>
          )}
          <Field label="Run time (HH:MM)">
            <Input
              type="time"
              value={runTime}
              onChange={(event) => setRunTime(event.target.value)}
            />
          </Field>
          <Field label="Timezone">
            <Input
              placeholder="UTC"
              value={timezone}
              onChange={(event) => setTimezone(event.target.value)}
            />
          </Field>
        </div>
      </Card>

      {/* Delivery */}
      <Card>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">
          Delivery
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Export format">
            <Select
              value={exportFormat}
              onChange={(event) =>
                setExportFormat(event.target.value as ScheduleExportFormat)
              }
            >
              <option value="csv">CSV</option>
              <option value="pdf">PDF</option>
              <option value="both">Both</option>
            </Select>
          </Field>
          <div>
            <span className="mb-1 block text-sm font-medium text-muted">
              Channels
            </span>
            <div className="flex flex-wrap gap-4 pt-2">
              {CHANNELS.map((channel) => (
                <label
                  key={channel.value}
                  className="flex items-center gap-2 text-sm font-medium text-muted"
                >
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-line text-brand-600 focus:ring-brand-500"
                    checked={channels.includes(channel.value)}
                    onChange={() => toggleChannel(channel.value)}
                  />
                  {channel.label}
                </label>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-4">
          <span className="mb-1 block text-sm font-medium text-muted">
            Recipients
          </span>
          {sortedUsers.length === 0 ? (
            <p className="text-sm text-muted">No users available.</p>
          ) : (
            <div className="max-h-64 overflow-y-auto rounded-lg border border-line p-3">
              <div className="grid gap-2 sm:grid-cols-2">
                {sortedUsers.map((user) => (
                  <label
                    key={user.id}
                    className="flex items-center gap-2 text-sm text-muted"
                  >
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-line text-brand-600 focus:ring-brand-500"
                      checked={recipients.includes(user.id)}
                      onChange={() => toggleRecipient(user.id)}
                    />
                    <span>
                      <span className="font-medium text-ink">
                        {user.fullName}
                      </span>
                      <span className="block text-xs text-faint">
                        {user.email}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            </div>
          )}
          <p className="mt-1 text-xs text-faint">
            {recipients.length} recipient
            {recipients.length === 1 ? "" : "s"} selected
          </p>
        </div>
      </Card>

      {/* Status & save */}
      <Card>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">
          Status
        </h2>
        <label className="flex items-center gap-2 text-sm font-medium text-muted">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-line text-brand-600 focus:ring-brand-500"
            checked={enabled}
            onChange={(event) => setEnabled(event.target.checked)}
          />
          Enabled
        </label>
        <p className="mt-1 text-xs text-faint">
          When disabled, the schedule will not run automatically.
        </p>
        <div className="mt-3">
          <ErrorNote message={saveError} />
        </div>
        <div className="mt-4 flex gap-2">
          <Button onClick={onSubmit} disabled={saving}>
            {saving
              ? "Saving…"
              : existing
                ? "Save changes"
                : "Create schedule"}
          </Button>
          <Button
            variant="secondary"
            onClick={() => router.push("/scheduled-reports")}
          >
            Cancel
          </Button>
        </div>
      </Card>
    </div>
  );
}
