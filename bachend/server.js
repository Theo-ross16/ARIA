const http = require("http");
const OpenAI = require("openai");
const { Pool } = require("pg");

const PORT = process.env.PORT || 3000;

// =====================================================
// OPENAI
// =====================================================

const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

// =====================================================
// POSTGRESQL — MEMORIA PERSISTENTE
// =====================================================

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
});

// =====================================================
// INICIALIZAR BASE DE DATOS
// =====================================================

async function initializeDatabase() {

    try {

        await pool.query(`
            CREATE TABLE IF NOT EXISTS aria_memory (
                id SERIAL PRIMARY KEY,
                session_id VARCHAR(255) NOT NULL,
                role VARCHAR(50) NOT NULL,
                content TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        console.log("Memoria de ARIA inicializada correctamente.");

    } catch (error) {

        console.error(
            "Error inicializando la memoria:",
            error
        );

    }
}

// =====================================================
// GUARDAR MEMORIA
// =====================================================

async function saveMemory(sessionId, role, content) {

    try {

        await pool.query(
            `
            INSERT INTO aria_memory
            (session_id, role, content)
            VALUES ($1, $2, $3)
            `,
            [
                sessionId,
                role,
                content
            ]
        );

    } catch (error) {

        console.error(
            "Error guardando memoria:",
            error
        );

    }
}

// =====================================================
// RECUPERAR MEMORIA
// =====================================================

async function getMemory(sessionId) {

    try {

        const result = await pool.query(
            `
            SELECT role, content
            FROM aria_memory
            WHERE session_id = $1
            ORDER BY created_at ASC
            LIMIT 50
            `,
            [sessionId]
        );

        return result.rows;

    } catch (error) {

        console.error(
            "Error recuperando memoria:",
            error
        );

        return [];
    }
}

// =====================================================
// SERVIDOR
// =====================================================

const server = http.createServer(async (req, res) => {

    // =================================================
    // CORS
    // =================================================

    res.setHeader(
        "Access-Control-Allow-Origin",
        "*"
    );

    res.setHeader(
        "Access-Control-Allow-Methods",
        "GET, POST, OPTIONS"
    );

    res.setHeader(
        "Access-Control-Allow-Headers",
        "Content-Type"
    );

    // =================================================
    // PREFLIGHT
    // =================================================

    if (req.method === "OPTIONS") {

        res.writeHead(204);
        res.end();

        return;
    }

    // =================================================
    // ESTADO DEL SERVIDOR
    // =================================================

    if (
        req.method === "GET" &&
        req.url === "/"
    ) {

        res.writeHead(200, {
            "Content-Type": "application/json"
        });

        res.end(
            JSON.stringify({
                status: "online",
                assistant: "ARIA",
                version: "0.3",
                model: "gpt-5.6-luna",
                memory: "persistent"
            })
        );

        return;
    }

    // =================================================
    // CHAT DE ARIA
    // =================================================

    if (
        req.method === "POST" &&
        req.url === "/api/chat"
    ) {

        let body = "";

        req.on("data", chunk => {

            body += chunk;

        });

        req.on("end", async () => {

            try {

                const data = JSON.parse(body);

                const message =
                    data.message || "";

                // -----------------------------------------
                // IDENTIFICADOR DE SESIÓN
                // -----------------------------------------

                const sessionId =
                    data.sessionId ||
                    "default-user";

                // -----------------------------------------
                // VALIDAR MENSAJE
                // -----------------------------------------

                if (!message.trim()) {

                    res.writeHead(400, {
                        "Content-Type":
                            "application/json"
                    });

                    res.end(
                        JSON.stringify({
                            success: false,
                            error: "Mensaje vacío"
                        })
                    );

                    return;
                }

                console.log(
                    "Mensaje recibido:",
                    message
                );

                // -----------------------------------------
                // RECUPERAR MEMORIA
                // -----------------------------------------

                const memory =
                    await getMemory(sessionId);

                // -----------------------------------------
                // CONSTRUIR CONTEXTO
                // -----------------------------------------

                const conversation = memory.map(
                    item => ({
                        role:
                            item.role === "user"
                                ? "user"
                                : "assistant",
                        content: item.content
                    })
                );

                conversation.push({
                    role: "user",
                    content: message
                });

                // -----------------------------------------
                // GUARDAR MENSAJE DEL USUARIO
                // -----------------------------------------

                await saveMemory(
                    sessionId,
                    "user",
                    message
                );

                // -----------------------------------------
                // MODELO
                // -----------------------------------------

                const response =
                    await client.responses.create({

                        model: "gpt-5.6-luna",

                        instructions: `
Eres ARIA, un asistente avanzado de inteligencia artificial.

Tu objetivo es ayudar al usuario de forma clara,
natural, inteligente y útil.

Responde siempre en español, salvo que el usuario
solicite otro idioma.

Puedes explicar conceptos, analizar información,
ayudar a programar y colaborar en la construcción
del sistema ARIA.

ARIA dispone de memoria persistente.

Utiliza el contexto de conversación proporcionado
para mantener continuidad y coherencia.

IMPORTANTE:

No ejecutes acciones externas ni afirmes haberlas
ejecutado si no existe una herramienta autorizada
para hacerlo.

Las acciones que puedan afectar sistemas,
dispositivos, cuentas, archivos o servicios externos
requieren autorización explícita del usuario.

Sé precisa, transparente y no inventes resultados.
                        `,

                        input: conversation

                    });

                const reply =
                    response.output_text ||
                    "No pude generar una respuesta.";

                console.log(
                    "Respuesta de ARIA:",
                    reply
                );

                // -----------------------------------------
                // GUARDAR RESPUESTA
                // -----------------------------------------

                await saveMemory(
                    sessionId,
                    "assistant",
                    reply
                );

                // -----------------------------------------
                // RESPUESTA
                // -----------------------------------------

                res.writeHead(200, {
                    "Content-Type":
                        "application/json"
                });

                res.end(
                    JSON.stringify({
                        success: true,
                        reply: reply
                    })
                );

            } catch (error) {

                console.error(
                    "ERROR ARIA:",
                    error
                );

                res.writeHead(500, {
                    "Content-Type":
                        "application/json"
                });

                res.end(
                    JSON.stringify({
                        success: false,
                        error:
                            "Error comunicando con el modelo de IA"
                    })
                );
            }

        });

        return;
    }

    // =================================================
    // RUTA INEXISTENTE
    // =================================================

    res.writeHead(404, {
        "Content-Type":
            "application/json"
    });

    res.end(
        JSON.stringify({
            error: "Ruta no encontrada"
        })
    );
});

// =====================================================
// INICIAR SERVIDOR
// =====================================================

async function startServer() {

    await initializeDatabase();

    server.listen(
        PORT,
        () => {

            console.log(
                `ARIA backend funcionando en el puerto ${PORT}`
            );

        }
    );
}

startServer();
