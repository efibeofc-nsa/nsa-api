// server.js - API Efi Bank PIX para NSA Store
const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const fs = require('fs');
const path = require('path');
const EfiPay = require('sdk-node-apis-efi');

dotenv.config();

const app = express();

// CORS: se precisar de credentials, não use '*'
const allowedOrigins = ['https://sites.google.com', 'http://localhost:3000'];
app.use(cors({
  origin: function(origin, callback) {
    if (!origin) return callback(null, true); // allow server-to-server or curl
    if (allowedOrigins.indexOf(origin) !== -1) {
      return callback(null, true);
    }
    return callback(new Error('CORS policy: origin not allowed'));
  },
  credentials: true
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// CONFIGURAÇÃO EFI BANK
const useSandbox = process.env.NODE_ENV !== 'production' || process.env.SANDBOX === 'true';

const options = {
  client_id: process.env.EFI_CLIENT_ID,
  client_secret: process.env.EFI_CLIENT_SECRET,
  sandbox: useSandbox,
  timeout: 30000
};

// Se tiver certificado .p12 para produção
let certPath = null;
try {
  if (process.env.EFI_CERT_PATH) {
    certPath = path.resolve(process.env.EFI_CERT_PATH);
    if (fs.existsSync(certPath)) {
      options.cert = certPath;
      options.certPass = process.env.EFI_CERT_PASS || '';
    }
  }
} catch (e) {
  console.warn('⚠️ Erro ao verificar certificado, seguindo sem certificado:', e.message);
}

const efi = new EfiPay(options);

// DATABASE SIMPLES (JSON FILE)
const DB_PATH = path.join(__dirname, 'orders.json');

function loadOrders() {
  try {
    if (fs.existsSync(DB_PATH)) {
      return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
    }
  } catch (e) {
    console.error('Erro ao ler orders.json:', e.message);
  }
  return [];
}

function saveOrders(orders) {
  try {
    fs.writeFileSync(DB_PATH, JSON.stringify(orders, null, 2));
  } catch (e) {
    console.error('Erro ao salvar orders.json:', e.message);
  }
}

function loadPixCharges() {
  const file = path.join(__dirname, 'pix_charges.json');
  try {
    if (fs.existsSync(file)) {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    }
  } catch (e) {
    console.error('Erro ao ler pix_charges.json:', e.message);
  }
  return {};
}

function savePixCharges(charges) {
  try {
    fs.writeFileSync(path.join(__dirname, 'pix_charges.json'), JSON.stringify(charges, null, 2));
  } catch (e) {
    console.error('Erro ao salvar pix_charges.json:', e.message);
  }
}

// HEALTH CHECK
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    env: process.env.NODE_ENV || 'development',
    sandbox: useSandbox,
    version: '1.0.0'
  });
});

// 1. GERAR COBRANÇA PIX IMEDIATA
app.post('/api/pix/create-charge', async (req, res) => {
  try {
    let {
      valor,
      descricao,
      nomeCliente,
      cpfCliente,
      emailCliente,
      pedidoId
    } = req.body;

    // garantir que valor seja número
    valor = typeof valor === 'string' ? parseFloat(valor.replace(',', '.')) : valor;
    if (Number.isNaN(valor)) valor = null;

    if (!valor || !cpfCliente) {
      return res.status(400).json({ error: 'Valor e CPF são obrigatórios e devem ser válidos' });
    }

    console.log(`Criando cobrança PIX: R$ ${valor} | Pedido: ${pedidoId || 'N/A'}`);

    // Criar cobrança imediata
    const body = {
      calendario: { expiracao: 86400 }, // 24 horas
      valor: { original: Number(valor).toFixed(2) },
      chave: process.env.EFI_PIX_KEY,
      solicitacaoPagador: descricao || `Pedido NSA Store #${pedidoId || 'N/A'}`,
      infoAdicionais: [
        { nome: 'Pedido', valor: pedidoId || 'NSA-' + Date.now() },
        { nome: 'Cliente', valor: nomeCliente || 'Cliente NSA' }
      ]
    };

    const params = {};

    const resp = await efi.pixCreateImmediateCharge(params, body);

    const locId = resp?.loc?.id || resp?.loc || resp?.data?.loc;
    const txid = resp?.txid || resp?.data?.txid;

    if (!locId) {
      console.warn('Resposta da API EFI sem loc id:', resp);
      return res.status(502).json({ error: 'Resposta inválida da API de pagamento' });
    }

    console.log('Cobrança criada:', locId);

    // Salvar no banco local
    const charges = loadPixCharges();
    charges[locId] = {
      loc: locId,
      txid: txid || null,
      valor: valor,
      pedidoId: pedidoId || null,
      nomeCliente: nomeCliente || null,
      cpfCliente: cpfCliente || null,
      emailCliente: emailCliente || null,
      status: 'pending',
      createdAt: new Date().toISOString(),
      pixCopiaECola: resp?.pixCopiaECola || resp?.data?.pixCopiaECola || null,
      qrCodeBase64: resp?.qrcodeBase64 || resp?.data?.qrcodeBase64 || null
    };
    savePixCharges(charges);

    res.json({
      success: true,
      loc: locId,
      txid: txid,
      qrCode: resp?.qrcode || resp?.data?.qrcode || null,
      qrCodeBase64: resp?.qrcodeBase64 || resp?.data?.qrcodeBase64 || null,
      pixCopiaECola: resp?.pixCopiaECola || resp?.data?.pixCopiaECola || null,
      valor: valor,
      expiracao: 86400,
      pedidoId
    });

  } catch (error) {
    console.error('Erro ao criar cobrança:', error);
    res.status(500).json({
      error: error.message || 'Erro ao processar PIX',
      details: error.response?.data || null
    });
  }
});

