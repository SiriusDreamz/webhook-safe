export type EventStatus = "processing" | "completed";

export interface IdempotencyClaim {
  token: string;
}

export interface IdempotencyStore {
  get(key: string): Promise<EventStatus | null>;

  /**
   * Atomically claims an event for processing.
   *
   * A processing claim expires after leaseMs if it is not completed
   * or explicitly released.
   *
   * Returns a unique token identifying the claim owner.
   */
  claim(key: string, leaseMs: number): Promise<IdempotencyClaim | null>;

  /**
   * Renews a processing lease only if the supplied claim still owns it.
   *
   * Returns true when the lease was renewed.
   */
  renew(
    key: string,
    claim: IdempotencyClaim,
    leaseMs: number,
  ): Promise<boolean>;

  /**
   * Releases an event only if the supplied claim still owns it.
   */
  release(key: string, claim: IdempotencyClaim): Promise<void>;

  /**
   * Marks an event completed only if the supplied claim still owns it.
   */
  setCompleted(key: string, claim: IdempotencyClaim): Promise<void>;
}
