/**
 * BDI v2.5 · 百炼智能体代理版（SQLite 持久化）
 * 职责：会话持久化 + API 透传 + 防失忆历史注入 + 排行榜
 */

require('dotenv').config();

const TIME_MULTIPLIER = parseFloat(process.env.GF_TIME_MULTIPLIER) || 1.0;
const express = require('express');
const cors = require('cors');
const path = require('path');
const Database = require('better-sqlite3');

const app = express();
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.DASHSCOPE_API_KEY;
const APP_ID = process.env.APP_ID;

if (!API_KEY || !APP_ID) {
  console.error('❌ 环境变量缺失：DASHSCOPE_API_KEY 与 APP_ID 必须同时配置');
  process.exit(1);
}

// ========================
// GF-Engine · 通用流体智力探测
// ========================
const gfEngine = require('./gf-engine');

// 启动时统计题库
const bankStats = gfEngine.getBankStats();
console.log('[SERVER] BDI题库统计:');
if (bankStats.length === 0) {
  console.log('  (空，首次启动，等待用户测题时自动填充)');
} else {
  for (const s of bankStats) {
    console.log(`  ${s.dimension}: ${s.count}题 (平均使用${Math.round(s.avg_used || 0)}次)`);
  }
}
const lowDims = gfEngine.DIMENSIONS.filter(d => !gfEngine.isDimensionSufficient(d.key, 50));
if (lowDims.length > 0) {
  console.log(`[SERVER] 题库不足的维度: ${lowDims.map(d => d.key).join(', ')}`);
  console.log('[SERVER] 启动后台慢速补充（每5分钟1题，避免API限流）');
  gfEngine.slowFillBank(lowDims);
}

// ========================
// GF Session 管理
// ========================
const gfSessions = new Map();

function createGFSession() {
  const sessionId = 'gf_' + Math.random().toString(36).substring(2, 15);
  gfSessions.set(sessionId, {
    sessionId, questions: null, currentIndex: 0,
    answers: [], scores: [], totalScore: 0, createdAt: Date.now()
  });
  setTimeout(() => gfSessions.delete(sessionId), 30 * 60 * 1000);
  return sessionId;
}

function getGFSession(sessionId) { return gfSessions.get(sessionId); }

function getSessionResult(sessionId) {
  const s = gfSessions.get(sessionId);
  if (!s) return null;
  const totalScore = s.scores.reduce((a, b) => a + b, 0);
  const passed = totalScore >= 13;
  let sd15 = { label: "≤120", desc: "未满足BDI适用条件" };
  if (totalScore >= 15) sd15 = { label: "≥130", desc: "高流体智力区间" };
  else if (totalScore >= 13) sd15 = { label: "120-129", desc: "中上流体智力区间" };
  return { totalScore, passed, sd15 };
}

function checkBDIGate(sessionId) {
  const r = getSessionResult(sessionId);
  return r ? r.passed : false;
}

// ========================
// SQLite 数据库
// ========================
const DB_PATH = process.env.BDI_DB_PATH || './data/bdi.db';
const fs = require('fs');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new Database(DB_PATH);
db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY, data TEXT, created_at INTEGER
  );
  CREATE TABLE IF NOT EXISTS results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT, total_score INTEGER, sd15_label TEXT,
    dimensions_json TEXT, created_at INTEGER DEFAULT (strftime('%s','now'))
  );
`);

// ========================
// Express 路由
// ========================
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use('/dist', express.static(path.join(__dirname, '../dist')));

// 健康检查
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', version: '2.5.0', gf_bank: bankStats });
});

// 启动 GF 会话
app.post('/api/gf/start', async (req, res) => {
  const sessionId = createGFSession();
  const session = getGFSession(sessionId);
  // 异步生成 6 道题
  session.questions = await gfEngine.generateQuestions(6);
  res.json({ sessionId, totalQuestions: 6, firstQuestion: session.questions[0] });
});

// 提交答案
app.post('/api/gf/answer', async (req, res) => {
  const { sessionId, answer, reasoningChain } = req.body;
  const session = getGFSession(sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  const q = session.questions[session.currentIndex];
  const score = await gfEngine.scoreAnswer(q, answer, reasoningChain, API_KEY);
  session.answers.push(answer);
  session.scores.push(score);
  session.currentIndex++;

  const isLast = session.currentIndex >= session.questions.length;
  if (isLast) {
    const result = getSessionResult(sessionId);
    db.prepare('INSERT INTO results (session_id, total_score, sd15_label, dimensions_json) VALUES (?, ?, ?, ?)')
      .run(sessionId, result.totalScore, result.sd15.label, JSON.stringify(session.scores));
    return res.json({ done: true, result });
  }
  res.json({ done: false, nextQuestion: session.questions[session.currentIndex], currentScore: score });
});

// 获取结果
app.get('/api/gf/result/:id', (req, res) => {
  const result = getSessionResult(req.params.id);
  if (!result) return res.status(404).json({ error: 'Not found' });
  res.json(result);
});

// 排行榜
app.get('/api/leaderboard', (req, res) => {
  const rows = db.prepare('SELECT sd15_label, COUNT(*) as count FROM results GROUP BY sd15_label ORDER BY count DESC').all();
  res.json({ distribution: rows });
});

app.listen(PORT, () => {
  console.log(`[BDI] Server running on port ${PORT}`);
});
