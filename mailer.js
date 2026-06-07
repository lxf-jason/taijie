// 钛界 - 邮件发送进程 (独立运行，监控 mail-queue.jsonl)
const tls = require('tls');
const fs = require('fs');
const path = require('path');

const QQ_SMTP_PASS = process.env.QQ_SMTP_PASS || '';
const SMTP_USER = '455582572@qq.com';
const QUEUE_FILE = path.join(__dirname, 'mail-queue.jsonl');
const SENT_FILE = path.join(__dirname, 'mail-sent.jsonl');

function b64(s) { return Buffer.from(s, 'utf-8').toString('base64'); }

function sendOneEmail(entry) {
  return new Promise((resolve, reject) => {
    const { name, contact, type, description, time } = entry;
    const subject = `[钛界询盘] ${name} - ${type || '新询盘'}`;

    const emailHtml =
`<div style="font-family:'PingFang SC','Microsoft YaHei',sans-serif;max-width:600px;padding:24px;background:#fafaf8">
  <h2 style="color:#1a1a1a;border-bottom:2px solid #2c2c2c;padding-bottom:12px">钛界 · 新询盘通知</h2>
  <table style="width:100%;border-collapse:collapse;margin-top:16px">
    <tr><td style="padding:8px 0;color:#888;width:80px">姓名</td><td style="padding:8px 0;color:#1a1a1a;font-weight:600">${name}</td></tr>
    <tr><td style="padding:8px 0;color:#888">联系方式</td><td style="padding:8px 0;color:#1a1a1a">${contact}</td></tr>
    <tr><td style="padding:8px 0;color:#888">需求类型</td><td style="padding:8px 0;color:#1a1a1a">${type || '未选择'}</td></tr>
    <tr><td style="padding:8px 0;color:#888">提交时间</td><td style="padding:8px 0;color:#999">${time}</td></tr>
  </table>
  <div style="margin-top:16px;padding:16px;background:#fff;border-left:3px solid #2c2c2c">
    <p style="color:#888;font-size:13px;margin:0 0 8px">需求描述</p>
    <p style="color:#2c2c2c;margin:0;line-height:1.7">${(description || '无').replace(/\n/g, '<br>')}</p>
  </div>
  <p style="color:#bbb;font-size:12px;margin-top:24px">此邮件由钛界官网询盘系统自动发送</p>
</div>`;

    let state = 'CONNECT';
    let buffer = '';

    const socket = tls.connect({ host: 'smtp.qq.com', port: 465, rejectUnauthorized: false }, () => {});
    socket.setTimeout(30000);

    function send(cmd) { socket.write(cmd + '\r\n'); }

    function processLine(code, line, isLast) {
      if (!isLast) return;
      const sc = parseInt(code);
      if (sc >= 500) {
        socket.destroy();
        return reject(new Error('SMTP ' + code + ': ' + line));
      }

      switch (state) {
        case 'CONNECT':
          state = 'EHLO'; send('EHLO taijie'); break;
        case 'EHLO':
          state = 'AUTH_LOGIN'; send('AUTH LOGIN'); break;
        case 'AUTH_LOGIN':
          state = 'AUTH_USER'; send(b64(SMTP_USER)); break;
        case 'AUTH_USER':
          state = 'AUTH_PASS'; send(b64(QQ_SMTP_PASS)); break;
        case 'AUTH_PASS':
          state = 'MAIL_FROM'; send('MAIL FROM:<' + SMTP_USER + '>'); break;
        case 'MAIL_FROM':
          state = 'RCPT_TO'; send('RCPT TO:<' + SMTP_USER + '>'); break;
        case 'RCPT_TO':
          state = 'DATA'; send('DATA'); break;
        case 'DATA':
          state = 'SEND_BODY';
          send('From: <' + SMTP_USER + '>');
          send('To: <' + SMTP_USER + '>');
          send('Subject: =?UTF-8?B?' + b64(subject) + '?=');
          send('MIME-Version: 1.0');
          send('Content-Type: text/html; charset=UTF-8');
          send('Content-Transfer-Encoding: base64');
          send('');
          const encoded = b64(emailHtml);
          for (let i = 0; i < encoded.length; i += 76) send(encoded.substring(i, i + 76));
          send('.');
          break;
        case 'SEND_BODY':
          state = 'QUIT'; send('QUIT'); break;
        case 'QUIT':
          socket.end();
          resolve(true);
          break;
      }
    }

    socket.on('data', (data) => {
      buffer += data.toString();
      const lines = buffer.split('\r\n');
      buffer = lines.pop();
      for (const line of lines) {
        if (line.length < 3) continue;
        const code = line.substring(0, 3);
        const isLast = (line.length === 3) || (line.charAt(3) !== '-');
        processLine(code, line, isLast);
      }
    });

    socket.on('error', (err) => reject(err));
    socket.on('timeout', () => { socket.destroy(); reject(new Error('SMTP timeout')); });
    socket.on('close', () => { if (state !== 'QUIT') reject(new Error('Closed at ' + state)); });
  });
}

async function processQueue() {
  if (!QQ_SMTP_PASS) {
    console.log('[' + new Date().toLocaleTimeString('zh-CN') + '] QQ_SMTP_PASS 未设置，等待中...');
    return;
  }

  if (!fs.existsSync(QUEUE_FILE)) return;
  const content = fs.readFileSync(QUEUE_FILE, 'utf-8').trim();
  if (!content) return;

  const lines = content.split('\n');
  const remaining = [];

  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);
      console.log('发送邮件: ' + entry.name + ' (' + entry.contact + ')');
      await sendOneEmail(entry);
      // Record success
      fs.appendFileSync(SENT_FILE, JSON.stringify({ ...entry, sentAt: new Date().toISOString() }) + '\n');
      console.log('  发送成功');
    } catch (err) {
      console.error('  发送失败: ' + err.message);
      remaining.push(line); // Keep for retry
    }
  }

  // Rewrite queue with failed items
  if (remaining.length > 0) {
    fs.writeFileSync(QUEUE_FILE, remaining.join('\n') + '\n');
  } else {
    fs.writeFileSync(QUEUE_FILE, '');
  }
}

console.log('钛界邮件发送器已启动');
console.log('SMTP: ' + (QQ_SMTP_PASS ? '已配置' : '未配置'));
console.log('监控文件: ' + QUEUE_FILE);
console.log('');

// Poll queue every 5 seconds
setInterval(processQueue, 5000);
processQueue();
