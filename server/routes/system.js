const express = require('express');
const router = express.Router();
const { getLockdownPayload } = require('../utils/systemLockdown');

/** Public status — always available so clients can show lockdown screen. */
router.get('/status', (_req, res) => {
  res.json(getLockdownPayload());
});

module.exports = router;
