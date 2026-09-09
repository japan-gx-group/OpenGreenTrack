// 公式排出係数の公表資料（pdftotext -layout で抽出したテキスト / 手書きTSV）のパーサ。
// 純関数のみ。I/O とSQL生成は generate.ts が担う。
//
// 電気事業者別排出係数（denki.txt）のレイアウト前提:
//   - 表は「登録番号 事業者名 メニュー名 基礎 調整後 把握率 理由」の列構成。
//   - 事業者名はブロック（事業者のメニュー行群）の縦中央の行に印字されるため、
//     登録番号行の前後にメニュー行が「孤児行」として現れる。
//   - 複数メニューを持つ事業者のブロックは必ず「(参考値)事業者全体」行で終わる。
//     これをブロック終端とみなし、終端後の孤児行は次の事業者に帰属させる。
//   - 単一行の事業者は登録番号行にメニュー名なしで係数が載る（それで完結）。
//   この前提が崩れた場合は黙って誤帰属せず、例外を投げて生成を中止する。

export interface ProviderFactorRow {
  providerNumber: string;
  providerName: string;
  /** メニュー名・供給区域・地区名。単一行事業者は null */
  menuName: string | null;
  basic: number | null;
  adjusted: number | null;
}

const MENU_RE = /メニュー[A-Z](?:\(残差\)|（残差）)?|\(参考値\)事業者全体|（参考値）事業者全体/;
const VALUE_RE = /\d\.\d{6}(?:※)?/g;
const REG_RE = /^([A-Z]\d{4})\s+(.+)$/;

interface DenkiLineRow {
  menuName: string | null;
  basic: number | null;
  adjusted: number | null;
}

const parseValues = (line: string): number[] =>
  [...line.matchAll(VALUE_RE)].map((m) => Number(m[0].replace('※', '')));

const parseLineRow = (line: string): DenkiLineRow | null => {
  const menu = line.match(MENU_RE)?.[0] ?? null;
  const values = parseValues(line);
  if (!menu && values.length === 0) {
    return null;
  }
  return {
    menuName: menu,
    basic: values[0] ?? null,
    adjusted: values[1] ?? null,
  };
};

interface DenkiEntity {
  providerNumber: string;
  providerName: string;
  rows: DenkiLineRow[];
  /** 登録番号行にメニュー名なしの係数が載った「単一行事業者」として完結したか */
  singleInline: boolean;
}

const isComplete = (entity: DenkiEntity): boolean =>
  entity.singleInline || entity.rows.some((r) => r.menuName?.includes('参考値') ?? false);

export interface DenkiParseResult {
  retailers: ProviderFactorRow[];
  gridOperators: ProviderFactorRow[];
  /** 代替値（t-CO2/kWh） */
  substituteValue: number;
  retailerCount: number;
}

