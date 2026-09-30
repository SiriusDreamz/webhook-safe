export function validateLeaseMs(leaseMs: number): void {
  if (!Number.isFinite(leaseMs) || leaseMs <= 0) {
    throw new RangeError("leaseMs must be a finite number greater than 0");
  }
}
