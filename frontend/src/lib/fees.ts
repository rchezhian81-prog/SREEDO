// Shared fee-frequency options for the transport & hostel fee forms.
//
// The single source of truth is the backend zod enum used by POST /transport/fees
// and POST /hostel/fees: frequency ∈ { monthly, term, annual }. Keeping ONE shared
// constant here (rather than a per-page copy) is what prevents the dropdown from
// drifting away from the API again — the earlier per-page lists had diverged to
// offer "quarterly"/"one_time", which the backend rejects with a 400.

export type FeeFrequency = "monthly" | "term" | "annual";

export const FEE_FREQUENCIES: { value: FeeFrequency; label: string }[] = [
  { value: "monthly", label: "Monthly" },
  { value: "term", label: "Per term" },
  { value: "annual", label: "Annual" },
];
