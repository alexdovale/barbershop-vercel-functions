// api/enviarLembretes.js (Função HTTP para ser AGENDADA por um serviço externo)

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
        console.error("Erro CRÍTICO na inicialização do Admin SDK para Lembretes:", e.message);
    }
}

const db = admin.firestore();

// =========================================================================
// CONFIGURAÇÃO DO TWILIO (Deve ser igual ao avancarFila.js)
// =========================================================================
const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.WHATSAPP_AUTH_TOKEN; 
const client = accountSid && authToken ? twilio(accountSid, authToken) : null;
const fromNumber = 'whatsapp:+14155238886'; // <-- Número do Sandbox (Remetente)

// =========================================================================
// FUNÇÃO DE ENVIO WHATSAPP (A LÓGICA DE ENVIO DO LEMBRETE)
// =========================================================================
async function enviarAlertaWhatsApp(numero, mensagem, tipoAlerta, dataHora) {
    if (!client) {
        console.error("ERRO: Cliente Twilio não inicializado.");
        return false;
    }
    
    const toNumber = `whatsapp:${numero}`;

    try {
        // Para Lembretes Agendados, você deve usar um TEMPLATE APROVADO pela Meta
        // O Twilio Sandbox permite o uso de alguns templates de teste.

        // **USANDO UM TEMPLATE DE EXEMPLO** (Substitua pelos seus valores reais)
        const contentSid = 'HXxxxxxxxxxxxxxxxxxxxxxxx'; // Substitua pelo SID real do seu template
        
        await client.messages.create({
            contentSid: contentSid,
            contentVariables: {
                // Estes são os parâmetros do seu template APROVADO
                '1': dataHora.format('DD/MM'), // Ex: 20/10
                '2': dataHora.format('HH:mm') // Ex: 14:30
            },
            from: fromNumber, 
            to: toNumber
        });
        
        return true;
    } catch (error) {
        console.error("Erro ao enviar Lembrete (Twilio):", error.message);
        // Se a chamada falhar, o motivo mais comum é o Template estar errado ou a conta não estar em produção.
        return false;
    }
}


// =========================================================================
// HANDLER PRINCIPAL: ENVIO DE LEMBRETES (Acionado pelo Cron Job Externo)
// =========================================================================
module.exports = async (req, res) => {
    // ⚠️ Idealmente, proteja este endpoint com um token secreto no header da requisição.
    
    if (req.method !== 'GET' && req.method !== 'POST') {
         return res.status(405).send('Método não permitido.');
    }
    
    try {
        const fusoHorario = 'America/Sao_Paulo'; 
        const amanha = moment().tz(fusoHorario).add(1, 'days').startOf('day');
        const depoisDeAmanha = moment().tz(fusoHorario).add(2, 'days').startOf('day');

        // 1. Busca agendamentos para o dia seguinte que ainda não foram confirmados.
        const agendamentosSnapshot = await db.collection('agendamentos_clientes')
            .where('data_hora_agendamento', '>=', amanha.toDate())
            .where('data_hora_agendamento', '<', depoisDeAmanha.toDate())
            .where('confirmacao_status', '==', 'pendente')
            .get();

        const promisesEnvio = [];
        const promisesUpdate = [];

        agendamentosSnapshot.forEach(doc => {
            const agendamento = doc.data();
            const dataHoraAgendamento = moment(agendamento.data_hora_agendamento.toDate()).tz(fusoHorario);
            
            // 2. Envia o template de lembrete
            promisesEnvio.push(enviarAlertaWhatsApp(agendamento.whatsapp, null, 'LEMBRETE', dataHoraAgendamento));
            
            // 3. Marca o agendamento para indicar que a notificação foi enviada
            promisesUpdate.push(doc.ref.update({ status_alerta: 'alerta_confirmacao_enviado' })); 
        });

        await Promise.all([...promisesEnvio, ...promisesUpdate]);
        
        return res.status(200).json({ 
            success: true, 
            message: `Lembretes enviados para ${agendamentosSnapshot.size} agendamentos pendentes.` 
        });
        
    } catch (error) {
        console.error("Erro CRÍTICO no envio de lembretes agendados:", error);
        return res.status(500).send('Erro interno no processo de agendamento.');
    }
};
