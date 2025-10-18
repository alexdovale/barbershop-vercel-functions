// CÓDIGO AJUSTADO PARA EVITAR O CRASH DO SERVIDOR (Corrigir o erro 500)

// ... (Restante do código até a linha 32) ...

// =========================================================================
// HANDLER PRINCIPAL: AVANÇO DA FILA (Corrigido)
// =========================================================================
module.exports = async (req, res) => {
    
    // ⚠️ VERIFICAÇÃO CRÍTICA DE PRÉ-CONDIÇÃO
    // Se o Admin SDK não inicializou corretamente na inicialização do módulo:
    if (admin.apps.length === 0) {
        return res.status(500).send('ERRO DE CONFIGURAÇÃO: O Admin SDK do Firebase não pôde ser inicializado. Verifique a variável FIREBASE_SERVICE_ACCOUNT.');
    }
    
    // Agora é seguro definir 'db' aqui, pois sabemos que o 'admin' está inicializado.
    const db = admin.firestore(); 

    if (req.method !== 'POST') {
        return res.status(405).send('Método não permitido. Use POST.');
    }

    const { novaSenhaEmAtendimento } = req.body; 

    if (!novaSenhaEmAtendimento || typeof novaSenhaEmAtendimento !== 'number') {
        return res.status(400).send('Campo novaSenhaEmAtendimento (number) é obrigatório no corpo da requisição.');
    }
    
    // ... (Resto do código permanece igual)
    // O seu código original deve funcionar a partir daqui.
}
