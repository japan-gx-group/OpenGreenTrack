// supabase/migrations/*.sql が DDL のみで構成されているか（データを含んでいないか）を検査する
// スクリプト（AGENTS.md R12「マイグレーションにデータを入れない」の機械チェック）。
//
// 実行: node scripts/db/check-migrations.ts [ディレクトリ]   （既定: supabase/migrations）
//       npm run check:migrations
//   （Node 24 は TypeScript を直接実行できる。依存ライブラリなし）
// 出力: 違反 1 件につき `ファイル:行: <文の先頭 80 文字>  (<理由>)` を 1 行、最後に集計を 1 行
// 終了コード: 違反なし = 0 / 違反あり = 1 / ディレクトリが無い等の実行エラー = 2
// 呼び出し元: CI（.github/workflows/ci.yml）と lefthook の pre-commit（lefthook.yml）
//
// 背景（R12）:
//   migration は DDL 専用。排出係数マスタ・組織・ユーザー・デモデータ・既存行のバックフィル・
//   データ訂正を migration に書かない。本番でも投入する共通マスタは supabase/seeds/production/、
//   テスト・デモ用は supabase/seeds/demo/ に置き、冪等な seed の再投入で反映する。
//   唯一の例外は storage.buckets の定義と設定変更（insert / update。バケットはインフラ設定であり、
//   Supabase 公式の作成手段が SQL のため）。該当するのは 20260831000003_storage.sql の 1 本だけ。
//   delete / truncate / merge / copy は storage.buckets に対しても例外にしない。
//
// 検出できるもの:
//   - 先頭キーワードが insert / update / delete / truncate / merge / copy の文
//   - explain [analyze] <文> / prepare 名 as <文>（実際に実行される中身の文で判定する）と、
//     トップレベルの execute 文（プリペアド文の実行）
//   - create temp[orary] table（一時テーブルへのデータ退避）、create table … as <query> /
//     select … into 新テーブル（データを伴うテーブル作成。破壊的変更の前にテーブルを退避する手口）
//   - with … 句（CTE）の末尾が insert / update / delete / merge の文、および CTE 本体が DML の文
//   - do $$ … $$ ブロック内の上記 DML（if / loop / else の分岐内を含む）
//   いずれも対象テーブルが storage.buckets で、かつ insert / update の場合だけ許容する
//   （テーブルは findViolations の allowedTables で変更可。delete / truncate / merge / copy は許容テーブルでも違反）。
//
// 検出できないもの（PR レビューで確認する）:
//   - create function / procedure の本体（$$ … $$）内の DML。関数本体は migration 適用時ではなく
//     呼び出し時に実行されるため意図的に対象外（RPC・トリガー関数は正当に DML を含む）。
//     ただし migration 内で `select fn()` / `perform fn()` / `call proc()` と呼び出せば
//     データ操作になる。これは検出しない。
//   - do ブロック内の execute '…' / execute format('…') など、文字列リテラルとして組み立てる動的 SQL
//   - copy … from stdin に続くデータ行（copy 文そのものは検出する）
//
// 実装方針（SQL パーサではなく字句レベルのスキャンで判定する）:
//   1. コメント（-- と /* */、入れ子可）と文字列リテラル（'…'。'' エスケープ、E'…' のバックスラッシュ
//      エスケープに対応）の中身を空白へ置き換える。改行は残し原文と同じ長さを保つことで、
//      置き換え後のオフセットから原文の行番号を求められるようにする。
//   2. ドル引用（$$ / $tag$）は、その直前の文の先頭を見て振り分ける:
//        do … $$ … $$  → 本体を「do ブロック」として記録し、あとで別途スキャンする
//        それ以外（create function の本体、値として書かれたドル引用文字列、do ブロック本体の中に
//        現れるドル引用文字列）→ 中身を空白化して対象外にする
//   3. 残りを `;` で文に分割し、先頭キーワードで DML かどうかを判定する。
//      do ブロック本体は plpgsql なので、`;` に加えて begin / loop / then / else / in の直後も
//      文の開始とみなす（`if … then insert …` や `for r in delete … returning` を拾うため）。

import { readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface Violation {
  /** 原文における文の開始行（1 始まり。文の直前のコメントは含めない） */
  line: number;
  /** 違反した文（原文のまま。do ブロック内の場合はその 1 文だけ） */
  statement: string;
  /** 違反理由（日本語。do ブロック内の文は「do ブロック内の …」で始まる） */
  reason: string;
}

export interface FindViolationsOptions {
  /**
   * DML を許容するテーブル。`schema.table` 形式で指定する（引用符なしの識別子は小文字に正規化して比較）。
   * 既定は storage.buckets のみ（R12 の唯一の例外）。許容されるのは定義と設定変更にあたる insert / update だけで、
   * delete / truncate / merge / copy は許容テーブルに対しても違反にする（ALLOWED_TABLE_KEYWORDS）。
   */
  allowedTables?: string[];
}

export const DEFAULT_ALLOWED_TABLES: readonly string[] = ['storage.buckets'];
/** 許容テーブルに対して許容する DML（バケットの定義 = insert、設定変更 = update）。それ以外は許容テーブルでも違反 */
export const ALLOWED_TABLE_KEYWORDS: ReadonlySet<string> = new Set(['insert', 'update']);

/** 既定の検査対象ディレクトリ（カレントディレクトリ = リポジトリルートで実行する前提） */
const DEFAULT_DIR = 'supabase/migrations';

// ---------------------------------------------------------------------------
// 1. 字句スキャン: コメント・文字列・関数本体を空白化し、do ブロック本体の範囲を集める
// ---------------------------------------------------------------------------

interface Range {
  /** 開始オフセット（含む） */
  start: number;
  /** 終了オフセット（含まない） */
  end: number;
}

interface ScanResult {
  /** コメント・文字列リテラル・関数本体などを空白化した SQL（長さは原文と同じ） */
  masked: string;
  /** do ブロック本体（$$ の内側）の範囲。masked 上ではまだ空白化されていない */
  doBodies: Range[];
}

const IDENT_CHAR_RE = /[A-Za-z0-9_]/;
// ドル引用の区切り。タグは識別子と同じ字種（先頭は数字不可）。$1 のような位置パラメータは対象外。
const DOLLAR_DELIM_RE = /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/;
// ドル引用の直前の文が `do` で始まるか（`do $$` / `do language plpgsql $$` の両方）
const DO_HEAD_RE = /^\s*do\b/i;

const blankRange = (chars: string[], from: number, to: number): void => {
  for (let k = from; k < to; k++) {
    if (chars[k] !== '\n') {
      chars[k] = ' ';
    }
  }
};

/** ダブルクォート識別子 `"…"`（`""` エスケープ可）を読み飛ばし、閉じ引用符の次のオフセットを返す */
const skipQuotedIdentifier = (text: string, pos: number): number => {
  let j = pos + 1;
  while (j < text.length) {
    if (text[j] === '"') {
      if (text[j + 1] === '"') {
        j += 2;
        continue;
      }
      return j + 1;
    }
    j++;
  }
  return text.length;
};

/** 直前の `;` からオフセット pos までの（空白化済み）テキスト = 現在の文の先頭部分 */
const statementHead = (chars: string[], pos: number): string => {
  let k = pos - 1;
  while (k >= 0 && chars[k] !== ';') {
    k--;
  }
  return chars.slice(k + 1, pos).join('');
};

const scan = (sql: string): ScanResult => {
  // UTF-16 コード単位で分割し、原文とオフセットを 1:1 に保つ
  const chars = sql.split('');
  const n = sql.length;
  const doBodies: Range[] = [];
  // 現在スキャン中の do ブロック（閉じ区切りを待っているもの）。入れ子は文法上できないが配列で持つ
  const openDoBodies: { delim: string; start: number }[] = [];
  let i = 0;

  while (i < n) {
    const ch = sql[i];
    const next = sql[i + 1];

    // 行コメント
    if (ch === '-' && next === '-') {
      const eol = sql.indexOf('\n', i);
      const stop = eol === -1 ? n : eol;
      blankRange(chars, i, stop);
      i = stop;
      continue;
    }

    // ブロックコメント（PostgreSQL は入れ子を許す）
    if (ch === '/' && next === '*') {
      let depth = 0;
      let j = i;
      while (j < n) {
        if (sql[j] === '/' && sql[j + 1] === '*') {
          depth++;
          j += 2;
          continue;
        }
        if (sql[j] === '*' && sql[j + 1] === '/') {
          depth--;
          j += 2;
          if (depth === 0) {
            break;
          }
          continue;
        }
        j++;
      }
      blankRange(chars, i, j);
      i = j;
      continue;
    }

    // 文字列リテラル。E'…' だけはバックスラッシュでもエスケープできる
    if (ch === "'") {
      const prev = sql[i - 1] ?? '';
      const prev2 = sql[i - 2] ?? '';
      const backslashEscapes = /[eE]/.test(prev) && !IDENT_CHAR_RE.test(prev2);
      let j = i + 1;
      while (j < n) {
        if (backslashEscapes && sql[j] === '\\') {
          j += 2;
          continue;
        }
        if (sql[j] === "'") {
          if (sql[j + 1] === "'") {
            j += 2;
            continue;
          }
          break;
        }
        j++;
      }
      // 引用符自体は残し、中身だけ空白化する
      blankRange(chars, i + 1, Math.min(j, n));
      i = Math.min(j + 1, n);
      continue;
    }

    // ダブルクォート識別子はキーワードではないので中身ごと残し、読み飛ばすだけ。
    // ただし識別子内の ; は文の区切りではないので空白化する（テーブル名の比較には影響しない）
    if (ch === '"') {
      const end = skipQuotedIdentifier(sql, i);
      for (let k = i + 1; k < end - 1; k++) {
        if (chars[k] === ';') {
          chars[k] = ' ';
        }
      }
      i = end;
      continue;
    }

    // ドル引用。識別子には $ を含められる（end$$ は識別子）ため、直前が識別子文字なら区切りとみなさない
    if (ch === '$' && !IDENT_CHAR_RE.test(sql[i - 1] ?? '')) {
      const m = DOLLAR_DELIM_RE.exec(sql.slice(i, i + 64));
      if (m) {
        const delim = m[0];
        const open = openDoBodies[openDoBodies.length - 1];

        // スキャン中の do ブロックの閉じ区切り
        if (open && open.delim === delim) {
          doBodies.push({ start: open.start, end: i });
          openDoBodies.pop();
          i += delim.length;
          continue;
        }

        const bodyStart = i + delim.length;

        // do ブロックの本体はそのまま残して（中のコメント・文字列は通常どおり空白化しながら）先へ進む。
        // すでに do ブロックの中にいるときは、その本体の最初の文に `do $$` の先頭部分が含まれて見えるため
        // 判定せず、閉じ区切り以外のドル引用はすべて文字列として扱う
        if (openDoBodies.length === 0 && DO_HEAD_RE.test(statementHead(chars, i))) {
          openDoBodies.push({ delim, start: bodyStart });
          i = bodyStart;
          continue;
        }

        // 関数本体（create function … as $$ … $$）や値としてのドル引用文字列 → 対象外なので空白化
        const close = sql.indexOf(delim, bodyStart);
        const bodyEnd = close === -1 ? n : close;
        blankRange(chars, bodyStart, bodyEnd);
        i = close === -1 ? n : close + delim.length;
        continue;
      }
    }

    i++;
  }

  // 閉じ区切りの無い do ブロック（壊れた SQL）はファイル末尾まで本体とみなす
  for (const open of openDoBodies) {
    doBodies.push({ start: open.start, end: n });
  }

  return { masked: chars.join(''), doBodies };
};

const blankRanges = (text: string, ranges: Range[]): string => {
  if (ranges.length === 0) {
    return text;
  }
  const chars = text.split('');
  for (const range of ranges) {
    blankRange(chars, range.start, range.end);
  }
  return chars.join('');
};

// ---------------------------------------------------------------------------
// 2. 文への分割
// ---------------------------------------------------------------------------

/** 文の範囲（masked 上のオフセット）。start は最初の非空白文字を指す */
type Segment = Range;

/** トップレベル: `;` だけが文の区切り */
const TOP_LEVEL_BOUNDARY_RE = /;/g;
/**
 * do ブロック本体（plpgsql）: `;` に加えて、直後に文が続く制御キーワードの後ろも文の開始。
 *   begin … / loop … / if … then … / else … / for r in <query> loop
 * （`in` は where 句の `x in (…)` にも一致するが、続くのは `(` や識別子で DML キーワードではないため無害）
 */
const PLPGSQL_BOUNDARY_RE = /;|\b(?:begin|loop|then|else|in)\b/gi;

const splitSegments = (text: string, from: number, to: number, boundary: RegExp): Segment[] => {
  const segments: Segment[] = [];
  const region = text.slice(from, to);
  const re = new RegExp(boundary.source, boundary.flags);

  const pushSegment = (s: number, e: number): void => {
    const firstNonBlank = /\S/.exec(region.slice(s, e));
    if (firstNonBlank) {
      segments.push({ start: from + s + firstNonBlank.index, end: from + e });
    }
  };

  let segStart = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(region)) !== null) {
    pushSegment(segStart, m.index);
    segStart = m.index + m[0].length;
  }
  pushSegment(segStart, region.length);
  return segments;
};

