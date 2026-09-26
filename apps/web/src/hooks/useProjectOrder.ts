import { AsyncResult } from "effect/unstable/reactivity";
import { useCallback } from "react";
import { create } from "zustand";
import { toastManager } from "../components/ui/toast";
import { useEnvironments, usePrimaryEnvironmentId } from "../state/environments";
import { serverEnvironment } from "../state/server";
import { useAtomCommand } from "../state/use-atom-command";

const EMPTY_ORDER: readonly string[] = [];

// A reorder shows immediately and holds until the owning server's order it was
// based on changes (our own broadcast, or another client's), or the save fails.
interface PendingOrder {
  readonly environmentId: string;
  readonly order: readonly string[];
  readonly base: readonly string[] | null;
}
const usePendingOrder = create<{ pending: PendingOrder | null }>(() => ({ pending: null }));

/** Moves the dragged keys to the target's position, or returns null for a no-op. */
export function reorderProjectKeys(
  currentOrder: readonly string[],
  draggedKeys: readonly string[],
  targetKeys: readonly string[],
): string[] | null {
  const draggedSet = new Set(draggedKeys);
  const targetSet = new Set(targetKeys);
  if (draggedKeys.every((key) => targetSet.has(key))) {
    return null;
  }
  const originalTargetIndex = currentOrder.findIndex((key) => targetSet.has(key));
  if (originalTargetIndex < 0) {
    return null;
  }

  const order = [...currentOrder];
  const removed: string[] = [];
  let draggedBeforeTarget = 0;
  for (let i = order.length - 1; i >= 0; i--) {
    if (draggedSet.has(order[i]!)) {
      removed.unshift(order.splice(i, 1)[0]!);
      if (i < originalTargetIndex) {
        draggedBeforeTarget++;
      }
    }
  }
  if (removed.length === 0) {
    return null;
  }

  order.splice(originalTargetIndex - Math.max(0, draggedBeforeTarget - 1), 0, ...removed);
  return order;
}

function useProjectOrderEnvironment() {
  const { environments } = useEnvironments();
  const primaryId = usePrimaryEnvironmentId();
  // Hosted clients have no primary. Choose consistently, including disconnected
  // environments, so a temporary outage cannot change which server owns the order.
  return primaryId !== null
    ? environments.find((environment) => environment.environmentId === primaryId)
    : environments.toSorted((a, b) => (a.environmentId < b.environmentId ? -1 : 1))[0];
}

export function useProjectOrder(): readonly string[] {
  const environment = useProjectOrderEnvironment();
  const server = environment?.serverConfig?.settings.sidebarProjectOrder ?? null;
  const pending = usePendingOrder((state) => state.pending);
  if (pending && pending.environmentId === environment?.environmentId && pending.base === server) {
    return pending.order;
  }
  return server ?? EMPTY_ORDER;
}

export function useReorderProjects() {
  const environment = useProjectOrderEnvironment();
  const persist = useAtomCommand(serverEnvironment.updateSettings, "save project order");
  return useCallback(
    async (
      currentOrder: readonly string[],
      draggedKeys: readonly string[],
      targetKeys: readonly string[],
    ) => {
      const order = reorderProjectKeys(currentOrder, draggedKeys, targetKeys);
      if (!order || !environment) return;
      const pending = {
        environmentId: environment.environmentId,
        order,
        base: environment.serverConfig?.settings.sidebarProjectOrder ?? null,
      };
      usePendingOrder.setState({ pending });
      const result = await persist({
        environmentId: environment.environmentId,
        input: { patch: { sidebarProjectOrder: order } },
      });
      if (AsyncResult.isSuccess(result)) return;
      if (usePendingOrder.getState().pending === pending) {
        usePendingOrder.setState({ pending: null });
      }
      toastManager.add({
        type: "warning",
        title: "Project order could not be saved",
        description: "Reconnect to the server and try again.",
      });
    },
    [environment, persist],
  );
}
