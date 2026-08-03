import { Rep, Store, VisitRole, PRIMARY_VISIT_ROLE_ID, DEFAULT_VISIT_ROLES } from "./types";

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
 * by the role's, which is what makes the untouched route engine and capacity
 * calculation plan a quarterly 60-minute QC call instead of a monthly
 * 30-minute sales call. Mutating them cannot corrupt the stored store list.
 */
export function getStoresForRep(
  rep: Rep,
  allStores: Store[],
  role: VisitRole,
  strategy: string | null = null
): Store[] {
  if (!role.isPrimary) {
    return allStores
      .filter((s) => s.repCode2 === rep.code || s.repCode3 === rep.code)
      .map((s) => ({ ...s, frequency: role.frequency, duration: role.duration }));
  }

  const allocated = allStores.filter((s) => s.repCode === rep.code);

  // Channel Dedicated additionally narrows the allocation to the rep's channels.
  if (strategy === "channel_dedicated" && rep.assignedChannels?.length) {
    return allocated.filter((s) => rep.assignedChannels!.includes(s.channelId));
  }

  // Geography / default: the rep calls on every store allocated to them.
  return allocated;
}
