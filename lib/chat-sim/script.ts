/**
 * Сценарій чату імітації (`data/chat-script.json`) і моменти свята для імітатора. Генератор, що веде стрічки на такті
 * годинника, — `lib/api/sim/ChatSimRuntime` (раніше — хук `useChatSimulator` на кожній сторінці).
 * Моменти беруть ланцюжки трансляцій із шва «Ефір» (`getStreamChains`), а не з каталогу.
 */
import chatScript from '@/data/chat-script.json';
import { getStreamChains, withChains } from '@/lib/api/hooks/live';
import type { ChatScriptFile } from '@/lib/data/types';
import { getData } from '@/lib/data/load';
import { buildMomentContexts, type MomentContext } from './simulator';

export const CHAT_SCRIPT = chatScript as unknown as ChatScriptFile;

let momentsCache: MomentContext[] | null = null;
export function chatMoments(): MomentContext[] {
  if (!momentsCache) momentsCache = buildMomentContexts(withChains(getData(), getStreamChains()));
  return momentsCache;
}
