-- SSBJ 開示レポート: 四本柱の文章に、選択式テンプレートで選んだ値と補足入力を持たせる（docs/ssbj-spec.md §5）。
--
-- 選択式テンプレート（src/features/ssbj/utils/narrativeTemplateChoice.ts）で利用者が選んだ値は、本文（disclosureText）とは
-- 別の列に持つ。本文の代わりにはせず、下書きの元になった選択を後から確かめるための作業用の情報とする。
-- 形（version・choices・texts）と選択肢 ID はアプリが検証する（テンプレートはコードの定数で、DB からは見えないため）。
-- DB は object であることだけを検証する。既存の行は null（テンプレートを使っていない）のままにする（R12: データは入れない）。
-- 保存版には含めない（ssbj_snapshot_section__narratives は変えない）。保存版から復元した行は null になる。

alter table ssbj_narratives add column "templateInput" jsonb;

alter table ssbj_narratives add constraint ssbj_narratives_template_input_object check (
  "templateInput" is null or jsonb_typeof("templateInput") = 'object'
);

comment on column ssbj_narratives."templateInput" is
  '選択式テンプレートで選んだ値と補足入力（{version, choices, texts}。使っていなければ NULL）。'
  '本文の代わりにしない作業用の情報で、保存版には含めない。形と選択肢 ID はアプリが検証する。';

-- 作成時・更新時に利用者が指定できる列に加える（20261001003809_ssbj_narratives.sql §4 と同じ列指定の GRANT）。
grant insert ("templateInput") on ssbj_narratives to authenticated;
grant update ("templateInput") on ssbj_narratives to authenticated;
