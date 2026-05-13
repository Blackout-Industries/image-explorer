// Tiny helpers shared between the Docker v1.2 and OCI parsers.

/** Strip Docker's "/bin/sh -c #(nop) " noise from a history command. */
export function cleanCommand(cmd: string | undefined): string {
  if (!cmd) return '';
  return cmd
    .replace(/^\/bin\/sh -c #\(nop\)\s*/, '')
    .replace(/^\/bin\/sh -c\s*/, 'RUN ')
    .trim();
}
