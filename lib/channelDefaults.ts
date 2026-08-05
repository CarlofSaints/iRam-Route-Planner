import { Channel, Store, StoreOverride } from "./types";

/**
 * A channel's frequency and duration are DEFAULTS: they are materialised onto
 * each store in the channel, and the store is what every downstream reader
 * (route engine, capacity, exports) actually consumes. See lib/repStores.ts —
 * the engine reads store.frequency, never the channel.
 *
 * That design only holds if something propagates a channel edit onto its
 * stores. Nothing did. Setting BUCO to 2x monthly / 120 min changed the
 * channel record alone, and all 68 BUCO stores stayed on the monthly / 30 min
 * that the store upload hardcoded — so the Stores page, the routes and the
 * capacity numbers all silently ignored the channel.
 *
 * A store that has been deliberately diverged from its channel is protected:
 * it carries a StoreOverride record, and cascading past that would throw away
 * a manager's decision.
 */

/** Stores with an override are pinned and must survive a channel cascade. */
export function overriddenStoreIds(overrides: StoreOverride[]): Set<string> {
  return new Set(overrides.map((o) => o.storeId));
}

export interface CascadeChange {
  storeId: string;
  storeName: string;
  channelId: string;
  from: { frequency: string; duration: number };
  to: { frequency: string; duration: number };
}

export interface CascadeResult {
  changes: CascadeChange[];
  skippedOverridden: number;
  storesWithoutChannel: number;
}

/**
 * Push channel defaults down onto the channel's stores.
 *
 * Mutates `stores` in place when `apply` is true; with `apply` false it is a
 * dry run, so a caller can show exactly what would change before committing.
 * Pass `onlyChannelIds` to limit the cascade to the channels being edited.
 */
export function applyChannelDefaults(
  stores: Store[],
  channels: Channel[],
  pinnedStoreIds: Set<string>,
  options: { apply: boolean; onlyChannelIds?: Set<string> }
): CascadeResult {
  const byId = new Map(channels.map((c) => [c.id, c]));
  const changes: CascadeChange[] = [];
  let skippedOverridden = 0;
  let storesWithoutChannel = 0;

  for (const store of stores) {
    const channel = byId.get(store.channelId);
    if (!channel) {
      // Unmapped channel — leave the store exactly as it is rather than
      // guessing a default over it.
      if (options.onlyChannelIds === undefined) storesWithoutChannel++;
      continue;
    }
    if (options.onlyChannelIds && !options.onlyChannelIds.has(channel.id)) continue;

    if (store.frequency === channel.frequency && store.duration === channel.duration) {
      continue;
    }

    if (pinnedStoreIds.has(store.id)) {
      skippedOverridden++;
      continue;
    }

    changes.push({
      storeId: store.id,
      storeName: store.name,
      channelId: channel.id,
      from: { frequency: store.frequency, duration: store.duration },
      to: { frequency: channel.frequency, duration: channel.duration },
    });

    if (options.apply) {
      store.frequency = channel.frequency;
      store.duration = channel.duration;
    }
  }

  return { changes, skippedOverridden, storesWithoutChannel };
}
