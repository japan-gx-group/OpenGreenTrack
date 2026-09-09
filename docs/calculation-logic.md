# GHG自動算定ロジック仕様書

本書は OpenGreenTrack の GHG 自動算定エンジンの算定式・係数選択ルール・単位換算・集計方針をまとめた正本である。実装は `src/features/calculation/` にある。

- 純粋な計算コア（副作用なし・テスト対象）: `src/features/calculation/engine/`
- I/O を伴うサービス層: `src/features/calculation/services/calculationService.ts`
- 実行トリガー: `POST /api/calculations`（`src/app/api/calculations/route.ts`）

関連仕様: `docs/functional-spec.md §5.5, §7` / `docs/database-design.md §4.1`

---

## 1. 算定式

```
排出量(t-CO2e) = 活動量 × 排出係数
```

例: 電気 1000 kWh × 0.000438 t-CO2e/kWh = 0.438 t-CO2e

- 活動量: `activity_records.amount`（`numeric(15,3)`）
- 排出係数: `emission_factors.factorValue`（`numeric(12,6)`）。IDEA 由来の係数は専用テーブル `idea_factors.gwpValue`（無制約 numeric。原典精度を保持）
- 排出量: `emission_results.emissions`（`numeric(15,6)`）。**小数第6位（1g 粒度 = 10^-6 t）に丸める**（`roundEmissions`）。
  Scope3 積上げ算定の小口明細が 1kg 丸めでゼロ落ちして系統的過小計上になるのを防ぐための拡張で
  （`idea-scope3-spec.md §3.4`）、**画面・レポートの表示丸めは従来どおり小数第3位**。
  `dashboard_aggregates` の scope1/2/3Total と `scope3_category_emissions.emissions` は
  `numeric(15,3)` のまま意図的に据え置く（合計値の 1kg 丸めは実用上無害）。

実装: `engine/computeEmissions.ts` の `computeEmissions(records, factors, options)`。純関数で、各レコードにつき「係数解決 → 単位換算 → 乗算 → 丸め」を行い、`{ results, unresolved }` を返す。

---

## 2. 係数選択（解決）ルール

活動量レコードに適用する排出係数を、以下の**前提フィルタ**で候補を絞ったうえで、**優先順位**の高い順に最初にヒットしたものを採用する。

実装: `engine/resolveEmissionFactor.ts` の `resolveEmissionFactor(record, factors, context)`。

### 前提フィルタ（すべて満たすものだけ候補）
- `energyType` が活動量と一致
- `applicableYear` が **「組織の会計年度の開始年」または「`periodStart` の温対法年度（4月〜翌3月。1〜3月は前年度扱い ＝ `deriveApplicableYear`）」のどちらか** に一致（`applicableYearsForRecord`）。対象年度の公式係数が未公表の `energyType` に限り、直近の過年度も許容する（後述「未公表年度の暫定適用」）
- `status = 'active'`
- 有効期間内（`effectiveFrom`/`effectiveTo`。`null` は開区間）。暫定適用した過年度の係数は `effectiveTo` が過年度末を指すため、この判定を行わない

#### 適用年度の二本立て（非4月始まりの会計年度対応）
公式係数（`scripts/official-factors/generate.ts` が生成）は温対法年度単位で `effectiveFrom = <年>-04-01 / effectiveTo = <年+1>-03-31` を持つ。一方、組織の会計年度は 1〜12 月のどの月からでも始められ（`organizations.fiscalYearStartMonth`）、画面登録のカスタム係数は有効期間を持たず「会計年度の開始年」を `applicableYear` として登録される。

- 会計年度の開始年 **だけ** で突き合わせると、7月始まり FY2025（2025-07-01〜2026-06-30）の 2026年4〜6月のレコードは 2025年度の公式係数が有効期間外になり `FACTOR_NOT_FOUND` になる。
- `periodStart` の温対法年度 **だけ** で突き合わせると、有効期間なしのカスタム係数が年度境界で外れる。

そのため係数解決コンテキストの `applicableYear` は会計年度の開始年のまま（IDEA 係数の正規化など他の呼び出し側もこの意味で使う）とし、前提フィルタでは温対法年度側も許容する。有効期間チェックは従来どおり別途行うので、4月始まりの組織では動作は変わらない。

