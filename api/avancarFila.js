// api/avancarFila.js (Função HTTP para Vercel - MONITORAMENTO DA FILA)

const admin = require('firebase-admin');
const axios = require('axios');
const moment = require('moment-timezone'); // Incluído por boa prática

// =========================================================================
// INICIALIZAÇÃO DO ADMIN SDK USANDO A CHAVE JSON (Variável de Ambiente)
// =========================================================================
// O Vercel lerá o conteúdo completo do seu JSON da variável FIREBASE_SERVICE_ACCOUNT.
if (!admin.apps.length) {
    try {
        // Converte a string JSON (variável de ambiente) em um objeto
        const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
        
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
            // Não é necessário databaseURL, mas pode ser adicionado se usar Realtime Database
        });
        console.log("Firebase Admin SDK inicializado com sucesso.");
    } catch (e) {
        console.error("Erro CRÍTICO na inicialização do Firebase Admin SDK:", e.message);
        // Em caso de erro de parsing, a função não conseguirá acessar o DB.
    }
}

const db = admin.firestore();

// =========================================================================
// FUNÇÃO DE ENVIO WHATSAPP (A PARTE QUE REQUER O PLANO PAGO/GATEWAY)
// =========================================================================
async function enviarAlertaWhatsApp(numero, mensagem) {
    const url = process.env.WHATSAPP_API_URL;
    const token = process.env.WHATSAPP_AUTH_TOKEN;
    
    // ⚠️ SUBSTITUA ESTE PLACEHOLDER PELO CÓDIGO REAL DO SEU PROVEDOR DE WHATSAPP
    try {
        // Exemplo de chamada de API genérica (AJUSTE para a sintaxe do seu provedor!)
        await axios.post(url, {
            token: token,
            to: numero, // Número de destino
            body: mensagem // Mensagem com o conteúdo do alerta
        }, {
            headers: {
                'Authorization': `Bearer ${token}`,
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

// =========================================================================
// HANDLER PRINCIPAL: AVANÇO DA FILA (Monitoramento e Disparo)
// =========================================================================
module.exports = async (req, res) => {
    // 1. Validação de Método
    if (req.method !== 'POST') {
        return res.status(405).send('Método não permitido. Use POST.');
    }

    // 2. Validação de Input
    const { novaSenhaEmAtendimento } = req.body; 

    if (!novaSenhaEm Atendimento || typeof novaSenhaEmAtendimento !== 'number') {
        return res.status(400).send('Campo novaSenhaEmAtendimento (number) é obrigatório no corpo da requisição.');
    }

    try {
        // Ação 1: Atualiza o gatilho no Firestore
        await db.collection('status_operacional').doc('fila_atual').update({
            senha_em_atendimento: novaSenhaEmAtendimento,
            timestamp_ultima_atualizacao: admin.firestore.FieldValue.serverTimestamp()
        });

        // Ação 2: Busca os clientes na fila de espera
        const clientesNaFilaSnapshot = await db.collection('clientes_na_fila_hoje')
            .where('status', 'in', ['espera', 'alertado'])
            .orderBy('timestamp_entrada', 'asc')
            .limit(5)
            .get();
            
        const promisesEnvio = [];
        let contadorPosicao = 1;

        // Ação 3: Itera sobre os próximos clientes e notifica
        for (const doc of clientesNaFilaSnapshot.docs) {
            const dadosCliente = doc.data();
            const whatsappCliente = dadosCliente.whatsapp;

            if (dadosCliente.numero_senha > novaSenhaEmAtendimento) {
                let mensagemAlerta;

                if (contadorPosicao === 1) {
                    // O PRÓXIMO!
                    mensagemAlerta = `✂️ É QUASE A SUA VEZ! ✂️\n\nA senha *${novaSenhaEmAtendimento}* está em atendimento. Você é o *PRÓXIMO*! Por favor, retorne à barbearia agora.`;
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
        return res.status(500).send('Erro interno ao processar a fila. Verifique se a variável FIREBASE_SERVICE_ACCOUNT está correta.');
    }
};
