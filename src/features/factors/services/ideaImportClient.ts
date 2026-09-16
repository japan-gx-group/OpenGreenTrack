// IDEAデータベースカード（係数管理画面）用のクライアントサービス。
// 取込状況の取得は RLS（idea_imports の自組織 SELECT ポリシー）に任せてブラウザから直接
// SELECT し、書き込み（取込開始・削除）は Route Handler（/api/idea-imports）経由で行う
// （idea_* テーブルは authenticated に書き込み GRANT が無い。設計書 §3.2）。
//
// 取込開始は 3 段階: ① 署名付きアップロード URL の発行（/api/idea-imports/upload-url）→
// ② ブラウザから Supabase Storage（upload-quarantine）へ直接アップロード →
// ③ パスだけを /api/idea-imports へ渡して取込を開始。ファイル本体を API に送らないため、
// リクエストボディ制限のあるホスティング（Vercel の 4.5MB 等）でも数十MBの xlsx を取り込める。

import { createClient } from '@/lib/supabase/client';

export type IdeaImportStatus = 'processing' | 'completed' | 'failed';

export interface IdeaImportRecord {
  id: string;
  version: string;
  releaseDate: string | null;
  gwpModel: string;
  citationText: string;
  fileName: string;
  status: IdeaImportStatus;
  rowCount: number;
  isActive: boolean;
  /** 版更新で新版に同一コードが無く、製品の再選択が必要になった未算定明細の件数（§3.6-2） */
  unmappedRecordCount: number;
  /** GWP値が空欄のため取込対象外にした行数（LCIA結果を持たない製品。エラーではない。§4.1-4） */
  skippedRowCount: number;
  errorMessage: string | null;
  createdAt: string;
}

export interface IdeaImportOverview {
  /** 検索・新規紐付けの対象となっている active なインポート（null = 未取込） */
  active: IdeaImportRecord | null;
  /** 直近のインポート（取込中の進捗・失敗理由・版更新警告の表示用） */
  latest: IdeaImportRecord | null;
}

const IDEA_IMPORT_SELECT =
  'id, version, releaseDate, gwpModel, citationText, fileName, status, rowCount, isActive, unmappedRecordCount, skippedRowCount, errorMessage, createdAt';

/** 取込状況の取得（カード表示・取込中ポーリングの両方で使う）。 */
export const fetchIdeaImportOverview = async (): Promise<IdeaImportOverview> => {
  const supabase = createClient();
  // active は組織内高々1件（部分一意インデックス idea_imports_one_active_per_org）なので
  // 専用クエリで取得する。「直近N件から探す」方式だと、失敗履歴が N 件を超えて蓄積した時点で
  // active 行がウィンドウ外に落ち、取込済みなのに未取込表示になるため不可（§5.2）。
  const [activeResult, latestResult] = await Promise.all([
    supabase
      .from('idea_imports')
      .select(IDEA_IMPORT_SELECT)
      .eq('isActive', true)
      .maybeSingle(),
    supabase
      .from('idea_imports')
      .select(IDEA_IMPORT_SELECT)
      .order('createdAt', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (activeResult.error || latestResult.error) {
    throw new Error('IDEAデータベースの取込状況の取得に失敗しました');
  }

  return {
    active: (activeResult.data as unknown as IdeaImportRecord | null) ?? null,
    latest: (latestResult.data as unknown as IdeaImportRecord | null) ?? null,
  };
};

/** xlsx の MIME タイプ（Storage のオブジェクトメタデータ用。バケットは MIME を制限していない） */
const XLSX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** 取込開始の進行段階（画面の表示切替用） */
export type IdeaImportStartPhase = 'uploading' | 'starting';

/**
 * 署名付きアップロード URL を発行し、ブラウザから Storage へ直接アップロードする。
 * 戻り値は取込 API に渡す Storage パス。
 */
const uploadIdeaFileToStorage = async (file: File): Promise<string> => {
  const urlResponse = await fetch('/api/idea-imports/upload-url', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileName: file.name, fileSize: file.size }),
  });
  const urlBody = (await urlResponse.json().catch(() => null)) as
    | { bucket?: string; storagePath?: string; token?: string; error?: string }
    | null;
  if (!urlResponse.ok || !urlBody?.bucket || !urlBody.storagePath || !urlBody.token) {
    throw new Error(urlBody?.error ?? 'アップロード先の準備に失敗しました');
  }

  // 署名付きトークンでのアップロード。upload-quarantine にはブラウザ向けの insert ポリシーが無く、
  // トークン（service_role が発行）だけがこのパスへの書き込みを許可する。
  const supabase = createClient();
  const { error } = await supabase.storage
    .from(urlBody.bucket)
    .uploadToSignedUrl(urlBody.storagePath, urlBody.token, file, { contentType: XLSX_MIME_TYPE });
  if (error) {
    throw new Error('ファイルのアップロードに失敗しました。ネットワーク状態を確認して再度お試しください');
  }
  return urlBody.storagePath;
};