- 算定バッチの係数取得: `applicableYearsForFiscalYear(startDate, endDate)`（開始年・開始日の温対法年度・終了日の温対法年度の集合）で `applicableYear in (...)` を引く。
- 入力フォームのプレビュー: 標準係数は `applicableYearsForRecord(periodStart, 会計年度の開始年)`、供給事業者別係数は `deriveApplicableYear(periodStart)`（公式係数のため温対法年度）で取得する。同じ純関数で解決するため、プレビューと算定バッチは同じ係数を選ぶ。
- どちらの取得も `withProvisionalYears` でフォールバック年度を足した範囲を引く（どの年度を実際に適用するかの判定は純粋コアに委ねる）。
- 公式係数は年度ごとに同内容の行が生成されるため、対象年度が公表済みの通常運用では供給事業者別係数が 2 年分届く。入力フォームは取得した行を `filterApplicableFactors`（前提フィルタと同じ判定）で「このレコードで採用し得る行」に絞ってから事業者・メニューの選択肢を組む（`listApplicableProviderFactors`）。絞らずに並べると同じ事業者・同じメニューが年度違いで重複し、過年度側を選ぶと明示指定が前提フィルタを通らず自動解決へ落ちる。

#### 未公表年度の暫定適用

公式係数は年度が始まってから数ヶ月遅れて公表される。対象年度の係数が DB に無い間、その `energyType` の活動量は `FACTOR_NOT_FOUND` になり、公表まで算定できない。

これを避けるため、**その `energyType` の公式係数が対象年度に 1 件も存在しない場合に限り**、直近の過年度（`PROVISIONAL_FALLBACK_YEARS = 1` 年前まで）を前提フィルタの許容年度に **追加** し、その年度に限って有効期間チェックを免除する（`effectiveYearsFor`）。

- ここでの「対象年度」は **`periodStart` の温対法年度（`deriveApplicableYear`）だけ** を指す（会計年度の開始年との交差では見ない）。公式係数の有効期間は温対法年度で切られているため、ある月を有効期間でカバーできるのは同じ温対法年度の係数だけで、会計年度の開始年の係数が別に公表されていてもその月は算定できないため。開始年との交差で判定すると、非4月始まりの会計年度が温対法年度をまたいだ後の月（例: 7月始まり FY2025 の 2026年4〜6月）が「公表済み」と誤判定され、暫定適用が発動しないまま正式係数の公表まで未算定になる。
- またいだ後の月は基準年度が `{会計年度の開始年, 温対法年度}` の 2 年になり、暫定適用する開始年側は「許容年度としてはもともと通るが、有効期間で弾かれる」状態にある。そのため有効期間チェックの免除は「基準年度に無い年度か」ではなく、`effectiveYearsFor` が返す `provisionalYear` との一致で判定する。

- 年度を「選び直す」のではなく「足すだけ」にしている。この前提フィルタは自動解決と明示指定の両方が通るため、年度を差し替えると「いま解決できている係数が候補から外れる」経路ができてしまう。足すだけなら増えるのは下位優先度の候補だけで、勝者・曖昧判定（`isAmbiguousChoice`）・単位不一致判定はいずれも最上位優先度の中だけを見るため結果が変わらない。
- **カスタム係数は暫定適用しない**（年度完全一致のみ）。組織が年度ごとに登録するもので、前年度の値を黙って流用すると「登録をやめた」意図と区別できないため。「公表済みか」の判定にもカスタム係数は数えない。
- 1 年より古い係数は使わず未算定のまま残す。根拠として説明できない値で算定するより、未算定として件数を出すほうが安全（未算定はデータ入力画面とレポートの「データ充足状況」に出る）。
- 暫定適用中は入力フォームの係数詳細に「〈年度〉年度の係数を暫定適用」バッジと理由を表示する（`isProvisionalFactor`）。新しい年度の係数を登録すれば前提フィルタが対象年度で満たされ、暫定適用は自動的に止まる（表示の消し忘れが起きない）。

##### 公表後の再算定（暫定適用の後始末）

