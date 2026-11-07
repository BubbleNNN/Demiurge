export function userError(error: unknown, fallback = '操作未完成，请重试。'): string {
  const value = error instanceof Error ? error.message : fallback;
  return (
    value.replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/, '').replace(/^Error:\s*/, '') ||
    fallback
  );
}
