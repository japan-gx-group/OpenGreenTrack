// 拠点の入力値バリデーション（純関数）。追加/編集フォーム（Locations.client.tsx）と
// CSVインポート（locationCsvImport.ts）で同じ上限・同じ文言を使うためにここへ集約する。
// 上限は locations.name / locations."managerName" の varchar(100) に合わせる
// （超えると DB エラー（汎用トースト）になるため、入力段階で弾く）。

export const LOCATION_NAME_MAX_LENGTH = 100;
export const LOCATION_PERSON_MAX_LENGTH = 100;

export const LOCATION_NAME_REQUIRED_MESSAGE = '拠点名が空欄です';
export const LOCATION_NAME_TOO_LONG_MESSAGE = `拠点名は${LOCATION_NAME_MAX_LENGTH}文字以内で入力してください`;
export const LOCATION_PERSON_TOO_LONG_MESSAGE = `担当者は${LOCATION_PERSON_MAX_LENGTH}文字以内で入力してください`;

/**
 * 拠点名・担当者の検証。渡す値は trim 済みを前提とする（CSV は列ごとに、フォームは保存時に trim する）。
 * 問題が無ければ空配列。複数の問題は CSV の行エラーとしてまとめて出せるよう全件返す。
 */
export const validateLocationNameAndPerson = (name: string, person: string): string[] => {
  const reasons: string[] = [];
  if (!name) reasons.push(LOCATION_NAME_REQUIRED_MESSAGE);
  if (name.length > LOCATION_NAME_MAX_LENGTH) reasons.push(LOCATION_NAME_TOO_LONG_MESSAGE);
  if (person.length > LOCATION_PERSON_MAX_LENGTH) reasons.push(LOCATION_PERSON_TOO_LONG_MESSAGE);
  return reasons;
};
