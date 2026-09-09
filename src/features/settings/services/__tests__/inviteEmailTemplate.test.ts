// 招待メール本文組み立ての単体テスト。
// 差し込み値のサニタイズ（改行・制御文字）と HTML エスケープを重点的に確認する。

import { describe, expect, it } from 'vitest';
import {
  buildInviteEmail,
  escapeHtml,
  sanitizeInlineText,
} from '../inviteEmailTemplate';

describe('sanitizeInlineText', () => {
  it('改行・タブなどの制御文字を空白1つに置き換える', () => {
    expect(sanitizeInlineText('山田\r\n太郎')).toBe('山田 太郎');
    expect(sanitizeInlineText('株式会社\tサンプル')).toBe('株式会社 サンプル');
  });

  it('Unicode の行区切り文字（U+2028 / U+2029）も除去する', () => {
    expect(sanitizeInlineText('山田\u2028太郎\u2029')).toBe('山田 太郎');
  });

  it('前後の空白を取り除く', () => {
    expect(sanitizeInlineText('  山田 太郎  ')).toBe('山田 太郎');
  });

  it('通常の文字列はそのまま返す', () => {
    expect(sanitizeInlineText('山田 太郎')).toBe('山田 太郎');
  });
});

describe('escapeHtml', () => {
  it('HTML の特殊文字をエスケープする', () => {
    expect(escapeHtml('<script>alert("x")</script>')).toBe(
      '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;',
    );
    expect(escapeHtml("O'Brien & Co")).toBe('O&#39;Brien &amp; Co');
  });
});

describe('buildInviteEmail', () => {
  const input = {
    inviterName: '山田 太郎',
    organizationName: 'サンプル株式会社',
    inviteUrl: 'https://example.com/invite/00000000-0000-0000-0000-000000000000',
    expiresAt: '2026-07-23T00:00:00.000Z',
  };

  it('件名に組織名とプラットフォーム名が入る', () => {
    const { subject } = buildInviteEmail(input);
    expect(subject).toBe('【GreenTrack】サンプル株式会社 への招待');
  });

  it('本文（テキスト・HTML）に必須要素がすべて含まれる', () => {
    const { text, html } = buildInviteEmail(input);
    for (const body of [text, html]) {
      expect(body).toContain('山田 太郎');
      expect(body).toContain('サンプル株式会社');
      expect(body).toContain('GreenTrack');
      expect(body).toContain(input.inviteUrl);
      expect(body).toContain('7日間');
      expect(body).toContain('このメールには返信しないでください');
    }
  });

  it('有効期限の日付（日本時間）が本文に入る', () => {
    const { text } = buildInviteEmail(input);
    expect(text).toContain('2026/07/23');
  });

  it('有効期限がパース不能でも「7日間」の固定表現で成立する', () => {
    const { text } = buildInviteEmail({ ...input, expiresAt: 'invalid' });
    expect(text).toContain('有効期限は発行から7日間です');
  });

  it('招待者名の改行は除去される（本文偽装対策）', () => {
    const { subject, text } = buildInviteEmail({
      ...input,
      inviterName: '山田\r\n※至急ここに送金してください\r\n太郎',
      organizationName: '組織\nA',
    });
    expect(subject).not.toMatch(/[\r\n]/);
    expect(subject).toContain('組織 A');
    expect(text).toContain('山田 ※至急ここに送金してください 太郎');
  });

  it('HTML 本文では差し込み値がエスケープされる（HTMLインジェクション対策）', () => {
    const { html } = buildInviteEmail({
      ...input,
      inviterName: '<img src=x onerror=alert(1)>',
    });
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });
});
