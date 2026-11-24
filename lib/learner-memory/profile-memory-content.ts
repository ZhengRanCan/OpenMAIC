const unknownHelp =
  /(?:帮助(?:条件|情况|状态)(?:未知|未确认|不明)|(?:记录)?未确认是否(?:获得|得到)帮助|是否获得帮助(?:未知|未确认))/
    .source;
const inUnknownConditions = new RegExp(`在${unknownHelp}(?:的)?情况下[，,、\\s]*`, 'gu');
const unknownHelpModifier = new RegExp(`在${unknownHelp}的`, 'gu');
const parenthetical = new RegExp(`[（(]\\s*${unknownHelp}[。.!]?\\s*[）)]`, 'gu');
const standalone = new RegExp(
  `(^|[，,。；;：:！？!?\\n]\\s*)(?:${unknownHelp}\\s*(?:[，,。；;：:！？!?\\n]\\s*|$))+`,
  'gu',
);

/** Removes conventional unknown-help wording from generated experience summaries. */
export function omitUnknownHelpFromExperience(summary: string): string {
  const cleaned = summary
    .replace(inUnknownConditions, '')
    .replace(unknownHelpModifier, '在')
    .replace(parenthetical, '')
    .replace(standalone, '$1')
    .replace(/\s*\(\s*(?:help|assistance)(?: status)? (?:was )?(?:unknown|unconfirmed)\s*\)/gi, '')
    .replace(
      /(^|[.!?;,]\s*)(?:help|assistance)(?: status)? (?:was )?(?:unknown|unconfirmed)(?:[.!?;,]\s*|$)/gi,
      '$1',
    )
    .replace(/[ \t]+with unknown (?:help|assistance)(?=[.,;!?]|$)/gi, '');
  return cleaned === summary ? summary : cleaned.replace(/^[\s，,。；;：:]+|[\s，,；;：:]+$/gu, '');
}
