// 钛界 - HTTP 服务器 (只负责接收询盘，邮件由 mailer.js 独立发送)
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3456;
const QUEUE_FILE = path.join(__dirname, 'mail-queue.jsonl');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'application/javascript',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.json': 'application/json',
};

function enqueueMail(entry) {
  fs.appendFileSync(QUEUE_FILE, JSON.stringify(entry) + '\n');
}

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  if (req.method === 'POST' && req.url === '/api/inquiry') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      const params = new URLSearchParams(body);
      const name = params.get('name') || '';
      const contact = params.get('contact') || '';
      const type = params.get('type') || '';
      const description = params.get('description') || '';

      if (!name || !contact) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: false, message: '请填写姓名和联系方式' }));
        return;
      }

      const now = new Date();
      const timeStr = now.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });

      // Log
      const logLine = `[${timeStr}] ${name} | ${contact} | ${type} | ${(description||'').substring(0,80)}\n`;
      fs.appendFileSync(path.join(__dirname, 'inquiries.log'), logLine);

      // Queue for mailer
      enqueueMail({ name, contact, type, description, time: timeStr });

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: true, message: '提交成功，我们会尽快联系您' }));
    });
    return;
  }

  let filePath = req.url === '/' ? '/taijie.html' : req.url;
  filePath = path.join(__dirname, filePath);
  if (!filePath.startsWith(__dirname)) { res.writeHead(403); res.end(); return; }

  const ext = path.extname(filePath).toLowerCase();
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log('钛界 HTTP 服务器已启动 http://localhost:' + PORT);
});
