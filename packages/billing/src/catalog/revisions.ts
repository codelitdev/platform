import type { CatalogRevisionStatus } from "./types.js";

export function canActivateRevision(input: {
  requested: number;
  currentActive: number | null;
  requestedStatus: CatalogRevisionStatus;
}): boolean {
  if (input.requestedStatus !== "pending_verification") {
    return false;
  }
  if (input.currentActive === null) return true;
  return input.requested > input.currentActive;
}

export function olderInstanceMustNotRollback(
  candidateRevision: number,
  activeRevision: number,
): boolean {
  return candidateRevision < activeRevision;
}
