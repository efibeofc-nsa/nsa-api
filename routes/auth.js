// routes/auth.js
const express = require('express');
const axios = require('axios');
const router = express.Router();

const LOGIN_API_URL = process.env.LOGIN_API_URL; // ex: https://your-railway-login-url

if (!LOGIN_API_URL) {
  console.warn('LOGIN_API_URL not set. /auth endpoints will fail until configured.');
}

// POST /auth/login
router.post('/login', async (req, res) => {
  try {
    const payload = req.body;
    const resp = await axios.post(`${LOGIN_API_URL}/login`, payload, {
      headers: { 'Content-Type': 'application/json' }
    });
    return res.status(resp.status).json(resp.data);
  } catch (err) {
    const status = err.response?.status || 500;
    const data = err.response?.data || { error: err.message };
    return res.status(status).json(data);
  }
});

// POST /auth/register (opcional)
router.post('/register', async (req, res) => {
  try {
    const payload = req.body;
    const resp = await axios.post(`${LOGIN_API_URL}/register`, payload, {
      headers: { 'Content-Type': 'application/json' }
    });
    return res.status(resp.status).json(resp.data);
  } catch (err) {
    const status = err.response?.status || 500;
    const data = err.response?.data || { error: err.message };
    return res.status(status).json(data);
  }
});

module.exports = router;
