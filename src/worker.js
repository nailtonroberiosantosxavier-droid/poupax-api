export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname } = url;
    const ASAAS_TOKEN = env.ASAAS_TOKEN;
    const ASAAS_URL = "https://sandbox.asaas.com/api/v3"; // Troca pra prod quando aprovar

    // Rota: GET /saldo/cus_xxx
    if (pathname.startsWith('/saldo/') && request.method === 'GET') {
      const cid = pathname.split('/')[2];
      const { results } = await env.DB.prepare(
        "SELECT saldo FROM saldos WHERE cliente_id =?"
      ).bind(cid).all();
      return Response.json({ cliente: cid, saldo: results[0]?.saldo || 0 });
    }

    // Rota: GET /gerar_pix/cus_xxx/10.50
    if (pathname.startsWith('/gerar_pix/') && request.method === 'GET') {
      const [,, cid, valor] = pathname.split('/');
      const r = await fetch(`${ASAAS_URL}/payments`, {
        method: 'POST',
        headers: { "access_token": ASAAS_TOKEN, "Content-Type": "application/json" },
        body: JSON.stringify({
          customer: cid,
          billingType: "PIX",
          value: parseFloat(valor),
          dueDate: new Date().toISOString().split('T')[0]
        })
      });
      const data = await r.json();
      return Response.json({ 
        qr_code: data.pixTransaction?.qrCode?.payload || null,
        id: data.id 
      });
    }

    // Rota: POST /saque_pix
    if (pathname === '/saque_pix' && request.method === 'POST') {
      const { cliente_id, valor, chave_pix } = await request.json();
      const { results } = await env.DB.prepare("SELECT saldo FROM saldos WHERE cliente_id =?").bind(cliente_id).all();
      const saldo = results[0]?.saldo || 0;
      if (saldo < valor) return Response.json({ erro: "Saldo insuficiente" }, { status: 400 });

      const r = await fetch(`${ASAAS_URL}/transfers`, {
        method: 'POST',
        headers: { "access_token": ASAAS_TOKEN, "Content-Type": "application/json" },
        body: JSON.stringify({
          value: valor,
          pixAddressKey: chave_pix,
          pixAddressKeyType: "CPF", // ou EMAIL, PHONE
          operationType: "PIX"
        })
      });
      if (r.ok) {
        await env.DB.prepare("UPDATE saldos SET saldo = saldo -? WHERE cliente_id =?").bind(valor, cliente_id).run();
        await env.DB.prepare("INSERT INTO transacoes (cliente_id, tipo, valor) VALUES (?, 'SAQUE',?)").bind(cliente_id, valor).run();
      }
      return Response.json(await r.json());
    }

    // Rota: POST /webhook - Asaas chama aqui
    if (pathname === '/webhook' && request.method === 'POST') {
      const d = await request.json();
      if (d.event === 'PAYMENT_RECEIVED') {
        const cid = d.payment.customer;
        const valor = parseFloat(d.payment.value);
        await env.DB.prepare(
          "INSERT INTO saldos (cliente_id, saldo) VALUES (?,?) ON CONFLICT(cliente_id) DO UPDATE SET saldo = saldo +?"
        ).bind(cid, valor, valor).run();
        await env.DB.prepare("INSERT INTO transacoes (cliente_id, tipo, valor) VALUES (?, 'DEPOSITO',?)").bind(cid, valor).run();
      }
      return Response.json({ status: "ok" });
    }

    return new Response('POUPAX API Online', { status: 200 });
  }
          }
