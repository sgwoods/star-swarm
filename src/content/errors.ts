/**
 * What a content failure looks like.
 *
 * `docs/DESIGN.md` section 11: a pack that fails validation never loads. That
 * only helps if the failure says where to look, so every error carries the file
 * it came from and, where there is one, the field inside it.
 */

import type { z } from 'zod';

export interface ContentError {
  /** The pack the file belongs to, or the directory name if the manifest was unreadable. */
  readonly pack: string;
  /** Path relative to the pack root, e.g. `aliens/drone.json`. */
  readonly file: string;
  /** Dotted field path inside the file, e.g. `waves[1].slots[3].alien`. Absent for whole-file problems. */
  readonly field?: string;
  readonly message: string;
}

/** `['waves', 1, 'slots', 3, 'alien']` → `waves[1].slots[3].alien`. */
export function formatFieldPath(path: readonly PropertyKey[]): string | undefined {
  if (path.length === 0) return undefined;
  let out = '';
  for (const key of path) {
    if (typeof key === 'number') out += `[${String(key)}]`;
    else if (out === '') out = String(key);
    else out += `.${String(key)}`;
  }
  return out === '' ? undefined : out;
}

/** Turn a Zod failure into one `ContentError` per issue, so nothing is hidden behind the first. */
export function fromZodError(pack: string, file: string, error: z.ZodError): ContentError[] {
  return error.issues.map((issue) => {
    const field = formatFieldPath(issue.path);
    return field === undefined
      ? { pack, file, message: issue.message }
      : { pack, file, field, message: issue.message };
  });
}

/** One human-readable line per error, grouped by file and in file order. */
export function formatContentErrors(errors: readonly ContentError[]): string[] {
  const byFile = new Map<string, ContentError[]>();
  for (const error of errors) {
    const key = `${error.pack}/${error.file}`;
    const bucket = byFile.get(key);
    if (bucket === undefined) byFile.set(key, [error]);
    else bucket.push(error);
  }

  const lines: string[] = [];
  for (const [key, bucket] of byFile) {
    lines.push(`${key}:`);
    for (const error of bucket) {
      lines.push(
        error.field === undefined ? `  ${error.message}` : `  ${error.field}: ${error.message}`,
      );
    }
  }
  return lines;
}

/** Thrown by the `…OrThrow` helpers, carrying the structured errors as well as the message. */
export class ContentValidationError extends Error {
  readonly errors: readonly ContentError[];

  constructor(errors: readonly ContentError[]) {
    const detail = formatContentErrors(errors).join('\n');
    super(`content validation failed with ${String(errors.length)} problem(s):\n${detail}`);
    this.name = 'ContentValidationError';
    this.errors = errors;
  }
}
