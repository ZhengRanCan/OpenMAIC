/** A model-facing preview, never a replacement for the authoritative stored source. */
export function sourcePreview(text: string, limit = 512): string {
  if ([...text].length <= limit) return text;
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return [...text].slice(0, Math.max(0, limit - 1)).join('') + '…';
  }
  if (!body || typeof body !== 'object' || Array.isArray(body))
    return JSON.stringify({ preview: [...text].slice(0, 128).join(''), truncated: true });
  const record = body as Record<string, unknown>;
  const contentKeys = ['question', 'options', 'answer', 'previous', 'extractedFact'];
  const content = Object.fromEntries(
    contentKeys.filter((k) => k in record).map((k) => [k, record[k]]),
  );
  const metadata = Object.fromEntries(
    Object.entries(record).filter(([k]) => !contentKeys.includes(k)),
  );
  // Critical metadata is not sliced. An oversized header follows normal request-capacity fallback.
  const result: Record<string, unknown> = {
    ...metadata,
    truncated: true,
    omittedContentFields: Object.keys(content),
  };
  let preview = [...JSON.stringify(content)];
  while (preview.length) {
    result.contentPreview = preview.join('');
    if ([...JSON.stringify(result)].length <= limit) return JSON.stringify(result);
    preview = preview.slice(0, Math.max(0, preview.length - 32));
  }
  delete result.contentPreview;
  return JSON.stringify(result);
}
