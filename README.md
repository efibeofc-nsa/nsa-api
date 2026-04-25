# nsa-api

Proxy API para login e integração Efipay (Pix).

## Arquivos incluídos
- index.js
- routes/auth.js
- routes/pix.js
- utils/efipay.js
- .env.example
- package.json

## Como rodar localmente
1. Copie `.env.example` para `.env` e preencha as variáveis.
2. `npm install`
3. `npm start`

## Deploy no Railway
1. Commit e push dos arquivos para o repositório.
2. No Railway, crie um novo service apontando para o repositório `nsa-api`.
3. Configure variáveis de ambiente no Railway:
   - EFIPAY_CLIENT_ID
   - EFIPAY_CLIENT_SECRET
   - EFIPAY_ENV
   - LOGIN_API_URL
   - CORS_ORIGIN
4. Deploy automático iniciará quando o Railway detectar `package.json`.

## Observações
- **Nunca** coloque EFIPAY_CLIENT_SECRET no frontend.
- Ajuste os endpoints Efipay em `utils/efipay.js` conforme a documentação oficial.
