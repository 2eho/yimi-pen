# Shared target-neutral contracts

此目录只放已经出现第二个真实消费者的纯语义实现，不放文件系统、数据库、网络、UI 或板级
SDK。机器 Schema 与 transcript 的所有权仍在对应 `hardware/evt0/<contract>/` 目录。

当前内容：

- `family-revision-v1.mjs`：FamilyRevision 身份、集合不变量和跨 revision binding transition；
- `rfc3339.mjs`：Family build/repository 共用的严格日历时间校验。

新增共享项要同时满足：两个可执行消费者、共同正/负向向量、提取后删除重复实现。只有一个
消费者的 helper 继续留在自身模块，避免公共目录演变为低内聚工具箱。
