/**
 * GF-Engine v4.0
 * 通用流体智力探测仪 — 成分分离评分版
 *
 * 核心：每道题拆分为不可再分的认知操作单元（components），
 * 用户提交完整 reasoning chain，AI 逐项评估 components。
 * 推理权重 ~70%，执行权重 ~30%。
 */

const fetch = require('node-fetch');

// SQLite 题库持久化层
let db = null;
try {
  const Database = require('better-sqlite3');
  const fs = require('fs');
  const path = require('path');
  const dbPath = process.env.BDI_DB_PATH || './data/bdi_bank.db';
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS questions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      dimension TEXT NOT NULL, question_text TEXT NOT NULL,
      answer TEXT NOT NULL, explanation TEXT, difficulty INTEGER DEFAULT 3,
      components_json TEXT NOT NULL, options_json TEXT,
      source TEXT DEFAULT 'ai', created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      used_count INTEGER DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_questions_dim ON questions(dimension);
    CREATE INDEX IF NOT EXISTS idx_questions_dim_used ON questions(dimension, used_count);
  `);
} catch (e) {
  console.warn('[GF-Engine] SQLite 不可用，回退内存模式:', e.message);
}

// 6 大维度定义
const DIMENSIONS = [
  { key: 'verbal_analogy', name: '语言类比', desc: '远距离概念映射能力' },
  { key: 'spatial_rotation', name: '空间旋转', desc: '心理旋转与拓扑推理' },
  { key: 'pattern_completion', name: '模式补全', desc: '序列规律识别与外延' },
  { key: 'logical_deduction', name: '逻辑演绎', desc: '条件推理与矛盾探测' },
  { key: 'numerical_reasoning', name: '数理论证', desc: '数量关系抽象化' },
  { key: 'divergent_thinking', name: '发散思维', desc: '远距离联想与重组' },
];

async function callLLM(prompt, apiKey, model = 'qwen-max') {
  const resp = await fetch('https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, input: { prompt }, parameters: { max_tokens: 2048, temperature: 0.7 } }),
  });
  const data = await resp.json();
  return data.output?.text || '';
}

async function generateQuestions(count = 6) {
  // 简化版：从题库随机抽取，不足时 AI 生成
  const questions = [];
  for (let i = 0; i < count; i++) {
    const dim = DIMENSIONS[i % DIMENSIONS.length];
    let q = getRandomQuestionFromBank(dim.key);
    if (!q) {
      q = await generateQuestionByAI(dim);
      saveQuestionToBank(dim, q);
    }
    questions.push(q);
  }
  return questions;
}

async function generateQuestionByAI(dim) {
  const prompt = `请为"${dim.name}"维度生成一道流体智力测试题。
要求：
1. 难度适合 IQ 130+ 群体
2. 提供标准答案和详细解释
3. 将解题过程拆分为 3-5 个不可再分的认知操作单元（components）
4. 每个 component 标注：名称、推理/执行类型、满分分值
5. 返回 JSON 格式: {question, answer, explanation, components:[{name,type,points}], options?}
维度描述: ${dim.desc}`;
  const raw = await callLLM(prompt, process.env.DASHSCOPE_API_KEY);
  try {
    return JSON.parse(raw);
  } catch {
    return { question: raw, answer: 'N/A', explanation: '', components: [{name:'整体',type:'reasoning',points:3}], type: 'exact' };
  }
}

async function scoreAnswer(question, userAnswer, reasoningChain, apiKey) {
  const prompt = `你是一位严格的流体智力评分专家。

题目: ${question.question}
标准答案: ${question.answer}
用户答案: ${userAnswer}
用户推理链: ${reasoningChain || '未提供'}

认知操作单元（components）:
${JSON.stringify(question.components, null, 2)}

请逐项评估每个 component 的完成度（0-1 浮点数），并给出总分。
返回 JSON: {component_scores:{name:score}, total_score:number, feedback:string}`;
  const raw = await callLLM(prompt, apiKey);
  try {
    const result = JSON.parse(raw);
    return result.total_score || 0;
  } catch {
    return 0;
  }
}

function saveQuestionToBank(dim, q) {
  if (!db) return null;
  try {
    const stmt = db.prepare(`INSERT INTO questions (dimension, question_text, answer, explanation, difficulty, components_json, options_json, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
    return stmt.run(dim.key, q.question, q.answer, q.explanation || '', q.difficulty || 3,
      JSON.stringify(q.components || []), q.options ? JSON.stringify(q.options) : null, 'ai').lastInsertRowid;
  } catch (e) { console.error('[GF-Engine] 题库入库失败:', e.message); return null; }
}

function getRandomQuestionFromBank(dimKey) {
  if (!db) return null;
  const row = db.prepare(`SELECT * FROM questions WHERE dimension = ? ORDER BY used_count ASC, RANDOM() LIMIT 1`).get(dimKey);
  if (!row) return null;
  db.prepare('UPDATE questions SET used_count = used_count + 1 WHERE id = ?').run(row.id);
  return { id: row.id, dimension: row.dimension, question: row.question_text, answer: row.answer,
    explanation: row.explanation, difficulty: row.difficulty,
    options: row.options_json ? JSON.parse(row.options_json) : null,
    type: row.options_json ? 'choice' : 'exact',
    components: JSON.parse(row.components_json) };
}

function getBankStats() {
  if (!db) return [];
  return db.prepare(`SELECT dimension, COUNT(*) as count, AVG(used_count) as avg_used FROM questions GROUP BY dimension`).all();
}

function isDimensionSufficient(dimKey, minCount = 50) {
  if (!db) return false;
  const row = db.prepare('SELECT COUNT(*) as c FROM questions WHERE dimension = ?').get(dimKey);
  return (row?.c || 0) >= minCount;
}

function slowFillBank(lowDims) {
  // 后台每 5 分钟补充一题
  let idx = 0;
  const timer = setInterval(async () => {
    if (idx >= lowDims.length) { clearInterval(timer); return; }
    const dim = lowDims[idx];
    const q = await generateQuestionByAI(dim);
    saveQuestionToBank(dim, q);
    console.log(`[GF-Engine] 补充题库: ${dim.key}`);
    idx++;
  }, 5 * 60 * 1000);
}

module.exports = {
  DIMENSIONS, generateQuestions, scoreAnswer,
  getBankStats, isDimensionSufficient, slowFillBank
};
