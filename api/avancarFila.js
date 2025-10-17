// api/avancarFila.js (Função HTTP para Vercel)
// Rota: SEU_DOMINIO/api/avancarFila

const admin = require('firebase-admin');
const axios = require('axios');
const moment = require('moment-timezone'); // Incluído por boa prática, mas não estritamente necessário para esta função

// Inicializa o Admin SDK APENAS se não estiver inicializado (para evitar erros em ambientes serverless)
// Esta função lê a variável FIREBASE_SERVICE_ACCOUNT do Vercel
if (!admin.apps.length) {
    // ⚠️ ATENÇÃO: É VITAL QUE O CONTEÚDO DO JSON ESTEJA CORRETAMENTE FORMATADO NO VERCEL
    try {
        const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
        });
    } catch (e) {
        console.error("Erro ao inicializar Firebase Admin SDK:", e);
        // Em caso de erro de parsing, a função não deve prosseguir
        // Pode ser útil para debugging no Vercel logs
    }
}

const db = admin.firestore();

// Funções de envio (Substitua a lógica do axios pela do seu provedor de WhatsApp!)
async function enviarAlertaWhatsApp(numero, mensagem) {
    const url = process.env.WHATSAPP_API_URL;
    const token = process.env.WHATSAPP_AUTH_TOKEN;
    
    // ESTE É O CÓDIGO DO PLACEHOLDER - SUBSTITUA PELO CÓDIGO REAL DO SEU PROVEDOR DE WHATSAPP
    try {
        // Exemplo: Simulação de uma chamada de API (Substitua por axios.post ou fetch real)
        await axios.post(url, {
            token: token,
            to: numero,
            body: mensagem 
        }, {
            headers: {
                'Authorization': `Bearer ${token}`, // Ou o cabeçalho exigido
                'Content-Type': 'application/json'
            }
        });
        console.log(`Alerta WhatsApp enviado para ${numero}`);
        return true;
    } catch (error) {
        console.error("Erro ao enviar WhatsApp:", error.response ? error.response.data : error.message);
        return false;
    }
}

// Handler da requisição HTTP (endpoint principal)
module.exports = async (req, res) => {
    // Apenas requisições POST são aceitas para avançar a fila
    if (req.method !== 'POST') {
        return res.status(405).send('Método não permitido. Use POST.');
    }

    // O Barbeiro envia a nova senha em atendimento no corpo da requisição POST (via App)
    const { novaSenhaEmAtendimento } = req.body; 

    if (!novaSenhaEmAtendimento || typeof novaSenhaEmAtendimento !== 'number') {
        return res.status(400).send('Campo novaSenhaEmAtendimento (number) é obrigatório.');
    }

    try {
        // Ação 1: Atualiza a senha no Firestore (Gatilho visual para o App do Cliente)
        await db.collection('status_operacional').doc('fila_atual').update({
            senha_em_atendimento: novaSenhaEmAtendimento,
            timestamp_ultima_atualizacao: admin.firestore.FieldValue.serverTimestamp() // Para rastreio
        });

        // Ação 2: Busca os clientes na fila para notificar
        const clientesNaFilaSnapshot = await db.collection('clientes_na_fila_hoje')
            .where('status', 'in', ['espera', 'alertado'])
            .orderBy('timestamp_entrada', 'asc') // Ordem de chegada
            .limit(5) // Limite de notificações para economia
            .get();
            
        const promisesEnvio = [];
        let contadorPosicao = 1;

        for (const doc of clientesNaFilaSnapshot.docs) {
            const dadosCliente = doc.data();
            const whatsappCliente = dadosCliente.whatsapp;

            // Condição: O número da senha do cliente deve ser maior que o que está sendo chamado agora.
            if (dadosCliente.numero_senha > novaSenhaEmAtendimento) {
                let mensagemAlerta;

                if (contadorPosicao === 1) {
                    // PRIMEIRO DA FILA (O PRÓXIMO): Alerta Forte
                    mensagemAlerta = `✂️ É QUASE A SUA VEZ! ✂️\n\nA senha *${novaSenhaEmAtendimento}* está em atendimento. Você é o *PRÓXIMO*! Por favor, retorne à barbearia agora.`;
                    // Marca como 'alertado'
                    promisesEnvio.push(doc.ref.update({ status: 'alertado' }));
                } else if (contadorPosicao <= 3) {
                    // PRÓXIMOS (Atualização de posição)
                    mensagemAlerta = `💈 ATUALIZAÇÃO DA FILA 💈\n\nA fila avançou! Você está em *${contadorPosicao}º* lugar na fila.`;
                } else {
                    break; // Para de notificar clientes muito distantes
                }

                promisesEnvio.push(enviarAlertaWhatsApp(whatsappCliente, mensagemAlerta));
            }
            contadorPosicao++;
        }

        await Promise.all(promisesEnvio);
        return res.status(200).json({ 
            success: true, 
            message: `Fila atualizada para ${novaSenhaEmAtendimento}. Alertas de WhatsApp disparados.` 
        });

    } catch (error) {
        console.error("Erro CRÍTICO no avanço da fila:", error);
        return res.status(500).send('Erro interno ao processar a fila. Verifique os logs do Vercel.');
    }
};
