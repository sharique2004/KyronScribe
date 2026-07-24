// Tiny hand-rolled typed event bus (mitt-style, zero dependencies).
// The API client emits auth lifecycle events here; AuthContext subscribes.

// `type` (not `interface`) so it satisfies the Record<string, unknown> constraint.
export type AppEvents = {
  'session-expired': void;
  'account-deactivated': void;
};

type Handler<T> = (payload: T) => void;

class EventBus<Events extends Record<string, unknown>> {
  private handlers: {
    [K in keyof Events]?: Set<Handler<Events[K]>>;
  } = {};

  on<K extends keyof Events>(type: K, handler: Handler<Events[K]>): () => void {
    (this.handlers[type] ??= new Set()).add(handler);
    // Return an unsubscribe function so callers (React effects) can clean up.
    return () => this.off(type, handler);
  }

  off<K extends keyof Events>(type: K, handler: Handler<Events[K]>): void {
    this.handlers[type]?.delete(handler);
  }

  emit<K extends keyof Events>(
    type: K,
    ...payload: Events[K] extends void ? [] : [Events[K]]
  ): void {
    this.handlers[type]?.forEach((h) => h(payload[0] as Events[K]));
  }
}

export const bus = new EventBus<AppEvents>();
