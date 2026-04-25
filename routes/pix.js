// routes/pix.js
const express = require('express');
const { createChargePix, getToken } = require('../utils/efipay');
const router = express.Router();

// POST /pix/create-charge
router.post('/create-charge', async (req, res) => {
  try {
    const payload = req.body;
    const result = await createChargePix(payload);
    return res.json(result);
  } catch (err) {
    const status = err.response?.status || 500;
    const data = err.response?.data || { error: err.message };
    return res.status(status).json(data);
  }
});

// GET /pix/token (opcional para debug)
router.get('/token', async (req, res) => {
  try {
    const token = await getToken();
    return res.json({ token: token ? 'ok' : null });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
