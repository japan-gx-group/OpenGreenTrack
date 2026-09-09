export interface ProviderOptionRow {
  providerName: string | null | undefined;
  providerNumber: string | null | undefined;
}

export interface ProviderOption {
  value: string;
  label: string;
  /** 検索用。ラベルの装飾文字（「事業者コード:」など）を含めず、事業者名と登録番号だけを並べる。 */
  searchText: string;
}

/**
 * 事業者名の突き合わせキー。前後の空白ゆらぎで選択肢が重複したり、
 * 選択後にメニュー候補と一致しなくなったりするのを防ぐ。
 * 選択肢の value とメニュー絞り込みの両方でこの関数を通すこと。
 */
export const normalizeProviderName = (providerName: string | null | undefined): string =>
  providerName?.trim() ?? '';

/** 同名の事業者に複数の登録番号がある場合の、ラベル上の区切り。 */
const CODE_SEPARATOR = ' / ';

/**
 * 供給事業者別係数の行を、手動入力フォームの検索可能な選択肢へ変換する。
 * 同じ事業者名の行は 1 件へまとめ、初出順を維持する。番号は初出行に無くても
 * 後続行から補完する。同名で番号が食い違う行がある場合はどれか 1 つに決められないため、
 * 全ての番号をラベルに並べて「この選択肢が複数の登録番号を束ねている」ことを明示する。
 */
export const buildProviderOptions = (factors: readonly ProviderOptionRow[]): ProviderOption[] => {
  // Map の挿入順がそのまま初出順になる。値は初出順に並べた登録番号（重複なし）。
  const codesByProviderName = new Map<string, string[]>();

  for (const factor of factors) {
    const providerName = normalizeProviderName(factor.providerName);
    if (!providerName) {
      continue;
    }

    const code = factor.providerNumber?.trim() ?? '';
    const codes = codesByProviderName.get(providerName);

    if (codes === undefined) {
      codesByProviderName.set(providerName, code ? [code] : []);
      continue;
    }
    if (code && !codes.includes(code)) {
      codes.push(code);
    }
  }

  return [...codesByProviderName].map(([providerName, codes]) => ({
    value: providerName,
    label:
      codes.length > 0
        ? `${providerName}（事業者コード: ${codes.join(CODE_SEPARATOR)}）`
        : providerName,
    searchText: [providerName, ...codes].join(' '),
  }));
};