/**
 * 取込の開始。ファイルを Storage へ直接アップロードしてから取込 API を呼び、
 * 202 応答の importId を返す（進捗は fetchIdeaImportOverview でポーリング）。
 * onPhase は段階の切り替わり（アップロード中 → 取込開始中）を画面へ知らせる任意のコールバック。
 */
export const startIdeaImport = async (
  file: File,
  gwpModel: string,
  licenseConfirmed: boolean,
  onPhase?: (phase: IdeaImportStartPhase) => void,
): Promise<{ importId: string }> => {
  onPhase?.('uploading');
  const storagePath = await uploadIdeaFileToStorage(file);

  onPhase?.('starting');
  const response = await fetch('/api/idea-imports', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      storagePath,
      fileName: file.name,
      gwpModel,
      // サーバ側でも必須チェックされる（クライアントの値はあくまで利用者の確認操作の転記）
      licenseConfirmed,
    }),
  });
  const body = (await response.json().catch(() => null)) as
    | { importId?: string; error?: string }
    | null;
  if (!response.ok || !body?.importId) {
    throw new Error(body?.error ?? 'IDEAデータベースの取込開始に失敗しました');
  }
  return { importId: body.importId };
};

/** インポートの削除。算定結果から参照されている場合はサーバが 409 で拒否する（§3.6-4）。 */
export const deleteIdeaImport = async (importId: string): Promise<void> => {
  const response = await fetch(`/api/idea-imports/${encodeURIComponent(importId)}`, {
    method: 'DELETE',
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? 'IDEAデータベースの削除に失敗しました');
  }
};

/** レポート出典欄に載せる引用情報（算定に適用した版）。 */
export interface IdeaCitation {
  version: string;
  gwpModel: string;
  citationText: string;
}

/**
 * 対象期間の Scope3 積上げ算定結果が「実際に参照している」IDEA インポートの引用情報を返す。
 *
 * active な版を出典にしてはならない: 版更新（再インポート）で active は入れ替わるが、
 * 算定済みの `emission_results.ideaFactorId` は旧版を指したまま付け替えない
 * （設計書 §3.6-3。再マッピング対象は未算定の activity_records だけ）。active を引くと
 * 過年度レポートに、その算定では使っていない版・GWPモデルの出典が載る。
 *
 * 版は組織あたり数件のため、明細全行を引かずに版ごとの存在確認（limit 1）で判定する。
 * 版更新をまたいで算定した年度では複数版が返る。
 */
export const fetchIdeaCitationsForScope3 = async (params: {
  startDate: string;
  endDate: string;
  /** 積上げ算定（calculated）を採用しているカテゴリ。空なら出典は不要 */
  categoryIds: number[];
}): Promise<IdeaCitation[]> => {
  if (params.categoryIds.length === 0) return [];

  const supabase = createClient();
  const { data, error } = await supabase
    .from('idea_imports')
    .select('id, version, gwpModel, citationText')
    .eq('status', 'completed')
    .order('createdAt', { ascending: true });

  if (error) {
    throw new Error('IDEAデータベースの取込情報の取得に失敗しました');
  }

  const imports = (data ?? []) as unknown as (IdeaCitation & { id: string })[];

  const referenced = await Promise.all(
    imports.map(async row => {
      // 年度帰属は activity_records.periodStart 基準（scopeAnalysisService の積上げ集計・
      // refresh_dashboard_aggregates と同一）。カテゴリ絞り込みは、方式が direct のカテゴリ
      // （合計に採用されない算定結果）で出典が載るのを防ぐため。
      const { data: hit, error: hitError } = await supabase
        .from('emission_results')
        .select('id, idea_factors!inner(importId), activity_records!inner(periodStart)')
        .eq('scope', 'scope3')
        .in('categoryId', params.categoryIds)
        .eq('idea_factors.importId', row.id)
        .gte('activity_records.periodStart', params.startDate)
        .lte('activity_records.periodStart', params.endDate)
        .limit(1);

      if (hitError) {
        throw new Error('IDEAデータベースの取込情報の取得に失敗しました');
      }
      return (hit ?? []).length > 0 ? row : null;
    }),
  );

  return referenced
    .filter((row): row is IdeaCitation & { id: string } => row !== null)
    .map(({ version, gwpModel, citationText }) => ({ version, gwpModel, citationText }));
};
