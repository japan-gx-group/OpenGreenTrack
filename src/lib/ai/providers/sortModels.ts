// プルダウンに並べる順番（3 社共通）: 廃止予定でないものを先に、新しい順。作成日が無ければ ID の降順。

import 'server-only';
import type { AiModelOption } from '@/types/ai';

const compareIdsDescending = (a: string, b: string) =>
  b.localeCompare(a, undefined, { numeric: true });

export const sortModelOptions = (models: AiModelOption[]): AiModelOption[] =>
  [...models].sort((a, b) => {
    if (a.deprecated !== b.deprecated) return a.deprecated ? 1 : -1;
    if (a.createdAt && b.createdAt && a.createdAt !== b.createdAt) {
      return a.createdAt < b.createdAt ? 1 : -1;
    }
    if (a.createdAt && !b.createdAt) return -1;
    if (!a.createdAt && b.createdAt) return 1;
    return compareIdsDescending(a.id, b.id);
  });
