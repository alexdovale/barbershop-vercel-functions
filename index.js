const functions = require('firebase-functions');
const admin = require('firebase-admin');
const twilio = require('twilio');
const moment = require('moment-timezone');

// Inicialização NATIVA: O Firebase cuida das credenciais.
admin.initializeApp();
const db = admin.firestore();

// Acessa as variáveis de ambiente Twilio definidas no Firebase CLI
const TWILIO_SID = functions.config().twilio.sid;
const TWILIO_TOKEN = functions.config().twilio.token;
const TWILIO_WHATSAPP_FROM = functions.config().twilio.whatsapp_from; 

// Cria o cliente Twilio
const twilioClient = twilio(TWILIO_SID, TWILIO_TOKEN);
const FUSO_HORARIO = 'America/Sao_Paulo';

// --- FUNÇÃO AUXILIAR DE ENVIO WHATSAPP ---
async function enviarAlertaWhatsApp(numero, mensagem, isTemplate = false) {
    const to = `whatsapp:${numero}`;
    
    // Configuração para envio via Twilio
    const bodyParams = isTemplate ? { 
        // ⚠️ SUBSTITUA 'HX...' pelo SID do seu Template APROVADO
        contentSid: 'HXxxxxxxxxxxxxxxxxxxxxxxx', 
        contentVariables: { '1': 'hora', '2': 'barbeiro' } // Ajuste os placeholders
    } : { 
        body: mensagem 
    }; 

    try {
        await twilioClient.messages.create({
            ...bodyParams,
            from: TWILIO_WHATSAPP_FROM,
            to: to
        });
        return true;
    } catch (error) {
        console.error("ERRO TWILIO DE ENVIO:", error.message);
        return false;
    }
}

// =========================================================================
// 1. MÓDULO DE FILA EM TEMPO REAL (Gatilho: onUpdate no Firestore)
// =========================================================================
exports.avancarFila = functions.firestore
    .document('status_operacional/fila_atual')
    .onUpdate(async (change, context) => {
        const novaSenhaEmAtendimento = change.after.data().senha_em_atendimento;
        
        const clientesNaFilaSnapshot = await db.collection('clientes_na_fila_hoje')
            .where('status', 'in', ['espera', 'alertado'])
            .orderBy('timestamp_entrada', 'asc')
            .limit(3)
            .get();
            
        const promisesEnvio = [];
        let contadorPosicao = 1;

        for (const doc of clientesNaFilaSnapshot.docs) {
            const dadosCliente = doc.data();
            const whatsappCliente = dadosCliente.whatsapp;

            if (dadosCliente.numero_senha > novaSenhaEmAtendimento && contadorPosicao <= 3) {
                let mensagemAlerta;

                if (contadorPosicao === 1) {
                    mensagemAlerta = `✂️ É SUA VEZ! Senha *${novaSenhaEmAtendimento}* em atendimento. Você é o PRÓXIMO! Retorne.`;
                    promisesEnvio.push(doc.ref.update({ status: 'alertado' }));
                } else {
                    mensagemAlerta = `💈 ATUALIZAÇÃO DA FILA 💈\nVocê avançou! Está em ${contadorPosicao}º lugar na fila.`;
                }

                promisesEnvio.push(enviarAlertaWhatsApp(whatsappCliente, mensagemAlerta, false));
                contadorPosicao++;
            }
        }

        await Promise.all(promisesEnvio);
        return null;
    });

// =========================================================================
// 2. MÓDULO DE LEMBRETES AGENDADOS (Gatilho: Diário agendado)
// =========================================================================
exports.enviarLembretesAgendados = functions.pubsub.schedule('0 20 * * *') // Todo dia às 20:00h
    .timeZone(FUSO_HORARIO) 
    .onRun(async (context) => {
        const amanha = moment().tz(FUSO_HORARIO).add(1, 'days').startOf('day');
        const depoisDeAmanha = moment().tz(FUSO_HORARIO).add(2, 'days').startOf('day');

        const agendamentosSnapshot = await db.collection('agendamentos_clientes')
            .where('data_hora_agendamento', '>=', amanha.toDate())
            .where('data_hora_agendamento', '<', depoisDeAmanha.toDate())
            .where('confirmacao_status', '==', 'pendente')
            .get();

        const promisesEnvio = [];
        const promisesUpdate = [];

        agendamentosSnapshot.forEach(doc => {
            const agendamento = doc.data();
            const horaFormatada = moment(agendamento.data_hora_agendamento.toDate()).tz(FUSO_HORARIO).format('HH:mm');
            
            // O envio de lembretes AGENDADOS exige TEMPLATE APROVADO pela Meta.
            const templateParams = { '1': horaFormatada, '2': agendamento.barbeiro_nome || 'seu barbeiro' };
            
            promisesEnvio.push(enviarAlertaWhatsApp(agendamento.whatsapp, null, true, templateParams));
            
            promisesUpdate.push(doc.ref.update({ status_alerta: 'alerta_confirmacao_enviado' })); 
        });

        await Promise.all([...promisesEnvio, ...promisesUpdate]);
        return null;
    });
