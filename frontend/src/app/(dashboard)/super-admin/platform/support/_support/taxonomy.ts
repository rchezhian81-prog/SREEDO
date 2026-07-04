// The Support Access console's presentation surface for status/scope → Badge
// tone + label and the shared date/duration/countdown formatters. The pure logic
// lives in `@/lib/support` so the global SupportModeBanner can reuse it without
// importing from this route-private folder; this module re-exports it so every
// console component can keep importing from "./taxonomy".

export * from "@/lib/support";
