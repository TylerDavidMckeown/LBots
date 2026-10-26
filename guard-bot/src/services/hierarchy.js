/**
 * Decides whether `actor` may moderate `target`. Pure, so the rules can be tested.
 * Positions are each member's highest role position; `targetPosition` is null when
 * the target is not in the server (e.g. banning by ID).
 * @returns {string | null} A user-facing reason the action is not allowed, or null.
 */
export function checkHierarchy({
  actorId, actorPosition, actorIsOwner = false, targetId, targetPosition = null,
  guildOwnerId, botId, botPosition, protectedIds = [],
}) {
  if (targetId === actorId) return 'You cannot moderate yourself.';
  if (targetId === botId) return 'I cannot moderate myself.';
  if (targetId === guildOwnerId) return 'The server owner cannot be moderated.';
  if (protectedIds.includes(targetId) && !actorIsOwner) return 'That member is a protected bot owner.';
  if (targetPosition !== null) {
    if (!actorIsOwner && targetPosition >= actorPosition) return 'You can only moderate members whose highest role is below yours.';
    if (targetPosition >= botPosition) return 'That member\'s highest role is equal to or above mine, so I cannot act on them. Move my role higher.';
  }
  return null;
}