// ---------------------------------------------------------------------------
// 3. 文の判定
// ---------------------------------------------------------------------------

interface Finding {
  reason: string;
  /** 対象テーブル（`schema.table` 正規化済み）。取り出せない場合は null */
  target: string | null;
  /** 判定の元になった DML キーワード（insert / update / delete …）。DML 文でなければ null */
  keyword: string | null;
}

const DML_KEYWORDS = new Set(['insert', 'update', 'delete', 'truncate', 'merge', 'copy']);
// CTE の末尾（または本体）に現れうるデータ変更文
const CTE_DML_KEYWORDS = new Set(['insert', 'update', 'delete', 'merge']);
// CTE の末尾がこれなら読み取り専用
const CTE_READ_KEYWORDS = new Set(['select', 'values', 'table']);
const FIRST_WORD_RE = /^\s*([A-Za-z_][A-Za-z0-9_$]*)/;
const TEMP_TABLE_RE = /^create\s+(?:(?:global|local)\s+)?temp(?:orary)?\s+(?:unlogged\s+)?table\b/i;
// explain analyze <文> は文を実際に実行するため、explain [analyze|verbose] [(オプション…)] を剥がして中身で判定する
const EXPLAIN_PREFIX_RE = /^\s*explain\b(?:\s+(?:analyze|verbose))*(?:\s*\((?:[^()]|\([^()]*\))*\))?\s*/i;
// prepare 名 [(型, …)] as <文> → 中身で判定する（続く execute 名 で実行される）
const PREPARE_PREFIX_RE = /^\s*prepare\s+[A-Za-z_][A-Za-z0-9_$]*(?:\s*\([^)]*\))?\s+as\s+/i;
// トップレベルの select … into 新テーブル。plpgsql の `select … into 変数` とは別物なので do ブロック内には適用しない
const SELECT_INTO_RE = /^\s*select\b[\s\S]*?\binto\b/i;

