// 出力の形（JSON スキーマ）の確認（サーバ専用）。3 社の制約を同時に満たす書き方になっているかを、送る前に確かめる。
//
// - いちばん外側はオブジェクト
// - すべてのオブジェクトに additionalProperties: false（Anthropic・OpenAI の要件）
// - すべてのプロパティを required にする。無い値は null で表す（OpenAI の strict の要件。例: "type": ["string", "null"]）
// - minimum・maximum・minLength・maxLength などの範囲の指定は書かない（Anthropic は 400、Gemini は黙って無視する）。
//   値の範囲は機能側の validate で確かめる

import 'server-only';

export type AiJsonSchema = Record<string, unknown>;

const UNSUPPORTED_KEYWORDS = [
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'minLength',
  'maxLength',
  'minItems',
  'maxItems',
  'pattern',
  'format',
] as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const typesOf = (schema: Record<string, unknown>): string[] =>
  Array.isArray(schema.type) ? schema.type.filter((t): t is string => typeof t === 'string') : typeof schema.type === 'string' ? [schema.type] : [];

/** 3 社で使えない書き方の一覧を返す（空なら使える）。メッセージは開発者向け */
export const findPortableSchemaProblems = (schema: AiJsonSchema): string[] => {
  const problems: string[] = [];

  const visit = (node: unknown, path: string) => {
    if (!isRecord(node)) return;
    for (const keyword of UNSUPPORTED_KEYWORDS) {
      if (keyword in node) problems.push(`${path}: ${keyword} は使えません（値の範囲は validate で確かめる）`);
    }
    if (typesOf(node).includes('object')) {
      if (node.additionalProperties !== false) {
        problems.push(`${path}: additionalProperties: false が必要です`);
      }
      const properties = isRecord(node.properties) ? node.properties : {};
      const required = Array.isArray(node.required) ? node.required : [];
      for (const name of Object.keys(properties)) {
        if (!required.includes(name)) problems.push(`${path}.${name}: required に入れてください（無い値は null で表す）`);
        visit(properties[name], `${path}.${name}`);
      }
    }
    if (isRecord(node.items)) visit(node.items, `${path}[]`);
  };

  if (!typesOf(schema).includes('object')) {
    problems.push('$: いちばん外側は type: "object" にしてください');
  }
  visit(schema, '$');
  return problems;
};
