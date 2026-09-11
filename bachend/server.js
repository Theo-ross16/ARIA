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
// POSTGRESQL
// =====================================================

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
});

// =====================================================
// BASE DE DATOS
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

        await pool.query(`
            CREATE TABLE IF NOT EXISTS aria_facts (
                id SERIAL PRIMARY KEY,
                session_id VARCHAR(255) NOT NULL,
                category VARCHAR(100) NOT NULL,
                content TEXT NOT NULL,
                importance INTEGER DEFAULT 5,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        console.log("Base de datos de ARIA inicializada.");

    } catch (error) {

        console.error(
            "Error inicializando base de datos:",
            error
        );

    }
}

// =====================================================
// MEMORIA CONVERSACIONAL
// =====================================================

async function saveMemory(
    sessionId,
    role,
    content
) {

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
            "Error guardando conversación:",
            error
        );

    }
}

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
            "Error recuperando conversación:",
            error
        );

        return [];
    }
}

// =====================================================
// MEMORIA ESTRUCTURADA
// =====================================================

async function saveFact(
    sessionId,
    category,
    content,
    importance = 5
) {

    try {

        await pool.query(
            `
            INSERT INTO aria_facts
            (session_id, category, content, importance)
            VALUES ($1, $2, $3, $4)
            `,
            [
                sessionId,
                category,
                content,
                importance
            ]
        );

        return true;

    } catch (error) {

        console.error(
            "Error guardando memoria estructurada:",
            error
        );

        return false;
    }
}

async function getFacts(sessionId) {

    try {

        const result = await pool.query(
            `
            SELECT
                id,
                category,
                content,
                importance
            FROM aria_facts
            WHERE session_id = $1
            ORDER BY importance DESC, updated_at DESC
            LIMIT 100
            `,
            [sessionId]
        );

        return result.rows;

    } catch (error) {

        console.error(
            "Error recuperando memorias:",
            error
        );

        return [];
    }
}

async function deleteFacts(
    sessionId,
    searchText
) {

    try {

        const result = await pool.query(
            `
            DELETE FROM aria_facts
            WHERE session_id = $1
            AND content ILIKE $2
            `,
            [
                sessionId,
                `%${searchText}%`
            ]
        );

        return result.rowCount;

    } catch (error) {

        console.error(
            "Error eliminando memoria:",
            error
        );

        return 0;
    }
}

// =====================================================
// ANALIZAR SOLICITUD DE MEMORIA
// =====================================================

async function analyzeMemoryCommand(message) {

    try {

        const response =
            await client.responses.create({

                model: "gpt-5.6-luna",

                instructions: `
Analiza la instrucción del usuario.

Determina si está solicitando una operación de memoria
permanente.

Responde ÚNICAMENTE con JSON válido.

Formato:

{
    "action": "save" | "delete" | "none",
    "category": "fact" | "preference" | "project" | "instruction" | "context",
    "content": "texto breve de la memoria",
    "importance": 1
}

Reglas:

- "save" solamente cuando el usuario indique claramente
  que quiere que ARIA recuerde algo.
- "delete" cuando indique claramente que quiere olvidar algo.
- "none" para conversación normal.
- No conviertas preguntas normales en memorias.
- No guardes contraseñas, API keys, tokens, datos bancarios
  ni información extremadamente sensible.
- importance debe ser un número del 1 al 10.
                `,

                input: message

            });

        let text =
            response.output_text || "{}";

        text = text
            .replace(/```json/g, "")
            .replace(/```/g, "")
            .trim();

        return JSON.parse(text);

    } catch (error) {

        console.error(
            "Error analizando memoria:",
            error
        );

        return {
            action: "none"
        };
    }
}

// =====================================================
// SERVIDOR
// =====================================================

const server = http.createServer(
    async (req, res) => {

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
        // OPTIONS
        // =================================================

        if (req.method === "OPTIONS") {

            res.writeHead(204);
            res.end();

            return;
        }

        // =================================================
        // ESTADO
        // =================================================

        if (
            req.method === "GET" &&
            req.url === "/"
        ) {

            res.writeHead(200, {
                "Content-Type":
                    "application/json"
            });

            res.end(
                JSON.stringify({

                    status: "online",

                    assistant: "ARIA",

                    version: "0.3",

                    model: "gpt-5.6-luna",

                    memory:
                        "persistent + structured"

                })
            );

            return;
        }

        // =================================================
        // CHAT
        // =================================================

        if (
            req.method === "POST" &&
            req.url === "/api/chat"
        ) {

            let body = "";

            req.on(
                "data",
                chunk => {

                    body += chunk;

                }
            );

            req.on(
                "end",
                async () => {

                    try {

                        const data =
                            JSON.parse(body);

                        const message =
                            data.message || "";

                        const sessionId =
                            data.sessionId ||
                            "default-user";

                        // ---------------------------------
                        // VALIDAR
                        // ---------------------------------

                        if (!message.trim()) {

                            res.writeHead(
                                400,
                                {
                                    "Content-Type":
                                        "application/json"
                                }
                            );

                            res.end(
                                JSON.stringify({
                                    success: false,
                                    error:
                                        "Mensaje vacío"
                                })
                            );

                            return;
                        }

                        console.log(
                            "Mensaje:",
                            message
                        );

                        // ---------------------------------
                        // ANALIZAR MEMORIA
                        // ---------------------------------

                        const memoryCommand =
                            await analyzeMemoryCommand(
                                message
                            );

                        // ---------------------------------
                        // GUARDAR MEMORIA
                        // ---------------------------------

                        if (
                            memoryCommand.action ===
                            "save"
                        ) {

                            await saveFact(
                                sessionId,
                                memoryCommand.category ||
                                    "fact",
                                memoryCommand.content ||
                                    message,
                                memoryCommand.importance ||
                                    5
                            );

                            console.log(
                                "Nueva memoria guardada."
                            );
                        }

                        // ---------------------------------
                        // BORRAR MEMORIA
                        // ---------------------------------

                        if (
                            memoryCommand.action ===
                            "delete"
                        ) {

                            if (
                                memoryCommand.content
                            ) {

                                const deleted =
                                    await deleteFacts(
                                        sessionId,
                                        memoryCommand.content
                                    );

                                console.log(
                                    "Memorias eliminadas:",
                                    deleted
                                );
                            }
                        }

                        // ---------------------------------
                        // RECUPERAR CONVERSACIÓN
                        // ---------------------------------

                        const conversation =
                            await getMemory(
                                sessionId
                            );

                        // ---------------------------------
                        // RECUPERAR MEMORIAS
                        // ---------------------------------

                        const facts =
                            await getFacts(
                                sessionId
                            );

                        // ---------------------------------
                        // CONTEXTO DE MEMORIA
                        // ---------------------------------

                        let memoryContext =
                            "No hay memorias permanentes.";

                        if (facts.length > 0) {

                            memoryContext =
                                facts
                                    .map(
                                        fact =>
                                            `[${fact.category}] ${fact.content}`
                                    )
                                    .join("\n");
                        }

                        // ---------------------------------
                        // CONTEXTO CONVERSACIÓN
                        // ---------------------------------

                        const conversationInput =
                            conversation.map(
                                item => ({

                                    role:
                                        item.role ===
                                        "user"
                                            ? "user"
                                            : "assistant",

                                    content:
                                        item.content

                                })
                            );

                        conversationInput.push({

                            role: "user",

                            content: message

                        });

                        // ---------------------------------
                        // RESPUESTA DE ARIA
                        // ---------------------------------

                        const response =
                            await client.responses.create({

                                model:
                                    "gpt-5.6-luna",

                                instructions: `

Eres ARIA, un asistente avanzado
de inteligencia artificial.

Responde siempre en español,
salvo que el usuario solicite otro idioma.

Tu objetivo es ayudar al usuario de forma
clara, natural, inteligente y útil.

MEMORIA PERMANENTE DE ARIA:

${memoryContext}

Utiliza estas memorias cuando sean relevantes.

Si una memoria no es relevante para la pregunta,
ignórala.

IMPORTANTE:

No ejecutes acciones externas ni afirmes
haberlas ejecutado si no existe una herramienta
autorizada para hacerlo.

Las acciones que puedan afectar sistemas,
dispositivos, cuentas, archivos o servicios
externos requieren autorización explícita
del usuario.

Sé precisa, transparente y no inventes resultados.

Si el usuario acaba de pedir que recuerdes algo
y la memoria fue guardada correctamente,
confirma brevemente que quedó guardado.

Si el usuario pide olvidar algo y fue eliminado,
confirma brevemente que fue eliminado.

                                `,

                                input:
                                    conversationInput

                            });

                        const reply =
                            response.output_text ||
                            "No pude generar una respuesta.";

                        // ---------------------------------
                        // GUARDAR CONVERSACIÓN
                        // ---------------------------------

                        await saveMemory(
                            sessionId,
                            "user",
                            message
                        );

                        await saveMemory(
                            sessionId,
                            "assistant",
                            reply
                        );

                        console.log(
                            "Respuesta:",
                            reply
                        );

                        // ---------------------------------
                        // RESPUESTA HTTP
                        // ---------------------------------

                        res.writeHead(
                            200,
                            {
                                "Content-Type":
                                    "application/json"
                            }
                        );

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

                        res.writeHead(
                            500,
                            {
                                "Content-Type":
                                    "application/json"
                            }
                        );

                        res.end(
                            JSON.stringify({

                                success: false,

                                error:
                                    "Error comunicando con el modelo de IA"

                            })
                        );
                    }

                }
            );

            return;
        }

        // =================================================
        // 404
        // =================================================

        res.writeHead(
            404,
            {
                "Content-Type":
                    "application/json"
            }
        );

        res.end(
            JSON.stringify({
                error:
                    "Ruta no encontrada"
            })
        );

    }
);

// =====================================================
// INICIAR
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
