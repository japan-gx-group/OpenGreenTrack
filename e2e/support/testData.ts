// スモークテストが使う固定値。すべて supabase/seeds/demo/demo.sql のデモシードに対応する。
// デモシードを変更したときは、ここの前提コメントも合わせて確認すること。

import path from 'node:path';
import { fileURLToPath } from 'node:url';

// package.json が "type": "module" のため、このファイルは ESM として読み込まれる（__dirname は使えない）。
const supportDir = path.dirname(fileURLToPath(import.meta.url));

/**
 * ログイン済みセッションの保存先（auth.setup.ts が書き、smoke プロジェクトが読む）。
 * 相対パスにすると実行時の CWD 次第で別の場所を指すため、このファイルの位置から絶対パスで解決する。
 */
export const AUTH_STATE_PATH = path.resolve(supportDir, '../.auth/user.json');

/** seed が作るデモ組織（架空精密工業株式会社）の管理者ユーザー。 */
export const TEST_USER = {
  email: 'org-a@example.com',
  password: 'password123',
} as const;

/**
 * 手動入力に使う拠点。
 * seed のデモ組織配下・status='active' の拠点で、後述の対象年月に既存レコードが無いものを選ぶ。
 * 大阪支社は seed 上「2025年度から算定対象に加わった」設定で、2024年度以前のレコードを持たない。
 */
export const TEST_LOCATION_NAME = '大阪支社';

/** 手動入力のカテゴリ（MANUAL_ACTIVITY_CATEGORY_MAP.electricity.labelJP と一致させる）。 */
export const TEST_CATEGORY_LABEL = '電気';

/**
 * 対象年月に 2024年度（2024-04〜2025-03）を使う理由:
 *   - 係数解決は applicableYear の完全一致 + status='active' が条件（resolveEmissionFactor）。
 *     2024年度は公式排出係数マスタ（seeds/production、2025・2026年度のみ収録）の範囲外なので、
 *     active な電気の係数は seed がデモ組織に登録した「電気 代替値（全国）2024年度」の 1 件だけになり、
 *     production seed の有無に関わらず算定結果が一意に決まる。
 *   - activity_records は (拠点, 種別, 対象月) が重複扱いになる。seed は大阪支社に 2024年度のレコードを
 *     作らないので、11月/12月/翌1月は空いている（他の稼働中拠点は毎月レコードを持つ）。
 */
export const SAVE_TARGET_MONTH = '2024-11';
/**
 * ダッシュボード反映のテストは2件保存する。
 * 算定は年度の集計（dashboard_aggregates）を「実データから絶対値で再計算」する仕組みのため、
 * 集計行が過去のテスト実行の影響で実データとずれていることがある。1件目の保存でずれを解消し、
 * その状態を基準値にしてから2件目を保存すると、増分が算定結果ぴったりになる。
 */
export const DASHBOARD_BASELINE_MONTH = '2024-12';
export const DASHBOARD_TARGET_MONTH = '2025-01';
/**
 * ダッシュボードで切り替える年度。
 * 年度セレクタの既定は最新年度（seed では 2026年度）なので、ここは「既定とは別の年度」になっている。seed の年度構成を変えるときは、この値が既定年度と
 * 一致しないことを確認すること（一致していても selectFiscalYear は素通りするが、
 * 「年度を切り替えても正しい数値が出るか」という検証の意味は失われる）。
 */
export const TEST_FISCAL_YEAR_LABEL = '2024年度';

/**
 * 1回の実行で走る算定バッチの本数（= 手動入力の保存回数）。レート制限の待ち合わせに使う。
 *
 * 内訳: smoke.spec.ts の「手動入力で保存」1件 + 「ダッシュボード反映」2件。
 * 保存を伴うテストを増減したときは、この値も必ず合わせること（少なく見積もると
 * 実行の途中で算定APIに弾かれ、原因の分かりにくい失敗になる）。
 */
export const CALCULATION_RUNS_PER_SUITE = 3;

/**
 * 「保存 → 自動算定の完了トースト」を待つ上限。算定APIの実測（数秒）に対して十分な余裕を取る。
 * テスト側のタイムアウト（smoke.spec.ts）はこの値から逆算するので、変えるときは片方だけにしない。
 */
export const SAVE_AND_CALCULATE_TIMEOUT_MS = 60_000;

/** 算定結果がダッシュボードの総排出量に反映されるまで待つ上限。 */
export const DASHBOARD_REFLECTION_TIMEOUT_MS = 30_000;

/** 活動量（kWh）。 */
export const TEST_AMOUNT_KWH = 10000;

/** 「電気 代替値（全国）2024年度」= 0.000434 t-CO2/kWh で算定される想定の排出量（t-CO2e）。 */
export const EXPECTED_EMISSIONS_T_CO2E = TEST_AMOUNT_KWH * 0.000434;

/**
 * テストが作ったレコードの目印。備考（activity_records.note）に入れておき、
 * global-setup / global-teardown がこの文字列で検索して削除する。
 */
export const E2E_NOTE_MARKER = '[e2e-smoke] Playwrightスモークテストが作成したデータ';

/** 入力履歴のキーワード検索で目印の行だけを絞り込むための語（備考に含まれる）。 */
export const E2E_SEARCH_KEYWORD = 'e2e-smoke';

/**
 * 入力履歴の「対象期間」列に出る開始日の表記（例: '2024-11' → '2024/11/01'）。
 * DataInput の toHistoryPeriod と同じ整形。テストが自分の保存した行だけを特定するために使う。
 */
export const toHistoryPeriodStart = (targetMonth: string): string =>
  `${targetMonth.replace('-', '/')}/01`;
