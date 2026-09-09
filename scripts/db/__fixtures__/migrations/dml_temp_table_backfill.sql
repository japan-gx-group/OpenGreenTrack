-- 検査フィクスチャ（検出される）: 列構造の変更に伴うデータ移行。
-- 一時テーブルへの退避（create temporary table … as select）→ delete → insert … select の組。
-- 間にはさむ alter table（列の削除・制約の追加）は DDL なので検出されない。
-- 期待する検出: create temporary table / delete 文 / insert 文（この順）
create temporary table _tmp on commit drop as
select
  "groupId",
  least(sum(amount), 999999999999.999) as amount,
  min("createdAt") as "createdAt"
from t
group by "groupId";

delete from t;
alter table t drop column "yearMonth";
alter table t drop column label;

alter table t
  add constraint t_group_key unique ("groupId");

insert into t ("groupId", amount, "createdAt")
select "groupId", amount, "createdAt"
from _tmp;
