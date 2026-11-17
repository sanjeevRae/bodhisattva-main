/**
 * Unsaved-changes navigation guard.
 *
 * The app uses the component router (<BrowserRouter>), where
 * react-router's useBlocker is unavailable, so the editor registers a
 * guard callback here and the admin shell consults it before in-app
 * navigation; `beforeunload` covers tab close / reload separately.
 */

type Guard = () => boolean; // returns true when navigation may proceed

let guard: Guard | null = null;

export function setNavigationGuard(next: Guard | null): void {
  guard = next;
}

/** Ask the registered guard (if any) whether navigation may proceed. */
export function confirmNavigation(): boolean {
  if (!guard) return true;
  return guard();
}
