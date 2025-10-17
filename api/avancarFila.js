// api/avancarFila.js (Função HTTP para Vercel - MONITORAMENTO DA FILA)

const admin = require('firebase-admin');
const axios = require('axios');
const twilio = require('twilio'); // SDK do Twilio
const moment = require('moment-timezone');

// =========================================================================
// INICIALIZAÇÃO DO ADMIN SDK 
// =========================================================================
if (!admin.apps.length) {
    try {
        const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
        });
    } catch (e) {
        console.error("Erro CRÍTICO na inicialização do Firebase Admin SDK:", e.message);
        // Não lançar exceção aqui permite que o log de erro apareça no Vercel
    }
}

const db = admin.firestore();

// =========================================================================
// CONFIGURAÇÃO DO TWILIO
// =========================================================================
const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.WHATSAPP_AUTH_TOKEN; 
// O Twilio client só será criado se as credenciais estiverem disponíveis.
const client = accountSid && authToken ? twilio(accountSid, authToken) : null;
const fromNumber = 'whatsapp:+14155238886'; // <-- Número do Sandbox (Remetente)

// =========================================================================
// FUNÇÃO DE ENVIO WHATSAPP
// =========================================================================
async function enviarAlertaWhatsApp(numero, mensagem, tipoAlerta) {
    if (!client) {
        console.error("ERRO: Cliente Twilio não inicializado. Verifique as variáveis de ambiente.");
        return false;
    }
    
    // O número de destino deve ser prefixado com 'whatsapp:'
    const toNumber = `whatsapp:${numero}`;

    // A lógica de alerta da fila é uma mensagem de formato livre (dentro da janela de 24h)
    // O Twilio Sandbox permite mensagens de formato livre.
    try {
        await client.messages.create({
            body: mensagem,
            from: fromNumber, 
            to: toNumber
        });

        console.log(`Alerta WhatsApp enviado para ${numero}`);
        return true;
        
    } catch (error) {
        console.error("Erro ao enviar WhatsApp (Twilio):", error.message);
        return false;
    }
}

// =========================================================================
// HANDLER PRINCIPAL: AVANÇO DA FILA
// =========================================================================
module.exports = async (req, res) => {
    if (req.method !== 'POST') {
        return res.status(405).send('Método não permitido. Use POST.');
    }

    const { novaSenhaEmAtendimento } = req.body; 

    if (!novaSenhaEmAtendimento || typeof novaSenhaEmAtendimento !== 'number') {
        return res.status(400).send('Campo novaSenhaEmAtendimento (number) é obrigatório no corpo da requisição.');
    }

    try {
        // 1. Atualiza o gatilho no Firestore (Usa Admin SDK)
        await db.collection('status_operacional').doc('fila_atual').update({
            senha_em_atendimento: novaSenhaEmAtendimento,
            timestamp_ultima_atualizacao: admin.firestore.FieldValue.serverTimestamp()
        });

        // 2. Busca os clientes na fila de espera
        const clientesNaFilaSnapshot = await db.collection('clientes_na_fila_hoje')
            .where('status', 'in', ['espera', 'alertado'])
            .orderBy('timestamp_entrada', 'asc')
            .limit(5)
            .get();
            
        const promisesEnvio = [];
        let contadorPosicao = 1;

        // 3. Notifica os clientes
        for (const doc of clientesNaFilaSnapshot.docs) {
            const dadosCliente = doc.data();
            const whatsappCliente = dadosCliente.whatsapp;

            if (dadosCliente.numero_senha > novaSenhaEmAtendimento) {
                let mensagemAlerta;

                if (contadorPosicao === 1) {
                    mensagemAlerta = `✂️ É QUASE A SUA VEZ! ✂️\n\nA senha *${novaSenhaEmAtendimento}* está em atendimento. Você é o *PRÓXIMO*! Por favor, retorne à barbearia agora.`;
                    promisesEnvio.push(doc.ref.update({ status: 'alertado' }));
                } else if (contadorPosicao <= 3) {
                    mensagemAlerta = `💈 ATUALIZAÇÃO DA FILA 💈\n\nA fila avançou! Você está em *${contadorPosicao}º* lugar na fila.`;
                } else {
                    break; 
                }

                promisesEnvio.push(enviarAlertaWhatsApp(whatsappCliente, mensagemAlerta, 'FILA'));
            }
            contadorPosicao++;
        }

        await Promise.all(promisesEnvio);
        return res.status(200).json({ success: true, message: `Fila atualizada para ${novaSenhaEmAtendimento}. Alertas disparados.` });

    } catch (error) {
        console.error("Erro CRÍTICO no avanço da fila:", error);
        return res.status(500).send('Erro interno ao processar a fila. Verifique os logs e a conexão com o Firebase.');
    }
};
