// Server Action の戻り値の共通型。例外を投げず、成否を値で返して画面側で扱いやすくする。
// features/auth と features/settings の Server Action が共有するため、全体共有の型として置く。
export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string };
