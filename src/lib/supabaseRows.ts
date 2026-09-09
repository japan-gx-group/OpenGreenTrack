// Supabase（PostgREST）読み取りの共通対策ヘルパー。
// 複数機能のサービスに同一実装が重複していたため集約した。

// PostgREST の max_rows（supabase/config.toml で 1000）で黙って切り詰められるのを防ぐため、
// range() でページングしながら全行を取得する。
export const PAGE_SIZE = 1000;

export type PageResult<T> = { data: T[] | null; error: { message: string } | null };

export const fetchAllRows = async <T>(
  runPage: (from: number, to: number) => PromiseLike<PageResult<T>>,
  errorMessage: string,
): Promise<T[]> => {
  const allRows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await runPage(from, from + PAGE_SIZE - 1);
    if (error) {
      throw new Error(errorMessage);
    }
    const rows = data ?? [];
    allRows.push(...rows);
    if (rows.length < PAGE_SIZE) break;
  }
  return allRows;
};

// .in(...) に大量のIDを展開するとURLが 414 URI Too Long に達するため、IDリストを分割する。
export const IN_CHUNK_SIZE = 200;

export const chunk = <T>(items: T[], size: number): T[][] => {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
};
