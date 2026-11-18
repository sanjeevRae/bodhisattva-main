/**
 * Platform limits set by owner decision (not derived from the spec).
 *
 * MAX_SUPER_ADMINS — owner decision 2026-11-18: at most 3 Super Admin
 * accounts may exist. The cap is enforced on EVERY creation path:
 * the bootstrap CLI, role assignment (promotion), and invitation
 * creation + acceptance (pending Super Admin invitations count
 * against the cap at creation time). The minimum-1 floor — the last
 * active Super Admin can never be demoted — is a separate guard in
 * the roles service and is unchanged by this limit.
 */
export const MAX_SUPER_ADMINS = 3;