// 対象テーブル名の取り出し。`schema.table` / `"Quoted"."Name"` の両方に対応
const IDENT_SRC = String.raw`(?:"(?:[^"]|"")+"|[A-Za-z_][A-Za-z0-9_$]*)`;
const QUALIFIED_SRC = `${IDENT_SRC}(?:\\s*\\.\\s*${IDENT_SRC})*`;
const TARGET_RES: Record<string, RegExp> = {
  insert: new RegExp(String.raw`^\s*insert\s+into\s+(?:only\s+)?(${QUALIFIED_SRC})`, 'i'),
  update: new RegExp(String.raw`^\s*update\s+(?:only\s+)?(${QUALIFIED_SRC})`, 'i'),
  delete: new RegExp(String.raw`^\s*delete\s+from\s+(?:only\s+)?(${QUALIFIED_SRC})`, 'i'),
  truncate: new RegExp(String.raw`^\s*truncate\s+(?:table\s+)?(?:only\s+)?(${QUALIFIED_SRC})`, 'i'),
  merge: new RegExp(String.raw`^\s*merge\s+into\s+(?:only\s+)?(${QUALIFIED_SRC})`, 'i'),
  copy: new RegExp(String.raw`^\s*copy\s+(?:binary\s+)?(${QUALIFIED_SRC})`, 'i'),
};

