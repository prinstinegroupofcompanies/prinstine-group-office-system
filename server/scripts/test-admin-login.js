const axios = require('axios');

const url = 'http://localhost:3006/api/auth/login';
const payload = {
  email: 'admin@prinstinegroup.org',
  password: 'Prinstine@2026!Secure#9'
};

(async () => {
  try {
    const response = await axios.post(url, payload, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 20000
    });
    console.log('status', response.status);
    console.log('data', response.data);
  } catch (error) {
    if (error.response) {
      console.error('status', error.response.status);
      console.error('data', error.response.data);
    } else {
      console.error('error', error.message);
    }
    process.exit(1);
  }
})();
