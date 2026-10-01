export function validateLeaseMs(leaseMs: number): void {
  if (!Number.isFinite(leaseMs) || leaseMs <= 0) {
    throw new RangeError("leaseMs must be a finite number greater than 0");
  }
}

export function validateCompletedTtlMs(completedTtlMs: number): void {
  if (!Number.isFinite(completedTtlMs) || completedTtlMs <= 0) {
    throw new RangeError(
      "completedTtlMs must be a finite number greater than 0",
    );
  }
}
