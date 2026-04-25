// routes/payments.js
const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const router = express.Router();

function efipayBaseUrl(env){ return env === 'production' ? 'https://api.efipay.com.br' : 'https://sandbox.efipay.com.br'; }

async function getEfipayToken(env, clientId, clientSecret){
  const url = `${efipayBaseUrl(env)}/oauth/token`;
  const res = await axios.post(url, { client_id: clientId, client_secret: clientSecret, grant_type: 'client_credentials' });
  return res.data.access_token;
}

const orders = new Map();

function generateOrderId(){ return 'order_' + crypto.randomBytes(8).toString('hex'); }

router.post('/create-hosted', async (req, res) => {
  try {
    const { amount, buyer, items } = req.body;
    if (!amount || !buyer || !buyer.name || !buyer.email) return res.status(400).json({ error: 'Missing amount or buyer info' });

    const orderId = generateOrderId();
    const order = { orderId, amount, buyer, items: items||[], status:'pending', createdAt: new Date().toISOString() };
    orders.set(orderId, order);

    const token = await getEfipayToken(process.env.EFIPAY_ENV, process.env.EFIPAY_CLIENT_ID, process.env.EFIPAY_CLIENT_SECRET);

    const payload = {
      amount,
      orderId,
      buyer: { name: buyer.name, email: buyer.email, cpfCnpj: buyer.cpf || '' },
      returnUrl: `${process.env.HOSTED_RETURN_URL_BASE || 'https://sites.google.com/view/nsastore/checkout-return'}?orderId=${orderId}`,
      webhookUrl: `${process.env.BASE_URL || 'https://nsa-api-production.up.railway.app'}/webhook/payments`,
      metadata: { localOrderId: orderId },
      items: items || []
    };

    const hostedEndpoint = `${efipayBaseUrl(process.env.EFIPAY_ENV)}/payments/hosted`;
    const efipayRes = await axios.post(hostedEndpoint, payload, { headers: { Authorization: `Bearer ${token}` } });

    const checkoutUrl = efipayRes.data.checkoutUrl || efipayRes.data.url || efipayRes.data.paymentUrl;
    order.provider = { raw: efipayRes.data, providerCheckoutId: efipayRes.data.id || null };
    orders.set(orderId, order);

    if (!checkoutUrl) return res.status(502).json({ error: 'No checkout URL returned by provider', provider: efipayRes.data });
    return res.json({ orderId, checkoutUrl });
  } catch (err) {
    console.error('create-hosted error', err.response?.data || err.message);
    return res.status(500).json({ error: 'Error creating hosted checkout', details: err.response?.data || err.message });
  }
});

router.post('/webhook/payments', async (req, res) => {
  try {
    const signatureHeader = req.headers['x-efipay-signature'] || req.headers['x-signature'] || req.headers['x-hub-signature'];
    if (signatureHeader && process.env.WEBHOOK_SECRET) {
      const payloadRaw = JSON.stringify(req.body);
      const expected = crypto.createHmac('sha256', process.env.WEBHOOK_SECRET).update(payloadRaw).digest('hex');
      const received = signatureHeader.replace(/^sha256=|^sha1=/, '');
      if (received !== expected) return res.status(401).send('invalid signature');
    }

    const event = req.body;
    const orderId = event.metadata?.localOrderId || event.orderId || event.reference || event.data?.orderId || null;
    const status = event.status || event.event || event.data?.status || null;
    if (!orderId) return res.status(400).send('missing order id');

    const order = orders.get(orderId);
    if (!order) return res.status(404).send('order not found');

    let newStatus = order.status;
    if (/paid|approved|completed|authorized/i.test(status)) newStatus = 'paid';
    else if (/pending|waiting/i.test(status)) newStatus = 'pending';
    else if (/cancel|refused|declined|failed|rejected/i.test(status)) newStatus = 'failed';
    else if (/expired/i.test(status)) newStatus = 'expired';

    order.status = newStatus;
    order.providerStatus = status;
    order.updatedAt = new Date().toISOString();
    orders.set(orderId, order);

    // TODO: trigger post-payment actions (email, fulfillment)
    return res.status(200).send('ok');
  } catch (err) {
    console.error('webhook error', err);
    return res.status(500).send('error');
  }
});

router.get('/orders/:orderId', (req, res) => {
  const order = orders.get(req.params.orderId);
  if (!order) return res.status(404).json({ error: 'not found' });
  return res.json(order);
});

module.exports = router;
