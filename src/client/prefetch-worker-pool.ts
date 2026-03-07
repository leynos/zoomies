import type { PrefetchRenderRequest, PrefetchRenderResponse } from "../shared/render-protocol";

interface PendingJob {
  readonly reject: (error?: unknown) => void;
  readonly request: PrefetchRenderRequest;
  readonly resolve: (response: PrefetchRenderResponse) => void;
}

/**
 * Small browser worker pool dedicated to speculative rendering.
 */
export class PrefetchWorkerPool {
  readonly #idleWorkers: Worker[] = [];
  readonly #inFlight = new Map<Worker, PendingJob>();
  readonly #queue: PendingJob[] = [];
  readonly #workers: Worker[];

  constructor(workerUrl: string, size: number) {
    this.#workers = Array.from({ length: size }, () => new Worker(workerUrl, { type: "module" }));

    for (const worker of this.#workers) {
      worker.onmessage = (event: MessageEvent<PrefetchRenderResponse>) => {
        const pending = this.#inFlight.get(worker);
        this.#inFlight.delete(worker);
        this.#idleWorkers.push(worker);

        if (pending) {
          pending.resolve(event.data);
        }

        this.#dispatch();
      };

      worker.onerror = (event) => {
        const pending = this.#inFlight.get(worker);
        this.#inFlight.delete(worker);
        this.#idleWorkers.push(worker);

        if (pending) {
          pending.reject(event.error ?? new Error("Prefetch worker failed."));
        }

        this.#dispatch();
      };

      this.#idleWorkers.push(worker);
    }
  }

  /**
   * Queue a speculative render request.
   */
  enqueue(request: PrefetchRenderRequest) {
    return new Promise<PrefetchRenderResponse>((resolve, reject) => {
      this.#queue.push({ reject, request, resolve });
      this.#dispatch();
    });
  }

  /**
   * Drop queued jobs and respawn workers to cancel in-flight speculative work.
   */
  reset(workerUrl: string) {
    for (const pending of this.#queue.splice(0)) {
      pending.reject(new Error("Prefetch job cancelled."));
    }

    for (const pending of this.#inFlight.values()) {
      pending.reject(new Error("Prefetch job cancelled."));
    }

    this.#inFlight.clear();
    this.#idleWorkers.length = 0;

    const size = this.#workers.length;
    for (const worker of this.#workers) {
      worker.terminate();
    }

    this.#workers.splice(0, this.#workers.length);
    for (let index = 0; index < size; index += 1) {
      const worker = new Worker(workerUrl, { type: "module" });
      worker.onmessage = (event: MessageEvent<PrefetchRenderResponse>) => {
        const pending = this.#inFlight.get(worker);
        this.#inFlight.delete(worker);
        this.#idleWorkers.push(worker);

        if (pending) {
          pending.resolve(event.data);
        }

        this.#dispatch();
      };
      worker.onerror = (event) => {
        const pending = this.#inFlight.get(worker);
        this.#inFlight.delete(worker);
        this.#idleWorkers.push(worker);

        if (pending) {
          pending.reject(event.error ?? new Error("Prefetch worker failed."));
        }

        this.#dispatch();
      };
      this.#workers.push(worker);
      this.#idleWorkers.push(worker);
    }
  }

  /**
   * Terminate every worker when the app unmounts.
   */
  dispose() {
    for (const worker of this.#workers) {
      worker.terminate();
    }

    this.#workers.splice(0, this.#workers.length);
    this.#idleWorkers.length = 0;
    this.#queue.length = 0;
    this.#inFlight.clear();
  }

  #dispatch() {
    while (this.#idleWorkers.length > 0 && this.#queue.length > 0) {
      const worker = this.#idleWorkers.pop();
      const pending = this.#queue.shift();

      if (!worker || !pending) {
        return;
      }

      this.#inFlight.set(worker, pending);
      worker.postMessage(pending.request);
    }
  }
}
