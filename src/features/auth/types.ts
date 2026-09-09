// 認証機能（初回登録ウィザード / 招待リンク）で使う型。
// Server Action ファイル（'use server'）は「async 関数のみ」しか export できないため、
// 型はこの通常モジュールに分離して置く。
//
// LocationType / Region は本来アプリ全体で共有するドメイン値だが、現時点では
// LocationType の正本が features/locations にある（型集約は #8 の課題）。
// 重複定義してenum値がドリフトするより、現在の単一定義元から import する方が安全。
import type { Region } from '@/types/region';
import type { LocationType } from '@/features/locations/types';

// 初回登録ウィザード「③拠点の初期登録」で1拠点あたり入力する最小項目。
export interface InitialLocationInput {
  name: string;
  region: Region;
  type: LocationType;
}

// 初期セットアップ（/signup）を実行してよいかの判定結果。
//
// 'unknown' を 'completed' と分けているのは運用のため。判定に失敗した場合も
// 「実行させない」点は 'completed' と同じだが、原因が全く違う:
//   - 'completed' … 正常。もうセットアップ済みなのでログインすればよい
//   - 'unknown'   … 異常。Supabase に繋がらない / SUPABASE_SERVICE_ROLE_KEY が未設定など
// これを同じ扱いにすると、新規環境の構築時に「設定ミスで繋がっていないだけ」なのに
// 「セットアップ済みです」と案内され、原因に辿り着けなくなる。
export type SetupState = 'pending' | 'completed' | 'unknown';

// 初回登録ウィザードが最終的にサーバへ渡す入力一式。
export interface SignupInput {
  fullName: string;
  email: string;
  password: string;
  organizationName: string;
  locations: InitialLocationInput[];
}

// 招待リンクの受け取り側（/invite/[token]）でユーザーが入力する項目。
export interface AcceptInviteInput {
  token: string;
  fullName: string;
  password: string;
}

// 招待画面に表示する情報（メール・組織名は改変不可なので読み取り専用で見せる）。
// 権限は扱わない（ロール判定は無効）。
export interface InviteInfo {
  email: string;
  organizationName: string;
}

// Server Action の戻り値。例外を投げず、成否を値で返して画面側で扱いやすくする。
// （features/settings の Server Action とも共有するため、共有型へ移動して再エクスポート）
export type { ActionResult } from '@/types/actionResult';
