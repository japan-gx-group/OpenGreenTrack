// Node で src/ 配下の TypeScript を直接実行するための ESM 解決フック。
// アプリのコードは Next.js / tsconfig の慣習で拡張子なしの相対 import（`./ideaImport`）を使うが、
// Node の ESM ローダーは拡張子を補完しないため、`.ts` が存在すればそれに解決する。
// 使い方: node --import ./scripts/register-ts-resolver.ts <script.ts>
// （scripts/measure-idea-import.ts など、src/ の実装を import する計測・検証スクリプト用）

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

interface ResolveContext {
  parentURL?: string;
}
type NextResolve = (specifier: string, context: ResolveContext) => Promise<{ url: string }>;

export const resolve = async (
  specifier: string,
  context: ResolveContext,
  nextResolve: NextResolve,
): Promise<{ url: string }> => {
  const isRelative = specifier.startsWith('./') || specifier.startsWith('../');
  const hasExtension = /\.[a-z]+$/i.test(specifier);
  if (isRelative && !hasExtension && context.parentURL) {
    const candidate = new URL(`${specifier}.ts`, context.parentURL);
    if (existsSync(fileURLToPath(candidate))) {
      return nextResolve(candidate.href, context);
    }
  }
  return nextResolve(specifier, context);
};