暫定適用が止まるのは**これから算定するレコード**だけで、**暫定適用で算定済みの結果は古い係数のまま残る**（算定バッチは `isCalculated = false` のレコードしか処理しない）。バッジも消えるため画面上は「正式値で運用中」に見え、ダッシュボード・レポートに旧年度係数ベースの排出量が混ざったままになる。

そのため算定済み側にも後始末の導線を持つ（`src/features/calculation/services/provisionalRecalculation.ts`）。

- 検出: `emission_results` の適用係数と活動量を突き合わせ、「算定時に暫定適用だった（`isProvisionalFactor`）」かつ「いまはその `energyType` の公式係数がレコードの温対法年度に存在する」レコードを洗い出す（`isSupersededProvisionalFactor`。判定は `effectiveYearsFor` と対になっており、片方だけ直すと検知漏れになる）
- 絞り込み: 暫定適用された係数は必ず `applicableYear < レコードの温対法年度` になり、会計年度に含まれる温対法年度の最大値は終了日の温対法年度なので、`applicableYear < deriveApplicableYear(endDate)` が候補の上位集合になる。この条件と `isCustom = false` を PostgREST の埋め込みフィルタで DB 側に押し込み、通常運用（暫定適用なし）では 0 行しか返らないようにしている（4月始まりの会計年度では終了日の温対法年度＝会計年度の開始年なので絞り込みの強さは変わらない）
- 差し戻し: 対象レコードを `isCalculated = false` に戻す。旧 `emission_results` はトリガー `clear_emission_results_on_recalculation` が同一トランザクションで削除するため二重計上は起きない。差し戻し後の算定は通常どおり `POST /api/calculations`（レート制限・自動再試行つき）が行う
- 画面: データ入力画面の入力履歴に対象年度と件数のバナーと「正式係数で再算定」ボタンを出す（機能仕様 §4.2.3）
- 運用: 係数の年度更新時は seed 再投入後にこの再算定まで行う（[`scripts/official-factors/README.md`](../scripts/official-factors/README.md) の「年度更新の手順」）

### 優先順位（DB設計書 §4.1 の5段階を正とする）
```
1. 拠点固有カスタム   (locationId = 対象拠点 かつ isCustom = true)
2. サプライヤー固有   (supplierId 一致 かつ isCustom = true)   ※後述の通り Phase1 では実質スキップ
3. 組織全体カスタム   (isCustom = true かつ locationId = null かつ supplierId = null)
4. 地域一致の標準係数 (isCustom = false かつ regionName = 拠点の地域名)
5. 全国平均の標準係数 (isCustom = false かつ regionName = '全国')
```

**事業者別係数（`providerName` が非null。電気・ガス・熱の供給事業者別排出係数）は自動解決の対象外**（`tierOf` が Infinity を返す）。数百事業者×メニューが候補に並ぶのを防ぐためで、手動入力画面での明示選択（`activity_records.emissionFactorId`）専用とする。明示指定は前提フィルタを満たす限り候補リスト外でも採用される（下記「明示指定」）。契約先を選ばなかった場合のフォールバックは、`providerName` なしで登録された**代替値**（全国標準 tier5）が受ける。

### 明示指定（emissionFactorId）
活動量レコードに `emissionFactorId` の明示指定がある場合、**前提フィルタを満たせば優先順位に関係なく最優先で採用**する（事業者別係数もここで使われる）。明示指定した公式係数も暫定適用の対象で、対象年度が未公表の間は選択した過年度の行がそのまま使われる。

前提フィルタを満たさなくなった場合（アーカイブ済み・対象年度の公表で暫定適用が解消された等）は、次の順に解決する。`resolveEmissionFactorDetailed` はどう決まったかを `kind` で返し、指定どおりに使われなかったことを呼び出し側へ必ず伝える。

| 状況 | 適用する係数 | `kind` | `requestedFactorId` |
| --- | --- | --- | --- |
| 明示指定がそのまま使える | 指定された係数 | `explicit` | null |
| 事業者別係数が年度更新で外れた | **同一事業者・同一メニュー・同一 factorType の当年度行**へ読み替え（`remapProviderFactor`） | `explicit_remapped` | 指定された係数ID |
| 読み替え先も無い（アーカイブ済み・標準係数の年度不一致等） | 優先順位による自動解決 | `explicit_fallback` | 指定された係数ID |
| 明示指定なし | 優先順位による自動解決 | `auto` | null |