/** `"Quoted"."name"` → `Quoted.name`、`STORAGE.Buckets` → `storage.buckets` に正規化する */
const normalizeQualifiedName = (raw: string): string => {
  const parts: string[] = [];
  const re = /"((?:[^"]|"")+)"|([A-Za-z_][A-Za-z0-9_$]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    parts.push(m[1] !== undefined ? m[1].replace(/""/g, '"') : m[2].toLowerCase());
  }
  return parts.join('.');
};

const extractTarget = (keyword: string, text: string): string | null => {
  const m = TARGET_RES[keyword]?.exec(text);
  return m ? normalizeQualifiedName(m[1]) : null;
};

// create [unlogged] table 名 [(列名, …)] [using …] [with (…)] [on commit …] [tablespace …] as <query>
// （データを伴うテーブル作成）。通常の create table 名 (列定義…) は列定義の直後に as が来ないため一致しない
// （`generated always as (…) stored` は括弧の内側なので対象外）。
const CTAS_RE = new RegExp(
  '^create\\s+(?:unlogged\\s+)?table\\s+(?:if\\s+not\\s+exists\\s+)?' +
    QUALIFIED_SRC +
    '\\s*(?:\\([^()]*\\)\\s*)?(?:using\\s+\\S+\\s*)?(?:with(?:out\\s+oids|\\s*\\([^()]*\\))\\s*)?(?:on\\s+commit\\s+\\w+(?:\\s+rows)?\\s*)?(?:tablespace\\s+\\S+\\s*)?as\\b',
  'i',
);

/**
 * `with …` で始まる文の判定。CTE 定義の括弧を読み飛ばし、括弧の外に最初に現れる
 * 主文のキーワードで判断する。CTE 本体の先頭が DML（データ変更 CTE）の場合も違反にする。
 */
const classifyWith = (text: string, from: number): Finding | null => {
  let depth = 0;
  let i = from;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"') {
      i = skipQuotedIdentifier(text, i);
      continue;
    }
    if (ch === '(') {
      depth++;
      if (depth === 1) {
        const inner = FIRST_WORD_RE.exec(text.slice(i + 1));
        const kw = inner?.[1].toLowerCase();
        if (kw && CTE_DML_KEYWORDS.has(kw)) {
          return {
            reason: `with 句（CTE 本体）の ${kw} 文（DML）`,
            target: extractTarget(kw, text.slice(i + 1)),
            keyword: kw,
          };
        }
      }
      i++;
      continue;
    }
    if (ch === ')') {
      depth = Math.max(0, depth - 1);
      i++;
      continue;
    }
    if (depth === 0) {
      const word = /^[A-Za-z_][A-Za-z0-9_$]*/.exec(text.slice(i));
      if (word) {
        const kw = word[0].toLowerCase();
        if (CTE_DML_KEYWORDS.has(kw)) {
          return {
            reason: `with … ${kw} 文（CTE 経由の DML）`,
            target: extractTarget(kw, text.slice(i)),
            keyword: kw,
          };
        }
        if (CTE_READ_KEYWORDS.has(kw)) {
          return null;
        }
        i += word[0].length;
        continue;
      }
    }
    i++;
  }
  return null;
};

