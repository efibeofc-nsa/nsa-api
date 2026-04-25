// index.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');

const authRouter = require('./routes/auth');
const pixRouter = require('./routes/pix');

const app = express();
app.use(express.json());

const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';
app.use(cors({
  origin: CORS_ORIGIN
}));

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.use('/auth', authRouter);
app.use('/pix', pixRouter);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`nsa-api listening on port ${PORT}`);
});
