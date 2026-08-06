import {
  Rep,
  Store,
  Channel,
  VisitRole,
  ChannelRoleDefault,
  PRIMARY_VISIT_ROLE_ID,
  DEFAULT_VISIT_ROLES,
} from "./types";

/**
 * What rhythm a given role calls on a given channel at.
 *
 * Resolution order for a non-primary role:
 *   1. the channel's own default for that role, if one has been set
 *   2. the role's frequency/duration — the behaviour before per-channel
 *      defaults existed, so an unset channel changes nothing
 *
 * The primary role never consults `roleDefaults`: its values ARE the channel's
 * top-level frequency/duration, which is what stores already carry.
 */
export function resolveRoleDefault(
  channel: Channel | undefined,
  role: VisitRole
): ChannelRoleDefault {
  if (role.isPrimary) {
    return channel
      ? { frequency: channel.frequency, duration: channel.duration }
      : { frequency: role.frequency, duration: role.duration };
  }
  const set = channel?.roleDefaults?.[role.id];
  if (set) return { frequency: set.frequency, duration: set.duration };
  return { frequency: role.frequency, duration: role.duration };
}

/**
 * Resolve the visit role a rep performs. A rep with no visitRoleId — which is
 * every rep created before visit roles existed — is the primary sales role, so
 * existing data keeps behaving exactly as it did.
 */
export function getRoleForRep(rep: Rep, roles: VisitRole[]): VisitRole {
  const fallback =
    roles.find((r) => r.isPrimary) ??
    roles.find((r) => r.id === PRIMARY_VISIT_ROLE_ID) ??
    DEFAULT_VISIT_ROLES[0];
  if (!rep.visitRoleId) return fallback;
  return roles.find((r) => r.id === rep.visitRoleId) ?? fallback;
}

/**
 * The stores a rep calls on, and at what rhythm.
 *
 * This is the ONE source of truth shared by route generation and capacity —
 * if the two ever disagree, a rep's planned route stops matching their
 * measured utilisation.
 *
 * Primary (sales) role: the stores where they are Store.repCode, visited at
 * the store's own frequency and duration. Unchanged from before roles existed.
 *
 * Higher-level roles (QC, training): the stores where they are the secondary
 * or third rep. These come back as COPIES with frequency and duration replaced
 * by what that role calls at ON THAT STORE'S CHANNEL, which is what makes the
 * untouched route engine and capacity calculation plan a quarterly 60-minute QC
 * call instead of a monthly 30-minute sales call. Mutating them cannot corrupt
 * the stored store list.
 *
 * `channels` is optional only so existing callers keep compiling; without it
 * every channel falls back to the role's own rhythm, i.e. the old behaviour.
 */
export function getStoresForRep(
  rep: Rep,
  allStores: Store[],
  role: VisitRole,
  strategy: string | null = null,
  channels: Channel[] = []
): Store[] {
  if (!role.isPrimary) {
    const byId = new Map(channels.map((c) => [c.id, c]));
    return allStores
      .filter((s) => s.repCode2 === rep.code || s.repCode3 === rep.code)
      .map((s) => {
        const d = resolveRoleDefault(byId.get(s.channelId), role);
        return { ...s, frequency: d.frequency, duration: d.duration };
      });
  }

  const allocated = allStores.filter((s) => s.repCode === rep.code);

  // Channel Dedicated additionally narrows the allocation to the rep's channels.
  if (strategy === "channel_dedicated" && rep.assignedChannels?.length) {
    return allocated.filter((s) => rep.assignedChannels!.includes(s.channelId));
  }

  // Geography / default: the rep calls on every store allocated to them.
  return allocated;
}