/**
 * 空白化済みの 1 文を判定する。違反でなければ null。
 * insideDoBlock が true のとき（do ブロック本体の文）は、plpgsql 固有の構文と紛らわしい
 * execute（動的 SQL）と select … into（変数への代入）を判定しない。
 */
const classifyStatement = (text: string, insideDoBlock = false): Finding | null => {
  // explain / prepare は前置きを剥がし、実際に実行される中身の文で判定する（トップレベルのみ）
  if (!insideDoBlock) {
    const stripped = text.replace(EXPLAIN_PREFIX_RE, '').replace(PREPARE_PREFIX_RE, '');
    if (stripped !== text) {
      const inner = classifyStatement(stripped, insideDoBlock);
      if (!inner) {
        return null;
      }
      const via = /^\s*explain/i.test(text) ? 'explain 経由の ' : 'prepare 経由の ';
      return { ...inner, reason: via + inner.reason };
    }
  }

  const m = FIRST_WORD_RE.exec(text);
  if (!m) {
    return null;
  }
  const keyword = m[1].toLowerCase();

  if (DML_KEYWORDS.has(keyword)) {
    return { reason: `${keyword} 文（DML）`, target: extractTarget(keyword, text), keyword };
  }
  if (keyword === 'create' && TEMP_TABLE_RE.test(text.trimStart())) {
    return { reason: 'create temporary table（一時テーブルへのデータ退避）', target: null, keyword: null };
  }
  if (keyword === 'create' && CTAS_RE.test(text.trimStart())) {
    return { reason: 'create table … as（データを伴うテーブル作成）', target: null, keyword: null };
  }
  if (keyword === 'with') {
    return classifyWith(text, m[0].length);
  }
  if (!insideDoBlock && keyword === 'execute') {
    return { reason: 'execute 文（プリペアド文の実行）', target: null, keyword: null };
  }
  if (!insideDoBlock && keyword === 'select' && SELECT_INTO_RE.test(text)) {
    return { reason: 'select … into（データを伴うテーブル作成）', target: null, keyword: null };
  }
  return null;
};

const lineOf = (text: string, offset: number): number => {
  let line = 1;
  for (let k = 0; k < offset; k++) {
    if (text.charCodeAt(k) === 10) {
      line++;
    }
  }
  return line;
};

// ---------------------------------------------------------------------------
// 公開 API
// ---------------------------------------------------------------------------

/**
 * SQL テキストから R12 違反（DML 文）を列挙する純粋関数。
 * 結果は原文での出現順（トップレベルの文と do ブロック内の文を合わせて並べ替え）。
 */
export const findViolations = (sql: string, opts: FindViolationsOptions = {}): Violation[] => {
  const allowed = new Set(
    (opts.allowedTables ?? DEFAULT_ALLOWED_TABLES).map((table) => normalizeQualifiedName(table)),
  );
  const { masked, doBodies } = scan(sql);
  // トップレベルの分割では do ブロック本体も空白化し、`do $$ … $$` を 1 文として扱う
  const topLevel = blankRanges(masked, doBodies);
  const found: { offset: number; violation: Violation }[] = [];

  const record = (segment: Segment, text: string, insideDoBlock: boolean): void => {
    const finding = classifyStatement(text, insideDoBlock);
    if (!finding) {
      return;
    }
    // 許容テーブル（storage.buckets）でも、許容するのは定義・設定変更にあたる insert / update だけ
    if (
      finding.target !== null &&
      finding.keyword !== null &&
      ALLOWED_TABLE_KEYWORDS.has(finding.keyword) &&
      allowed.has(finding.target)
    ) {
      return;
    }
    found.push({
      offset: segment.start,
      violation: {
        line: lineOf(sql, segment.start),
        statement: sql.slice(segment.start, segment.end).trimEnd(),
        reason: insideDoBlock ? `do ブロック内の ${finding.reason}` : finding.reason,
      },
    });
  };

  for (const segment of splitSegments(topLevel, 0, topLevel.length, TOP_LEVEL_BOUNDARY_RE)) {
    record(segment, topLevel.slice(segment.start, segment.end), false);
  }
  for (const body of doBodies) {
    for (const segment of splitSegments(masked, body.start, body.end, PLPGSQL_BOUNDARY_RE)) {
      record(segment, masked.slice(segment.start, segment.end), true);
    }
  }

  found.sort((a, b) => a.offset - b.offset);
  return found.map((entry) => entry.violation);
};

