// JS の \b は ASCII 語境界のみ。日本語・中国語は非 \w なので \b(...)\b で挟むと恒常 false。
// ASCII 側は \b で誤マッチ抑制、CJK 側は素通しの二段構えにする。
export const remainingWords = /(\b(?:remaining|left|balance|available)\b|残り|残量|可用|剩余)/i;
export const usedWords = /(\b(?:used|usage|consumed)\b|利用|使用|已用)/i;
export const quotaWords = /(\b(?:quota|limit|allowance|requests?|credits?|tokens?)\b|上限|枠|配額|额度)/i;
export const resetWords = /(\b(?:reset|resets|renew|renews|next\s+window)\b|リセット|更新|次のウィンドウ|下次)/i;
export const windowWords = /(\b(?:5\s*h|5\s*hours?|hourly|daily|weekly|week|monthly|month)\b|日次|週間|週|月間|月|5時間|小时|周)/i;

export function semanticSignals(text: string): string[] {
  const signals: string[] = [];
  if (remainingWords.test(text)) signals.push('remaining');
  if (usedWords.test(text)) signals.push('used');
  if (quotaWords.test(text)) signals.push('quota');
  if (resetWords.test(text)) signals.push('reset');
  if (windowWords.test(text)) signals.push('window');
  return signals;
}

export function inferWindowLabel(text: string): string {
  const match = text.match(/(5\s*h(?:ours?)?|hourly|daily|weekly|week|monthly|month|日次|週間|週|月間|月|5時間|小时|周)/i);
  return match?.[1] ?? 'current';
}
