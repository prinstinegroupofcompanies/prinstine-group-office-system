const http = require('http');

const payload = JSON.stringify({
  email: 'admin@prinstinegroup.org',
  password: 'Prinstine@2026!Secure#9'
});

const options = {
  hostname: 'localhost',
  port: 3006,
  path: '/api/auth/login',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload)
  }
};

const req = http.request(options, (res) => {
  console.log('statusCode:', res.statusCode);
  let body = '';
  res.on('data', (chunk) => {
    body += chunk;
  });
  res.on('end', () => {
    console.log('body:', body);
  });
});

req.on('error', (err) => {
  console.error('request error:', err.message);
});

req.write(payload);
req.end();
