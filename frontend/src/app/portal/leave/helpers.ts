import type { PortalLeaveRequest, PortalLeaveStatus, PortalLeaveType } from "@/types";

/**
 * The server lets a caller cancel only requests they filed themselves
 * (appliedBy === caller); the portal additionally scopes the button to
 * pending requests per the T9.1 build scope — cancelling an approved leave
 * (which reverts excused attendance) stays a staff-side action.
 */
export function canCancel(
  row: Pick<PortalLeaveRequest, "status" | "appliedBy">,
  userId: string | null | undefined
): boolean {
  return row.status === "pending" && !!userId && row.appliedBy === userId;
}

export function statusTone(
  status: PortalLeaveStatus
): "amber" | "green" | "red" | "slate" {
  switch (status) {
    case "pending":
      return "amber";
    case "approved":
      return "green";
    case "rejected":
      return "red";
    default:
      return "slate";
  }
}

/** Both dates present and from ≤ to (YYYY-MM-DD strings compare lexically). */
export function dateRangeValid(fromDate: string, toDate: string): boolean {
  return fromDate !== "" && toDate !== "" && fromDate <= toDate;
}

export const LEAVE_TYPE_LABELS: Record<PortalLeaveType, string> = {
  sick: "Sick",
  casual: "Casual",
  emergency: "Emergency",
  other: "Other",
};

export function typeLabel(type: PortalLeaveType | null): string {
  return type ? LEAVE_TYPE_LABELS[type] : LEAVE_TYPE_LABELS.other;
}
