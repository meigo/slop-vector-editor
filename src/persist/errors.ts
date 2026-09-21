/** Shared by the store (`state/appState.svelte.ts`) and by `project-io.ts`. Kept in a leaf module
 *  that imports nothing, so those two importing it cannot form a cycle through this. */
export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