export interface FileReport {
  /** 表示用パス（引数のディレクトリ + ファイル名） */
  file: string;
  violations: Violation[];
}

/** ディレクトリ直下の *.sql をファイル名順に検査する */
export const checkDirectory = (dir: string): FileReport[] =>
  readdirSync(dir)
    .filter((name) => name.toLowerCase().endsWith('.sql'))
    .sort()
    .map((name) => {
      const file = path.join(dir, name);
      return { file, violations: findViolations(readFileSync(file, 'utf8')) };
    });

/** `ファイル:行: <文の先頭 80 文字>  (<理由>)` 形式の 1 行 */
export const formatViolation = (file: string, violation: Violation): string => {
  const summary = violation.statement.replace(/\s+/g, ' ').trim().slice(0, 80);
  return `${file}:${violation.line}: ${summary}  (${violation.reason})`;
};

const USAGE = `使い方: node scripts/db/check-migrations.ts [ディレクトリ]
  ディレクトリ直下の *.sql を検査し、DML（insert / update / delete / truncate / merge / copy、
  explain / prepare 経由の DML と execute、create temporary table / create table … as / select … into、
  with … DML、do ブロック内の DML）を含むファイルを報告する。
  既定のディレクトリは ${DEFAULT_DIR}。終了コード: 0 = 違反なし / 1 = 違反あり / 2 = 実行エラー`;

const main = (argv: string[]): number => {
  if (argv.includes('-h') || argv.includes('--help')) {
    console.log(USAGE);
    return 0;
  }
  const dir = argv[0] ?? DEFAULT_DIR;

  let isDirectory = false;
  try {
    isDirectory = statSync(dir).isDirectory();
  } catch {
    isDirectory = false;
  }
  if (!isDirectory) {
    console.error(`check-migrations: ディレクトリが見つかりません: ${dir}`);
    return 2;
  }

  const reports = checkDirectory(dir);
  let violationCount = 0;
  let flaggedFileCount = 0;
  for (const report of reports) {
    if (report.violations.length === 0) {
      continue;
    }
    flaggedFileCount++;
    for (const violation of report.violations) {
      violationCount++;
      console.log(formatViolation(report.file, violation));
    }
  }

  if (violationCount === 0) {
    console.log(`check-migrations: OK — ${reports.length} ファイルすべて DDL のみ（${dir}）`);
    return 0;
  }
  console.log(
    `check-migrations: ${violationCount} 件の DML を検出（${flaggedFileCount}/${reports.length} ファイル、${dir}）。` +
      ' migration にデータを入れず supabase/seeds/production または seeds/demo へ移してください（AGENTS.md R12）。',
  );
  return 1;
};

/** `node scripts/db/check-migrations.ts` として直接実行されたときだけ CLI を動かす（import 時は何もしない） */
const isDirectRun = (): boolean => {
  const entry = process.argv[1];
  if (!entry) {
    return false;
  }
  try {
    return realpathSync(path.resolve(entry)) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
};

if (isDirectRun()) {
  process.exitCode = main(process.argv.slice(2));
}