読み替えを設けている理由: 事業者別係数は自動解決の候補外（tier = Infinity）のため、そのまま自動解決へ落とすと契約先の実係数から**全国の代替値へ黙って置き換わる**。値の差が大きく報告根拠として説明できないため、まず同一事業者の当年度行を探す。同名の別事業者を取り違えないよう、双方に `providerNumber` があるときは一致も要求する。読み替えは**年度をまたぐ場合のみ**行う（同一年度内の別行へは移さない。Scope3 の IDEA 正規化行が相互にマッチする経路を作らないための多層防御でもある。`docs/idea-scope3-spec.md §4.3-2`）。読み替え先が複数残るときは、自動解決と同じタイブレーク（`applicableYear` が会計年度の開始年と一致する行を優先 → id 昇順）で選ぶ。非4月始まりの会計年度では前提フィルタが 2 年度を許容するため、有効期間なしのカスタム事業者係数は複数年度ぶん残り得る。

`explicit_remapped` / `explicit_fallback` になったレコードは算定自体は成立するため `unresolved` には載らないが、`CalculationOutcome.warnings`（`CalculationWarning`。理由 `EXPLICIT_FACTOR_REMAPPED` / `EXPLICIT_FACTOR_FALLBACK`・指定された係数ID・実際に使った係数ID）に載せ、算定バッチのサマリ（`warnings`）経由でデータ入力画面のトーストに「N件は選択した排出係数を適用できなかったため、別の係数で算定しました」と表示する。入力フォームで該当レコードを開くと、読み替えなら「同じ供給事業者・メニューの現在の係数で再計算されます」、フォールバックなら「自動選択された係数で再計算されます」と、適用される係数とともに表示する（`resolveAppliedFactor` の `remapped` / `fellBack`）。

### タイブレーク（同一優先度に複数該当した場合）
1. `factorType = 'adjusted'`（**調整後排出係数**）の係数を優先する（温対法の報告実務では調整後を用いるのが通例。機能仕様 §7.3）。
2. `applicableYear` が会計年度の開始年と一致する係数を優先する（非4月始まりの組織が年度ごとに登録した有効期間なしのカスタム係数が、年度境界の月で翌年度分と同時にヒットしたとき、組織の会計年度に属する側を採る）。
3. `id` 昇順（DB の行返却順に依存しない再現性のため）。

### 曖昧な候補（`FACTOR_AMBIGUOUS`）
明示指定が使えず自動解決になったとき、**候補先頭と同じ優先度・同じタイブレーク順位の候補が複数あり、かつ名称が異なる**場合は当てずっぽうにせず未算定にする（`isAmbiguousChoice`）。例: `fuel_heavy_oil` の「A重油」「B・C重油」、`fuel_coal` の炭種 6 種、`fuel` の 17 種、`waste` の焼却・埋立 12 種。どれが正しいかはレコードの内容でしか決まらないため、`unresolved`（理由 `FACTOR_AMBIGUOUS`）として返し、入力フォームで係数を選択して保存し直すよう案内する。

- 名称まで同じ候補（同名の重複登録）は id 順で決めても結果が変わらないので曖昧扱いしない。
- 全国の電気・都市ガス・熱の代替値（`providerName` なし・`regionName = '全国'`）は各 1 行のため、この判定で外れることはない。
- 入力フォームは常にプレビューで表示した候補の id（`resolveFactorIdToSave`）を `emissionFactorId` として保存するため、通常の手入力はこの判定に当たらない。当たるのは係数指定なしの取込レコードや、保存後に係数がアーカイブされたレコード。

### 単位互換（`UNIT_MISMATCH`）
自動解決では、優先順位で並べた候補のうち**活動量レコードの `unit` から換算できる係数**（`resolveUnitConversion` が非 null）だけを採用対象にする。同じ優先度段階には単位の異なる係数が混在し得る（例: `fuel` の公式係数は `tCO2/t`・`tCO2/千m3`・`tCO2/kL` が同居）ため、先頭 1 件だけを試すと id 順という偶然で換算不能になる。

