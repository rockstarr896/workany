# WorkAny 长期记忆系统技术设计文档

本文档详细描述了如何在 `WorkAny` 项目中实现类似 OpenClaw 的本地优先长期记忆系统。鉴于 `WorkAny` 采用 Tauri (Frontend) + `src-api` (Node.js Sidecar) 的架构，本设计将记忆系统的核心逻辑托管在 `src-api` 中，充分利用 Node.js 生态的成熟工具（如 `better-sqlite3`, `chokidar`, `sqlite-vec`）。

## 1. 系统架构概览

记忆系统旨在为 Agent 提供持久化的上下文 recall 能力。它遵循 **"Markdown 为主，向量索引为辅"** 的原则。

### 1.1 核心组件分布

*   **Frontend (Tauri/React)**: 负责 UI 展示（搜索结果、状态指示）和触发 Agent 的记忆查询工具。通过 HTTP 请求与 `src-api` 通信。
*   **Backend (src-api/Node.js)**: 承载记忆系统的核心引擎。
    *   **文件系统层**: 直接读写用户工作区（Workspace）的 Markdown 文件。
    *   **索引层**: 维护 SQLite 数据库，存储文件元数据、文本分块（Chunks）和向量嵌入（Embeddings）。
    *   **计算层**: 运行嵌入模型（通过 API 或本地模型）和向量相似度计算。

### 1.2 数据流向

1.  **写入**: Agent/用户编辑 `memory/YYYY-MM-DD.md` 或 `MEMORY.md`。
2.  **监控**: `src-api` 中的 `Watcher` 检测到文件变更。
3.  **索引**: 触发增量索引，生成 Embedding 并存入 SQLite。
4.  **检索**: Agent 调用 `memory_search` 工具 -> `src-api` 执行混合搜索（向量+关键词） -> 返回相关片段。

---

## 2. 存储层设计 (Storage Layer)

### 2.1 文件结构 (Workspace)

用户工作区（Workspace）是记忆的**真实来源 (Source of Truth)**。建议结构如下：

```text
~/Documents/WorkAny/workspace/
├── MEMORY.md                    # 核心记忆：长期事实、用户偏好、关键决策
├── memory/
│   ├── 2024-01-30.md            # 每日日志：流水账、临时上下文
│   └── 2024-01-31.md
└── .workany/                    # 隐藏目录（由程序管理）
    └── memory.sqlite            # 派生的向量索引数据库
```

### 2.2 数据库 Schema (SQLite)

在 `src-api` 中使用 `better-sqlite3`，并加载 `sqlite-vec` 扩展。

**表结构设计：**

```sql
-- 1. 文件元数据表：跟踪文件变更，避免重复索引
CREATE TABLE files (
  path TEXT PRIMARY KEY,         -- 相对路径 (e.g., "memory/2024-01-30.md")
  hash TEXT NOT NULL,            -- 文件内容哈希 (SHA-256)
  last_indexed_at INTEGER NOT NULL
);

-- 2. 文本分块表：存储切片后的文本
CREATE TABLE chunks (
  id TEXT PRIMARY KEY,           -- 唯一ID (hash of path + content + range)
  file_path TEXT NOT NULL,       -- 关联文件
  start_line INTEGER NOT NULL,   -- 起始行
  end_line INTEGER NOT NULL,     -- 结束行
  content TEXT NOT NULL,         -- 文本内容
  embedding_json TEXT,           -- 原始向量 (JSON string, 作为备份)
  FOREIGN KEY(file_path) REFERENCES files(path) ON DELETE CASCADE
);

-- 3. 向量表 (sqlite-vec 虚拟表)：用于向量搜索
-- 注意：sqlite-vec 使用专门的虚拟表语法
CREATE VIRTUAL TABLE vec_chunks USING vec0(
  id TEXT PRIMARY KEY,
  embedding FLOAT[1536]          -- 维度取决于模型 (OpenAI=1536, Local=384/768/1024)
);

-- 4. 全文搜索表 (FTS5 虚拟表)：用于关键词搜索
CREATE VIRTUAL TABLE fts_chunks USING fts5(
  content,
  file_path UNINDEXED
);
```

---

## 3. 核心模块设计 (src-api)

建议在 `src-api/src/core/memory` 下实现以下模块。

### 3.1 MemoryManager (入口)

负责协调各个子模块，对外暴露 API。

```typescript
class MemoryManager {
  constructor(private config: MemoryConfig) {}

  // 初始化：连接DB，启动Watcher
  async init() { ... }

  // 核心功能：搜索
  async search(query: string, options: SearchOptions): Promise<SearchResult[]> {
    // 1. 并行执行 向量搜索 和 FTS搜索
    // 2. 使用 RRF (Reciprocal Rank Fusion) 或加权平均合并结果
    // 3. 返回 Top K 片段
  }

  // 核心功能：强制同步
  async sync() { ... }
}
```

### 3.2 Indexer (索引器)

负责将 Markdown 文件转换为数据库记录。

**处理流程：**
1.  **读取**: 读取文件内容。
2.  **哈希比对**: 对比 `files` 表中的 hash，未变化则跳过。
3.  **分块 (Chunking)**:
    *   策略：按 Token 数量分块（推荐：500 tokens window, 100 tokens overlap）。
    *   工具：可以使用 `tiktoken` (Node版) 或简单的字符估算。
    *   保留行号信息（对引用很重要）。
