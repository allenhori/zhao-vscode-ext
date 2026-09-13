// Whether a compiled file might be stale relative to its source -- the
// "View Compiled Code" banner shown when the compiled output predates
// the last edit. Pure mtime comparison, no filesystem access itself
// (the controller reads both mtimes and passes them in) -- mirrors
// `./compiledCode.ts`'s own "one tested seam" shape.

/**
 * `true` when `compiledMtimeMs` is strictly older than `sourceMtimeMs`
 * -- i.e. the source has been modified since the compiled file was
 * last written. Equal timestamps are not stale: a compile that
 * happened to land in the same millisecond as the source write is not
 * evidence of staleness.
 */
export function isCompiledCodeStale(compiledMtimeMs: number, sourceMtimeMs: number): boolean {
  return compiledMtimeMs < sourceMtimeMs;
}