- 単位互換で見るのは**最上位の優先度段階の中だけ**。上位段階（拠点カスタム等）の係数がすべて換算不能でも、下位段階（全国標準等）の換算可能な係数へは落ちない（組織が意図して登録した係数を黙って別の係数に差し替えないため）。この場合は `unresolved`（理由 `UNIT_MISMATCH`。detail に弾いた係数の単位を列挙）とする。
- 曖昧判定（`FACTOR_AMBIGUOUS`）は換算可能な候補の中だけで行う。換算不能な別名の係数は曖昧の理由にならない。
- 明示指定（`emissionFactorId`）の係数は単位に関係なく採用し、換算できなければ `UNIT_MISMATCH` とする（他に換算可能な候補があっても差し替えない）。
- 入力フォームの候補一覧（`listFactorCandidates`）は単位で絞らない。フォームは換算できない係数を選んだとき係数側の分母単位で入力させる（`resolveEntryUnit`）ため、候補から外すと選べなくなる。フォームは常に候補の id を明示指定として保存するので、算定バッチの絞り込みで結果がずれることはない。

### 未解決
どの段階にも当たらなければ、そのレコードは**未算定のまま残し**、`unresolved`（理由 `FACTOR_NOT_FOUND`）として呼び出し側に返す。理由の一覧は `UnresolvedReason`（`FACTOR_NOT_FOUND` / `FACTOR_AMBIGUOUS` / `UNIT_MISMATCH` / `FACTOR_SCOPE_MISMATCH` / `SCOPE3_FACTOR_MISSING`）で、ユーザー向け文言は `UNRESOLVED_REASON_MESSAGES` にまとめている。

### 適用範囲の不整合（`FACTOR_SCOPE_MISMATCH`）
解決した係数の `scope` が、レコードの `energyType` から決まる Scope（`engine/energyTypeScope.ts`）と食い違うレコードは算定せず未算定に留める。§4 のとおり集計は結果の `scope` と `categoryId` で積むのに対し、レポートのデータ充足状況は `energyType` から Scope を判定するため、食い違う係数で算定すると同じ排出量が 2 つの基準で別々に数えられる（どの集計にも載らないまま「算定済み」と数えられる／載っているのに「採用されない」件数に入る）。係数フォーム・CSV 取込・保存直前の変換（`toMutationRow`）が Scope を種別から決めるため新たに作れないが、この検証より前に登録された係数のために算定側でも弾く。

### 優先順位の出自（設計判断の記録）
現在は `docs/functional-spec.md §7.3` と `docs/database-design.md §4.1` がどちらも上記の 5 段階＋同一優先度内タイブレークを記述しており、両者に差異は無い。

経緯として、統合前の旧・要件定義書は **4段階＋「調整後」優先**（拠点固有 → サプライヤー → 事業者別標準(source=utility) → 全国標準）、DB設計書は **5段階**（拠点固有 → サプライヤー → 組織全体カスタム → 地域一致標準 → 全国標準）と食い違っていた。実装は**より網羅的な 5 段階を正**とし、旧文書の「調整後」優先を**同一優先度内のタイブレーク**として組み込み、「事業者別標準(source=utility)」は「地域一致の標準係数(tier4)」に包含されるものとして扱った（実データ上、事業者別係数は地域名で区別される）。旧・要件定義書はこの整理を反映したうえで機能仕様へ統合済み。

### 既知の制約（今後の課題）
- **地域名の突き合わせ（tier4）**: サービス層は拠点の `region` enum（例 `Kansai`）を `REGION_LABELS`（例「関西」）に変換し、係数の `regionName` と文字列一致で判定する。実データにある「東京電力管内」のような**電力事業者エリア名と地域 enum の対応表は未整備**で、現状は地域ラベルの完全一致のみ対応する。将来、事業者エリア↔地域の対応表を追加して精緻化する。
- **サプライヤー固有係数（tier2）**: 現状 `activity_records` にサプライヤー紐付けが無く、係数の `supplierId` をレコードと突き合わせられない。そのため tier2 は**決してヒットさせない**（`tierOf` が Infinity を返す）。サプライヤー紐付けが入る Phase2 で `record.supplierId` と比較して復活させる。

---

## 3. 単位換算

実装: `engine/units.ts` の `resolveUnitConversion(activityUnit, factorUnit)`。

