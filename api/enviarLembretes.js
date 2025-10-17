// api/enviarLembretes.js (Função HTTP para ser AGENDADA por um serviço externo)
// Rota: SEU_DOMINIO/api/enviarLembretes

const admin = require('firebase-admin');
const axios = require('axios');
const moment = require('moment-timezone');

// =========================================================================
// INICIALIZAÇÃO DO ADMIN SDK 
// =========================================================================
// O Vercel lerá o conteúdo do seu JSON da variável FIREBASE_SERVICE_ACCOUNT.
if (!admin.apps.length) {
    try {
        const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
        });
        console.log("Firebase Admin SDK inicializado com sucesso para Lembretes.");
    } catch (e) {
        console.error("Erro CRÍTICO na inicialização do Admin SDK para Lembretes:", e.message);
    }
}

const db = admin.firestore();

// Funções de envio (Reutiliza a lógica do WhatsApp do seu provedor)
async function enviarAlertaWhatsApp(numero, mensagem) {
    const url = process.env.WHATSAPP_API_URL;
    const token = process.env.WHATSAPP_AUTH_TOKEN;
    
    // ⚠️ SUBSTITUA ESTE PLACEHOLDER PELO CÓDIGO REAL DO SEU PROVEDOR DE WHATSAPP
    try {
        await axios.post(url, {
            token: token,
            to: numero,
            body: mensagem 
        }, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });
        return true;
    } catch (error) {
        console.error("Erro ao enviar WhatsApp agendado:", error.response ? error.response.data : error.message);
        return false;
    }
}


// =========================================================================
// HANDLER PRINCIPAL: ENVIO DE LEMBRETES (Acionado pelo Cron Job Externo)
// =========================================================================
module.exports = async (req, res) => {
    // ⚠️ Idealmente, adicione uma chave de segurança aqui para garantir que SÓ o seu cron job chame este endpoint (Ex: verificar um token secreto no header da requisição).
    
    // Permite que o Cron Job faça chamadas GET ou POST simples
    if (req.method !== 'GET' && req.method !== 'POST') {
         return res.status(405).send('Método não permitido.');
    }
    
    try {
        // Define o intervalo de busca para o dia seguinte (00:00 a 23:59)
        const fusoHorario = 'America/Sao_Paulo'; // Mantenha o fuso horário da barbearia
        const amanha = moment().tz(fusoHorario).add(1, 'days').startOf('day');
        const depoisDeAmanha = moment().tz(fusoHorario).add(2, 'days').startOf('day');

        // Busca agendamentos para o dia seguinte que AINDA NÃO FORAM CONFIRMADOS.
        const agendamentosSnapshot = await db.collection('agendamentos_clientes')
            .where('data_hora_agendamento', '>=', amanha.toDate())
            .where('data_hora_agendamento', '<', depoisDeAmanha.toDate())
            .where('confirmacao_status', '==', 'pendente')
            .get();

        const promisesEnvio = [];
        const promisesUpdate = [];

        agendamentosSnapshot.forEach(doc => {
            const agendamento = doc.data();
            const horaFormatada = moment(agendamento.data_hora_agendamento.toDate()).tz(fusoHorario).format('HH:mm');
            const barbeiroNome = agendamento.barbeiro_nome || 'o seu profissional';
            
            // Mensagem com o pedido de resposta SIM/NÃO
            const mensagem = `🗓️ Lembrete Barbershop Cloud 🗓️\n\nOlá ${agendamento.nome_cliente},\n\nSeu horário com ${barbeiroNome} é *amanhã* às *${horaFormatada}h*. Para GARANTIR, por favor, *responda SIM* a esta mensagem dentro de 2 horas.`;
            
            promisesEnvio.push(enviarAlertaWhatsApp(agendamento.whatsapp, mensagem));
            
            // Marca o agendamento para indicar que a notificação de confirmação foi enviada
            promisesUpdate.push(doc.ref.update({ status_alerta: 'alerta_confirmacao_enviado' })); 
        });

        await Promise.all([...promisesEnvio, ...promisesUpdate]);
        
        return res.status(200).json({ 
            success: true, 
            message: `Lembretes enviados para ${agendamentosSnapshot.size} agendamentos pendentes.` 
        });
        
    } catch (error) {
        console.error("Erro CRÍTICO no envio de lembretes agendados:", error);
        return res.status(500).send('Erro interno no processo de agendamento. Verifique logs e variáveis de ambiente.');
    }
};