export const parseDenki = (text: string): DenkiParseResult => {
  const lines = text.split('\n');

  const entities: DenkiEntity[] = [];
  let current: DenkiEntity | null = null;
  let pending: DenkiLineRow[] = [];

  const finalize = (next: string) => {
    if (current && !isComplete(current)) {
      // メニュー行を持つのに (参考値) 終端が無いままブロックが切り替わった＝前提崩れ。
      if (current.rows.some((r) => r.menuName !== null)) {
        throw new Error(
          `電気: ${current.providerNumber} ${current.providerName} のブロックが「(参考値)事業者全体」で終端せずに ${next} に到達しました`,
        );
      }
    }
  };

  let section: 'retail' | 'grid' | 'done' = 'retail';
  const gridOperators: ProviderFactorRow[] = [];
  let substituteValue: number | null = null;

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (section === 'retail' && line.includes('【一般送配電事業者】')) {
      finalize('【一般送配電事業者】');
      if (current) entities.push(current);
      current = null;
      section = 'grid';
      continue;
    }
    if (section === 'grid') {
      const sub = line.match(/代替値\s+(\d\.\d{6})/);
      if (sub) {
        substituteValue = Number(sub[1]);
        section = 'done';
        continue;
      }
      const grid = line.match(/^\s*(\d{1,2})\s+(\S+)\s{2,}(\d\.\d{6})\s+(\d\.\d{6})/);
      if (grid) {
        gridOperators.push({
          providerNumber: grid[1],
          providerName: grid[2],
          menuName: null,
          basic: Number(grid[3]),
          adjusted: Number(grid[4]),
        });
      }
      continue;
    }
    if (section === 'done') {
      continue;
    }

    const reg = line.match(REG_RE);
    if (reg) {
      finalize(`次の事業者 ${reg[1]}`);
      if (current) entities.push(current);

      const rest = reg[2];
      // 事業者名列とメニュー/係数列は3スペース以上の空白で区切られる。
      const providerName = rest.split(/\s{3,}/)[0].trim().replace(/\s+-$/, '');
      current = {
        providerNumber: reg[1],
        providerName,
        rows: [...pending],
        singleInline: false,
      };
      pending = [];

      const row = parseLineRow(rest.slice(providerName.length));
      if (row) {
        current.rows.push(row);
        // メニュー名なしで係数が載り、他にメニュー行が無ければ単一行事業者として完結。
        if (row.menuName === null && current.rows.length === 1 && row.basic !== null) {
          current.singleInline = true;
        }
      }
      continue;
    }

    const row = parseLineRow(line);
    if (!row) {
      continue; // 表ヘッダ・注記・理由テキストの折返しなど
    }
    if (current && !isComplete(current)) {
      current.rows.push(row);
    } else {
      pending.push(row);
    }
  }
  if (current) {
    finalize('ファイル末尾');
    entities.push(current);
  }
  if (pending.length > 0) {
    throw new Error(`電気: どの事業者にも帰属しない孤児行が ${pending.length} 件残りました`);
  }
  if (substituteValue === null) {
    throw new Error('電気: 代替値が見つかりませんでした');
  }

  const retailers: ProviderFactorRow[] = [];
  for (const entity of entities) {
    const menuNames = new Set<string>();
    for (const row of entity.rows) {
      if (row.basic === null && row.adjusted === null) {
        continue; // 係数欄が空の行（代替値のみの事業者など）は収録しない
      }
      if (row.menuName) {
        if (menuNames.has(row.menuName)) {
          throw new Error(
            `電気: ${entity.providerNumber} ${entity.providerName} でメニュー名が重複しました: ${row.menuName}（ブロック誤帰属の疑い）`,
          );
        }
        menuNames.add(row.menuName);
      }
      retailers.push({
        providerNumber: entity.providerNumber,
        providerName: entity.providerName,
        menuName: row.menuName,
        basic: row.basic,
        adjusted: row.adjusted,
      });
    }
  }

  return { retailers, gridOperators, substituteValue, retailerCount: entities.length };
};

/** ガス・熱の手書きTSV（登録番号 \t 事業者名 \t メニュー名 \t 基礎 \t 調整後）をパースする */
export const parseProviderTsv = (text: string): ProviderFactorRow[] =>
  text
    .split('\n')
    .filter((line) => line.trim() !== '' && !line.startsWith('#'))
    .map((line) => {
      const cols = line.split('\t');
      if (cols.length !== 5) {
        throw new Error(`TSVの列数が不正です（5列想定）: ${line}`);
      }
      return {
        providerNumber: cols[0],
        providerName: cols[1],
        menuName: cols[2] === '' ? null : cols[2],
        basic: Number(cols[3]),
        adjusted: Number(cols[4]),
      };
    });

export interface SimpleFactorRow {
  /**
   * 行の安定キー（小文字英数字と _ のみ、ファイル内で一意）。係数 ID の導出元なので、
   * 名称・値・出典を訂正しても変えない（変えると別の行になる）。
   */
  key: string;
  name: string;
  energyType: string;
  unit: string;
  value: number;
}

const SIMPLE_KEY_RE = /^[a-z][a-z0-9_]*$/;

/** 燃料・Scope3の手書きTSV（key \t 係数名 \t energyType \t 単位 \t 係数値）をパースする */
export const parseSimpleTsv = (text: string): SimpleFactorRow[] => {
  const seenKeys = new Set<string>();
  return text
    .split('\n')
    .filter((line) => line.trim() !== '' && !line.startsWith('#'))
    .map((line) => {
      const cols = line.split('\t');
      if (cols.length !== 5) {
        throw new Error(`TSVの列数が不正です（5列想定）: ${line}`);
      }
      const [key, name, energyType, unit, rawValue] = cols;
      if (!SIMPLE_KEY_RE.test(key)) {
        throw new Error(`key が不正です（小文字英数字と _ のみ）: ${line}`);
      }
      if (seenKeys.has(key)) {
        throw new Error(`key が重複しています: ${key}`);
      }
      seenKeys.add(key);
      const value = Number(rawValue);
      if (!Number.isFinite(value)) {
        throw new Error(`係数値が数値ではありません: ${line}`);
      }
      return { key, name, energyType, unit, value };
    });
};