排出係数の `unit` は「分子(排出量) / 分母(活動量単位)」形式（例 `t-CO2e/kWh`）。**分子・分母の両方**を検証・換算する:
- **分母（活動量単位）**: 同一単位はそのまま（換算係数 1、表記ゆらぎ `m³`↔`m3` は吸収）。同一次元の単位違い（`kWh`↔`MWh`、`L`↔`kL`）は換算する。
- **分子（排出量単位）**: 最終的な排出量は **t-CO2e に揃える**。`t-CO2e`=1倍、`kg-CO2e`=0.001倍、`g-CO2e`=1e-6倍。ここを見落とすと `kg-CO2e/kWh` の係数が `t-CO2e` 扱いになり **1000倍** の静かな誤りになるため、分子の検証は必須。
- 次元が異なる／未知の単位／分子が CO2e 系でない／係数が単位形式でない場合は換算不能とし、そのレコードを `unresolved`（理由 `UNIT_MISMATCH`）とする（機能仕様 §5.5）。自動解決では換算可能な係数が同じ優先度段階にあればそちらを採用する（上記「単位互換」）。

最終式: `emissions(t-CO2e) = 活動量 × (分母換算 × 分子換算) × factorValue`。

---

## 4. Scope 分類と集計

- **Scope の決まり方**: エネルギー種別ごとの Scope は `engine/energyTypeScope.ts` の対応表が正本で、係数の `scope` は入力値ではなくここから決まる（係数フォームは選択欄を持たず種別から自動表示し、CSV 取込は食い違う行をエラーにし、保存直前の `toMutationRow` も種別から決め直す）。集計は結果の `scope`・`categoryId` で積み、レポートのデータ充足状況は未算定レコードも数えるため `energyType` から Scope を判定する。両者が同じ表から決まっていないと、同じ排出量が別々の Scope で数えられる。
- **Scope 1 / 2**: 活動量 × 排出係数で算定。`emission_results` に1レコードずつ保存し、係数の `scope` を引き継ぐ。適用した係数の値・単位・名称は `appliedFactorValue` / `appliedFactorUnit` / `appliedFactorName` に焼き付ける（`emissionFactorId` は生きた行への参照でしかなく、公式係数 seed の再投入やカスタム係数の編集・削除で算定根拠が失われるため。列の導入前に算定された行は null のまま）。
- **Scope 3（排出係数マスタによる算定）**: 公式係数 seed には `scope='scope3'` の標準係数（廃棄物 t-CO2/t、輸送トンキロ t-CO2/t-km、出張 kg-CO2/円・t-CO2/人・日 など、通勤 kg-CO2/人・日）が入っており、データ入力フォームの「標準係数」群（廃棄物・出張・通勤）はこれで算定する（物流・購入した製品・サービス・サプライヤーデータ・車両は公式係数が無いため手動入力の選択肢に出さない。登録済みのレコードは履歴表示と算定の対象のまま）。係数取得は scope で絞らず、`computeEmissions` が係数の `scope` が `scope3` のとき `engine/scope3Category.ts` の対応表（`waste`→5、`freight_transport`/`logistics`→4、`business_travel`→6、`business_travel_commuting`→7、`purchased_goods_services`/`supplier_data`/`water`→1。`vehicle` は Scope1 のため対象外）で `categoryId` を補う。公式係数が無い水道（`water`）も上水道の購入としてカテゴリ1 に載せる（自社設定の係数で算定する）。`categoryId` が無いと `refresh_dashboard_aggregates` の集計対象にならないため必須。出張（`business_travel`）と通勤（`business_travel_commuting`）は手動入力で別カテゴリにする（係数候補は energyType 完全一致のため、1 本にまとめると通勤係数・カテゴリ7 でしか算定されない。#381）。出張・通勤の標準単位は公式係数に合わせて `人・日`（延べ人日）とする。入力フォームは、カテゴリの標準単位が適用係数の単位へ換算できない場合（`人・日` に対し出張の公式係数 `kg-CO2/円`・`kg-CO2/泊`・`t-CO2/人・年` やカスタム係数 `t-CO2e/km` 等）、係数の分母単位で活動量を入力させる（`resolveEntryUnit`）。
- **Scope 3（direct 方式）**: `scope3_category_emissions` に登録済みのカテゴリ別 t-CO2e を集計に反映する（機能仕様 §7.2）。登録・編集は Scope分析画面の「カテゴリ別の算定方法」テーブルから行う。
- **Scope 3（calculated 方式・積上げ算定）**: `energyType='scope3_activity'` の活動量レコード × IDEA 係数（`idea_factors`）で算定する（`idea-scope3-spec.md §4.3`）。Scope1/2 とはレコード取得・`computeEmissions` 呼び出しを分離し（誤マッチ防止の多層防御）、結果は `emission_results` に `scope='scope3'`・`categoryId`・`ideaFactorId`・適用時スナップショット（`appliedFactor*`）付きで保存する。

