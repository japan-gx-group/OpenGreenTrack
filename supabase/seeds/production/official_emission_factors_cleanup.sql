-- 公式排出係数マスタ: 以前の版が作っていた翌年度コピー行の後始末（OpenGreenTrack の本番でも投入する共通マスタ）
-- scripts/official-factors/generate.ts による自動生成。手編集しないこと。
-- 収録年度の最大値（2025）より後の公式係数行のうち、
-- 算定結果・活動量からの参照が energyType・年度ごとに 1 件も無いものだけを消す（冪等）。
-- 年度ごとの seed（official_emission_factors_<年度>.sql）が入れるのは収録年度の行だけなので、投入の順番には依存しない。
-- 過年度（収録年度の最大値より前）を足してもこのファイルは変わらない。

-- 収録年度（2025）より後の公式係数行の後始末（以前の版が作っていた翌年度コピー行。冪等）。
-- 参照の有無は energyType + 年度の単位で見る（1 件でも参照が残るグループは全部残す。理由は generate.ts）。
delete from emission_factors as ef
where ef."organizationId" is null
  and ef."applicableYear" > 2025
  and not exists (
    select 1
    from emission_factors ref
    where ref."organizationId" is null
      and ref."energyType" = ef."energyType"
      and ref."applicableYear" = ef."applicableYear"
      and (
        exists (select 1 from emission_results er where er."emissionFactorId" = ref.id)
        or exists (select 1 from activity_records ar where ar."emissionFactorId" = ref.id)
      )
  );