// 2. CONSULTAR STATUS DA COBRANÇA
app.get('/api/pix/status/:loc', async (req, res) => {
  try {
    const { loc } = req.params;
    const charges = loadPixCharges();
    const charge = charges[loc];

    if (!charge) return res.status(404).json({ error: 'Cobrança não encontrada' });

    const params = { loc };
    const resp = await efi.pixDetailCharge(params);

    charge.status = resp?.status || charge.status;
    if (resp?.pix && resp.pix.length > 0) {
      charge.pixInfo = resp.pix[0];
      charge.endToEndId = resp.pix[0].endToEndId;
      charge.pagoEm = resp.pix[0].horario;
    }
    savePixCharges(charges);

    const orders = loadOrders();
    const orderIndex = orders.findIndex(o => o.id === charge.pedidoId);
    if (orderIndex !== -1 && resp?.status === 'CONCLUIDA') {
      orders[orderIndex].status = 'paid';
      orders[orderIndex].paymentStatus = 'confirmed';
      orders[orderIndex].paidAt = new Date().toISOString();
      saveOrders(orders);
    }

    res.json({
      loc,
      status: resp?.status || 'UNKNOWN',
      valor: resp?.valor?.original || null,
      pix: resp?.pix || [],
      pedidoId: charge.pedidoId,
      isPaid: resp?.status === 'CONCLUIDA'
    });

  } catch (error) {
    console.error('Erro ao consultar status:', error);
    res.status(500).json({ error: error.message, details: error.response?.data || null });
  }
});

// 3. WEBHOOK - RECEBER CONFIRMAÇÃO EFI
app.post('/api/webhook/efi', async (req, res) => {
  try {
    const evento = req.body;
    console.log('Webhook recebido:', JSON.stringify(evento));

    if (evento.evento === 'PIX_CHARGE_COMPLETED' || (evento.pix && evento.pix.length > 0)) {
      const pixData = evento.pix[0];
      const loc = evento.loc;

      console.log(`Pagamento confirmado! Loc: ${loc}`);

      const charges = loadPixCharges();
      if (charges[loc]) {
        charges[loc].status = 'CONCLUIDA';
        charges[loc].endToEndId = pixData.endToEndId;
        charges[loc].pagoEm = pixData.horario;
        charges[loc].confirmedAt = new Date().toISOString();
        savePixCharges(charges);
      }

      const orders = loadOrders();
      const order = orders.find(o => o.id === charges[loc]?.pedidoId);
      if (order) {
        order.status = 'paid';
        order.paymentStatus = 'confirmed';
        order.endToEndId = pixData.endToEndId;
        order.paidAt = new Date().toISOString();
        saveOrders(orders);
      }
    }

    res.status(200).send('OK');
  } catch (error) {
    console.error('Erro no webhook:', error);
    res.status(500).json({ error: error.message });
  }
});

// 4. CRIAR PEDIDO NO SISTEMA
app.post('/api/orders/create', async (req, res) => {
  try {
    const order = req.body;
    if (!order?.id || !order?.customer || !order?.items) {
      return res.status(400).json({ error: 'Dados do pedido incompletos' });
    }

    order.createdAt = new Date().toISOString();
    order.status = order.status || 'pending';
    order.paymentStatus = 'pending';

    const orders = loadOrders();
    orders.push(order);
    saveOrders(orders);

    console.log(`Pedido criado: ${order.id}`);

    res.json({ success: true, orderId: order.id });
  } catch (error) {
    console.error('Erro ao criar pedido:', error);
    res.status(500).json({ error: error.message });
  }
});

// 5. LISTAR PEDIDOS (ADMIN)
app.get('/api/orders', async (req, res) => {
  try {
    const orders = loadOrders();
    res.json({ success: true, orders: orders.reverse() });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 6. GERAR BOLETO (EFI)
app.post('/api/boleto/create', async (req, res) => {
  try {
    let { valor, descricao, nomeCliente, cpfCliente, emailCliente, vencimento } = req.body;
    valor = typeof valor === 'string' ? parseFloat(valor.replace(',', '.')) : valor;
    if (Number.isNaN(valor)) return res.status(400).json({ error: 'Valor inválido' });

    const body = {
      items: [
        {
          name: descricao || 'Produto NSA Store',
          amount: Math.round(valor * 100) // centavos
        }
      ],
      shippings: [{ name: 'Frete', value: 0 }],
      metadata: { notification_url: `${process.env.API_URL}/api/webhook/efi` }
    };

    const resp = await efi.createOneStepCharge(body);

    res.json({
      success: true,
      chargeId: resp?.data?.charge_id || null,
      boletoUrl: resp?.data?.link || null,
      barcode: resp?.data?.barcode || null
    });
  } catch (error) {
    console.error('Erro ao criar boleto:', error);
    res.status(500).json({ error: error.message });
  }
});

// SERVIDOR
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`
  ╔═══════════════════════════════════════╗
  ║    NSA Store - Efi Bank API           ║
  ║   Porta: ${PORT}                      ║
  ║   Ambiente: ${useSandbox ? 'HOMOLOGAÇÃO' : 'PRODUÇÃO'}        ║
  ║   Servidor rodando!                    ║
  ╚═══════════════════════════════════════╝
  `);
});