### 既存データの整合確認（管理者向け SQL）

Scope を種別から決めるようにする前に登録された係数・算定結果が残っていないかを組織横断で確認する。
該当があれば、係数は係数管理画面で開いて保存し直す（保存時に種別から Scope を決め直す）か CSV で取り込み直し、
そのうえで対象年度を再算定する。

```sql
-- 1) エネルギー種別と適用範囲が食い違う排出係数
select f."organizationId", f.id, f.name, f."energyType", f.scope, f.status, f."isCustom"
from emission_factors f
cross join lateral (
  -- 種別ごとの Scope（src/features/calculation/engine/energyTypeScope.ts と同じ対応）
  select case
    when f."energyType" in ('electricity', 'heat') then 'scope2'
    when f."energyType" in (
      'water', 'waste', 'logistics', 'freight_transport', 'business_travel',
      'business_travel_commuting', 'purchased_goods_services', 'supplier_data', 'scope3_activity'
    ) then 'scope3'
    else 'scope1'
  end as expected_scope
) e
where f.scope::text <> e.expected_scope
order by f."organizationId", f."energyType";

-- 2) 食い違う係数で算定済みの結果（集計から落ちている / 別の Scope で数えられている行）
select ar."organizationId", ar."energyType", er.scope, er."categoryId", count(*) as results
from emission_results er
join activity_records ar on ar.id = er."activityRecordId"
cross join lateral (
  select case
    when ar."energyType" in ('electricity', 'heat') then 'scope2'
    when ar."energyType" in (
      'water', 'waste', 'logistics', 'freight_transport', 'business_travel',
      'business_travel_commuting', 'purchased_goods_services', 'supplier_data', 'scope3_activity'
    ) then 'scope3'
    else 'scope1'
  end as expected_scope
) e
where er.scope::text <> e.expected_scope
   -- カテゴリの無い Scope3 の結果はどの集計にも載らない
   -- （scope3_activity はレコード側の scope3CategoryId 未設定を許すため除く）
   or (er.scope = 'scope3' and er."categoryId" is null and ar."energyType" <> 'scope3_activity')
group by ar."organizationId", ar."energyType", er.scope, er."categoryId"
order by ar."organizationId", ar."energyType";
```

### 方式別集計（`scope3_category_methods`。仕様書 §5.1）
カテゴリ 1〜15 それぞれについて、`scope3_category_methods`（組織×年度×カテゴリ。行が無ければ `'direct'`）の方式で採用値を選ぶ:

```
direct     → scope3_category_emissions の登録値（従来どおり）
calculated → emission_results（scope='scope3', categoryId=当該）を activity_records に join し
             periodStart が年度期間内の行の合計
scope3Total = Σ カテゴリ別採用値
```

方式の排他選択により二重計上は構造的に発生しない。`calculated` へ切り替えたカテゴリの直接入力値は削除せず保持し、画面では「未採用（積上げ算定を採用中）」と表示する（切替の可逆性）。

### ダッシュボード集計（`dashboard_aggregates`）
独立関数 **`refresh_dashboard_aggregates(p_organization_id, p_fiscal_year_id)`**（`supabase/migrations/20260831000002_rpc.sql` に定義。EXECUTE は service_role 限定）が、**加算ではなく `emission_results` から絶対値で再計算**する（リトライやソースレコード削除でドリフトしない・自己修復する）。
- `scope1Total` / `scope2Total`: 当該組織・対象年度期間内の `emission_results` を scope 別に合計。
- `scope3Total`: 上記の方式別集計（カテゴリ別採用値の合計）。

