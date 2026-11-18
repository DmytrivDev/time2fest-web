export type MessageTree = { [key: string]: string | MessageTree };
export declare const NAMESPACES: string[];
export function mergeMessages(
  base: MessageTree | undefined,
  ...layers: (MessageTree | undefined)[]
): MessageTree;
export function rawMessages(messages: MessageTree): MessageTree;
export function sourceMessages(uk: MessageTree): MessageTree;
export function localeMessages(locale: string, files: Record<string, MessageTree>): MessageTree;
export function flatKeys(tree: MessageTree, prefix?: string): string[];
export function missingKeys(source: MessageTree, messages: MessageTree): string[];
