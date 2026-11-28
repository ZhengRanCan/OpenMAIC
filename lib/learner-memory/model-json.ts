/** Accept one complete JSON object, optionally enclosed in one Markdown JSON fence. */
export function parseModelJSON(reply: string): unknown {
  return JSON.parse(reply.trim().replace(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i, '$1'));
}