呼び出しタイミング（集計の陳腐化防止。仕様書 §5.1）:
1. `run_calculation_commit`（算定バッチ確定時。同一トランザクション内）
2. 方式切替時・Scope3 直接入力値の upsert 時 — Scope分析画面から `POST /api/dashboard-aggregates/refresh`（認証＋自組織検証つき Route Handler）経由で実行
3. Scope3 積上げレコードの削除時 — 削除後の `/api/calculations` 再算定が `run_calculation_commit` 経由で実行（未算定0件でも集計は必ず再計算される）

---

## 5. 実行フロー（サービス層）＋ 原子性

計算（純粋・TS）と確定（原子的・DB）を分離する。

`runCalculationBatch({ organizationId, fiscalYearId })`（`calculationService.ts`）:
1. `calculation_batches` に実行記録を作成（`status = 'pending'`）
2. 未算定の `activity_records`（対象年度期間内）と `active` かつ会計年度に含まれる温対法年度（`applicableYearsForFiscalYear`）の `emission_factors`、拠点の地域を取得。Scope3 積上げレコード（`energyType='scope3_activity'`）は**別クエリで分離取得**し、参照される `idea_factors` / `idea_imports` と合わせて用意する
3. 純粋コア `computeEmissions` で算定（年度・地域名を注入）。Scope3 積上げは `computeScope3Emissions` の**分離呼び出し**で算定し、`emissionFactorId=null` / `ideaFactorId` セットへ FK 詰め替え済みの結果を得る（仕様書 §4.3-2〜4）
4. **`run_calculation_commit`（RPC・単一トランザクション）** を呼び、以下を all-or-nothing で確定:
   `emission_results` 挿入 → `activity_records.isCalculated=true` → `refresh_dashboard_aggregates` による絶対再計算 → `calculation_batches` を `completed`。
5. サマリ（処理件数・合計・**未算定レコード一覧**）を返す。RPC が失敗した場合はデータ確定は起きず（原子的）、バッチを `failed` にして原因を返す。

### 二重計上・整合性の担保（レビュー指摘への対応）
- **原子性**: supabase-js は複数書き込みを個別HTTPで発行するため、確定処理を1つのDB関数（＝1トランザクション）にまとめ、途中失敗による二重計上/欠損を防ぐ。
- **一意制約**: `emission_results("activityRecordId")` に UNIQUE 制約（`supabase/migrations/20260831000000_schema.sql` の制約 `emission_results_activity_record_unique`）。1活動量＝1算定結果を DB が保証し、リトライ・**並行実行**による二重登録を弾く（2つ目の RPC は一意制約違反で丸ごとロールバック）。
- **自己修復**: 集計は絶対値で再計算するため、活動量やその算定結果が削除されても次回実行で正しい値に戻る。
- **編集時の原子性**: 入力履歴からの活動量編集は `activity_records.isCalculated=false` へ戻す UPDATE 1 文だけを発行し、旧 `emission_results` 行はトリガー `clear_emission_results_on_recalculation`（`supabase/migrations/20260831000000_schema.sql`）が同一トランザクションで削除する。別リクエストに分けると、削除だけ失敗したときにレコードは更新済みなのに再算定まで旧値が集計に残る。万一旧行が残っても `run_calculation_commit` は `on conflict do update` で上書きするため年度の算定は止まらない。

DBアクセスは算定バッチ（RLS を越えるサーバ処理）のため **service_role の管理クライアント**（`src/lib/supabase/admin.ts`）で行う（`docs/architecture.md` が「RLSを越えるバッチ用途は service_role 可」と規定）。認証と自組織の検証は呼び出し元の Route Handler が行い、`run_calculation_commit` 内でも組織スコープを再検証する。

---

## 6. 検証方法

`supabase/seeds/demo/demo.sql`（デモシード。`npm run db:reset:demo` / `npm run db:seed:demo` で投入）の検証用データで、シード投入 → 算定実行 → 反映確認までを追える。期待値はシード末尾のメモ参照（`emission_results` 3件、`dashboard_aggregates` scope1=1.145 / scope2=0.924 / scope3=12.500、水道1件が未解決）。手順は `AGENTS.md §4「作業の進め方」` を参照。