4.  **Embedding**: 调用 `EmbeddingProvider` 获取向量。
5.  **Upsert**: 事务性更新 `chunks`, `vec_chunks`, `fts_chunks` 表。

### 3.3 EmbeddingProvider (嵌入提供者)

抽象层，支持多种后端。

```typescript
interface IEmbeddingProvider {
  embedQuery(text: string): Promise<number[]>;
  embedDocuments(texts: string[]): Promise<number[][]>;
}

// 实现1: OpenAI (远程)
class OpenAIEmbeddingProvider implements IEmbeddingProvider { ... }

// 实现2: Transformers.js (本地 Node.js)
// 优点：完全离线，免费。缺点：消耗本地 CPU/RAM。
// 推荐模型：Xenova/all-MiniLM-L6-v2 (轻量, 384维) 或 Xenova/bge-m3
class LocalEmbeddingProvider implements IEmbeddingProvider { ... }
```

### 3.4 Watcher (监控器)

使用 `chokidar` 监听 Workspace 目录。

*   **Debounce**: 设置防抖（如 2秒），避免频繁写入触发多次索引。
*   **过滤**: 只监听 `.md` 文件，忽略点开头的文件。

---

## 4. 关键技术实现细节

### 4.1 混合搜索算法 (Hybrid Search)

为了兼顾语义匹配（向量）和精确匹配（关键词），采用混合搜索策略。

```typescript
async function hybridSearch(query: string) {
  // 1. 向量搜索 (sqlite-vec)
  const vecResults = db.prepare(`
    SELECT id, distance FROM vec_chunks
    WHERE embedding MATCH ?
    ORDER BY distance
    LIMIT 20
  `).all(queryEmbedding);

  // 2. 关键词搜索 (FTS5)
  const ftsResults = db.prepare(`
    SELECT rowid, rank FROM fts_chunks
    WHERE fts_chunks MATCH ?
    ORDER BY rank
    LIMIT 20
  `).all(query);

  // 3. 结果融合 (加权)
  // Score = (VectorScore * 0.7) + (KeywordScore * 0.3)
  // 注意归一化分数范围
}
```

### 4.2 本地向量数据库集成 (sqlite-vec)

在 `src-api` 中集成 `sqlite-vec` 需要注意：

1.  **依赖**: 安装 `sqlite-vec` npm 包。
2.  **加载**: 在 `better-sqlite3` 连接建立后加载扩展。

```typescript
import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';

const db = new Database('memory.sqlite');
sqliteVec.load(db); // 加载扩展
```

### 4.3 自动记忆刷新 (Auto-Flush)

为了让 Agent 主动管理记忆，需要在会话上下文中注入提示。

*   **时机**: 当会话 Token 数接近上限，即将触发 Context Window 压缩时。
*   **动作**: 向 Agent 发送一条系统消息（对用户不可见）：
    > "Session is nearing limit. Please review the conversation and save any important facts, preferences, or decisions to MEMORY.md using the `memory_save` tool."

---

## 5. 开发路线图 & 依赖清单

### 5.1 推荐依赖 (添加到 `src-api/package.json`)

```bash
pnpm add better-sqlite3 sqlite-vec chokidar tiktoken
pnpm add @langchain/core @langchain/openai # 可选，用于简化 Embedding 调用
# 如果做本地 Embedding:
pnpm add @xenova/transformers
```

### 5.2 开发步骤

1.  **基础建设**:
    *   在 `src-api` 中创建 `DatabaseService`，集成 `better-sqlite3` 和 `sqlite-vec`。
    *   定义 SQL Schema 初始化脚本。
2.  **索引管道**:
    *   实现 `MarkdownChunker`。
    *   实现 `Watcher` 监听文件变动。
    *   实现简单的 `Indexer`，先只打印日志，不存库。
3.  **Embedding 集成**:
    *   接入 OpenAI Embedding API。
    *   (可选) 接入 `transformers.js` 本地模型。
4.  **搜索实现**:
    *   实现向量搜索 SQL。
    *   实现 FTS5 搜索 SQL。
    *   实现混合排序逻辑。
5.  **API 暴露**:
    *   在 `src-api` (Hono) 添加 `/memory/search` 和 `/memory/status` 接口。
6.  **Frontend 对接**:
    *   在 React 中创建 `useMemory` hook。
    *   在 Agent 的 Tool 列表中注册 `memory_search` 工具。

### 5.3 Agent 工具定义 (Function Calling)

Agent 需要以下工具来与记忆系统交互：

1.  **`memory_search(query: string)`**:
    *   描述: "Search long-term memory for facts, preferences, and past decisions."
    *   后端: 调用 `MemoryManager.search`。
2.  **`memory_save(content: string, file: string)`**:
    *   描述: "Save important information to long-term memory."
    *   后端: 将内容追加到指定 Markdown 文件。
3.  **`memory_read(file: string)`**:
    *   描述: "Read the full content of a specific memory file."
    *   后端: 读取文件内容。

---

## 6. 总结

通过在 `src-api` 中复用 OpenClaw 的设计模式，`WorkAny` 可以快速获得企业级的本地记忆能力。这种架构保持了数据的**透明性**（用户可以直接阅读/编辑 Markdown）和**隐私性**（所有数据本地处理，可选本地 Embedding），非常契合 `WorkAny` 作为本地桌面 Agent 的定位。
