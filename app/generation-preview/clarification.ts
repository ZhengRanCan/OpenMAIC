export function isClarificationSubmitShortcut(event: {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
}): boolean {
  return event.key === 'Enter' && Boolean(event.ctrlKey || event.metaKey);
}
