import { describe, expect, it } from 'vitest';
import { findPortableSchemaProblems } from '../schema';

describe('findPortableSchemaProblems', () => {
  it('3 社で使える書き方なら問題なし', () => {
    expect(
      findPortableSchemaProblems({
        type: 'object',
        additionalProperties: false,
        required: ['amount', 'items'],
        properties: {
          amount: { type: ['number', 'null'] },
          items: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['name'],
              properties: { name: { type: 'string' } },
            },
          },
        },
      }),
    ).toEqual([]);
  });

  it('いちばん外側がオブジェクトでなければ問題', () => {
    expect(findPortableSchemaProblems({ type: 'array', items: { type: 'string' } })).toContain(
      '$: いちばん外側は type: "object" にしてください',
    );
  });

  it('additionalProperties: false が無い・required から漏れたプロパティ・範囲の指定を見つける（入れ子も）', () => {
    const problems = findPortableSchemaProblems({
      type: 'object',
      additionalProperties: false,
      required: ['amount'],
      properties: {
        amount: { type: 'number', minimum: 0 },
        note: { type: 'string', maxLength: 100 },
        nested: { type: 'object', properties: {} },
      },
    });
    expect(problems).toEqual([
      '$.amount: minimum は使えません（値の範囲は validate で確かめる）',
      '$.note: required に入れてください（無い値は null で表す）',
      '$.note: maxLength は使えません（値の範囲は validate で確かめる）',
      '$.nested: required に入れてください（無い値は null で表す）',
      '$.nested: additionalProperties: false が必要です',
    ]);
  });
});
