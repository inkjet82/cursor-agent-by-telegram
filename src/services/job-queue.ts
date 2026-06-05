import type { ActiveJob } from "../types.js";

export class JobQueue {
  private running = new Map<number, ActiveJob>();

  isBusy(userId: number): boolean {
    return this.running.has(userId);
  }

  getJob(userId: number): ActiveJob | undefined {
    return this.running.get(userId);
  }

  setJob(userId: number, job: ActiveJob): void {
    this.running.set(userId, job);
  }

  clearJob(userId: number): void {
    this.running.delete(userId);
  }
}
