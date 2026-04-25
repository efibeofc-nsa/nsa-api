// utils/efipay.js
const axios = require('axios');
const NodeCache = require('node-cache');

const cache = new NodeCache({ stdTTL: 300 });

const EFIPAY_ENV = process.env.EFIPAY_ENV || 'homolog';
const CLIENT_ID = process.env.EFIPAY_CLIENT_ID;
const CLIENT_SECRET = process.env.EFIPAY_CLIENT_SECRET;

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.warn('EFIPAY_CLIENT_ID or EFIPAY_CLIENT_SECRET not set.');
}

function baseUrl() {
  if (EFIPAY_ENV === 'production') return 'https://api.efipay.com.br';
  return 'https://dev.efipay.com.br';
}

async function getToken() {
  const cached = cache.get('efipay_token');
  if (cached) return cached;

  const url = `${baseUrl()}/oauth/token`;
  const body = new URLSearchParams();
  body.append('grant_type', 'client_credentials');
  body.append('client_id', CLIENT_ID);
  body.append('client_secret', CLIENT_SECRET);

  const resp = await axios.post(url, body.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
  });

  const token = resp.data.access_token;
  const expiresIn = resp.data.expires_in || 300;
  cache.set('efipay_token', token, Math.max(60, expiresIn - 30));
  return token;
}

async function createChargePix(chargePayload) {
  const token = await getToken();
  // Ajuste o path conforme a versão da API Efipay que você usa
  const url = `${baseUrl()}/api-pix/v1/charges`;
  const resp = await axios.post(url, chargePayload, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    }
  });
  return resp.data;
}

module.exports = { getToken, createChargePix, baseUrl };
