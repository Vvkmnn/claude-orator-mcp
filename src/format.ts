/**
 * Orator notification formatter.
 * Unique visual: gradient fill bar ░▓ — no box/border (distinct from all siblings).
 *
 * Three-zone bar: ░ baseline | ▓ improvement | ░ headroom
 * e.g. "🪶 3.2 ░░░▓▓▓▓▓▓▓▓ 7.8"
 */

/** Full notification with score bar, techniques, and summary. */
export function fmt(
  before: number,
  after: number,
  techniques: string[],
  issueCount: number,
  summary: string,
): string {
  const b = Math.round(before);
  const a = Math.round(after);
  const bar =
    '\u2591'.repeat(b) + '\u2593'.repeat(Math.max(0, a - b)) + '\u2591'.repeat(Math.max(0, 10 - a));

  const header = `\u{1FAB6} ${before.toFixed(1)} ${bar} ${after.toFixed(1)}`;
  const techs = techniques.map((t) => `+${t}`).join(' ');
  const detail = issueCount > 0 ? `${techs} \u00B7 ${issueCount} issues` : techs;
  return `${header}\n   ${detail}\n   ${summary}`;
}

/** Minimal single-line notification (already good / error). */
export function fmtMinimal(message: string): string {
  return `\u{1FAB6} \u2501\u2501 ${message}`;
}
