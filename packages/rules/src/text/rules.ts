/** Крок «правила» сервера: одна точка для трьох видів тексту. Чиста, синхронна. */
import { hasLink } from './links';
import { MAX_TEXT, TOAST_MAX } from './limits';
import { checkToastText } from './toast';
import { validateNick } from './nick';

export type TextKind = 'message' | 'nick' | 'toast';
export type TextRuleReason = 'empty' | 'too-long' | 'link-forbidden' | 'short' | 'long' | 'link' | 'forbidden' | 'contact' | 'word';

export function textRulesFor(kind: TextKind, text: string): { reason: TextRuleReason } | null {
  if (kind === 'message') {
    if (text.trim().length === 0) return { reason: 'empty' };
    if (text.length > MAX_TEXT) return { reason: 'too-long' };
    if (hasLink(text)) return { reason: 'link-forbidden' };
    return null;
  }
  if (kind === 'nick') {
    const issue = validateNick(text);
    return issue ? { reason: issue as TextRuleReason } : null;
  }
  if (text.trim().length === 0) return { reason: 'empty' };
  if (text.length > TOAST_MAX) return { reason: 'too-long' };
  const issue = checkToastText(text);
  return issue ? { reason: issue.kind } : null;
}
