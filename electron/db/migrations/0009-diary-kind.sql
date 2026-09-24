-- 日记类型：把"每日日记"与"节点日记"分开。
--
-- 为什么必须显式存类型，不能靠关联推导：每日日记**也可以**关联节点，
-- 所以"有没有 node 关联"推不出类型——不挂节点的可能是每日日记，挂着节点的也可能是每日日记。
-- 类型是条目的固有属性，只能存下来。
--
-- 语义：
--   daily —— 每日日记，节点关联 0..n 可选，occurred_day 是它的主视图
--   node  —— 节点日记（画布上 node.detail 的正身），节点关联必须 >= 1
--
-- "节点日记必须挂节点"这条不变量由仓储在同一个事务内校验（SQLite 跨表做不了 CHECK，
-- 触发器也没法延迟到关联写完之后再校验），这里只负责把列和索引建出来。

ALTER TABLE diary_entries ADD COLUMN kind TEXT NOT NULL DEFAULT 'daily';

-- 回填只认一条明确信号：由"节点备注导入"产生的条目本来就是节点日记。
-- 故意不按"有没有节点关联"回填：那会把"某天顺手关联了节点"的每日日记误判成节点日记，
-- 而节点日记不参与按天主视图，等于让用户已经写好的日记凭空消失。
UPDATE diary_entries SET kind = 'node' WHERE source = 'node-note-import';

CREATE INDEX IF NOT EXISTS idx_diary_kind ON diary_entries(account_id, kind, occurred_at DESC);
