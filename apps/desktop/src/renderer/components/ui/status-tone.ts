/** Badge tone classes per status value; unknown values keep the neutral secondary chip. */
export function statusTone(value: string): string {
  switch (value) {
    case "RECONCILED":
    case "COMPLETE":
      return "bg-green-100 text-green-800";
    case "UNRECONCILED":
    case "MAPPING_PROVISIONAL":
    case "ESTIMATED":
      return "bg-amber-100 text-amber-800";
    case "RECONCILIATION_FAILED":
      return "bg-red-100 text-red-700";
    case "UNAVAILABLE":
      return "bg-slate-100 text-slate-600";
    default:
      return "";
  }
}
