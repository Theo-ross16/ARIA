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
// =====================================================
// ELIMINAR MEMORIAS POR ID
// =====================================================
async function deleteFactsByIds(
    sessionId,
    ids
) {
    try {
        if (
            !Array.isArray(ids) ||
            ids.length === 0
        ) {
            return 0;
        }
        const cleanIds = ids
            .map(id => Number(id))
            .filter(id => Number.isInteger(id));
        if (cleanIds.length === 0) {
            return 0;
        }
        const result = await pool.query(
            `
            DELETE FROM aria_facts
            WHERE session_id = $1
            AND id = ANY($2::int[])
            `,
            [
                sessionId,
                cleanIds
            ]
        );
        return result.rowCount;
    } catch (error) {
        console.error(
            "Error eliminando memorias:",
            error
        );
        return 0;
    }
}
// =====================================================
// ANALIZAR SOLICITUD DE MEMORIA
// =====================================================
async function analyzeMemoryCommand(
    message,
    facts = []
) {
    try {
        const memoryList =
            facts.length > 0
                ? facts
                    .map(
                        fact =>
                            `ID: ${fact.id} | Categoría: ${fact.category} | Memoria: ${fact.content}`
                    )
                    .join("\n")
                : "No hay memorias guardadas.";
        const response =
            await client.responses.create({
                model: "gpt-5.6-luna",
                instructions: `
Analiza la instrucción del usuario respecto a la
memoria permanente de ARIA.
Responde ÚNICAMENTE con JSON válido.
FORMATO:
{
    "action": "save" | "delete" | "none",
    "category": "fact" | "preference" | "project" | "instruction" | "context",
    "content": "texto breve de la memoria",
    "importance": 1,
    "deleteIds": []
}
REGLAS:
1. "save":
Úsalo solamente cuando el usuario indique claramente
que quiere que ARIA recuerde algo.
Ejemplos:
"Recuerda que mi proyecto se llama ARIA."
"Guarda que prefiero respuestas cortas."
"Quiero que recuerdes esto."
2. "delete":
Úsalo cuando el usuario indique claramente que quiere
olvidar, borrar o eliminar una memoria.
Ejemplos:
"Olvida mi nombre."
"Olvida el nombre de mi proyecto."
"Borra esa memoria."
"Elimina lo que recuerdas sobre mi proyecto."
"No recuerdes esto."
3. "none":
Úsalo para conversación normal.
4. No conviertas preguntas normales en memorias.
5. Nunca guardes:
- contraseñas
- API keys
- tokens
- datos bancarios
- información extremadamente sensible
6. importance debe ser un número entre 1 y 10.
7. Si action es "delete", revisa las memorias existentes
que aparecen abajo.
8. Selecciona en "deleteIds" los IDs de las memorias que
correspondan exactamente o conceptualmente a lo que el
usuario quiere olvidar.
9. No necesitas que las palabras sean idénticas.
Por ejemplo:
Memoria:
"El proyecto principal del usuario se llama ARIA."
Solicitud:
"Olvida el nombre de mi proyecto principal."
Debes identificar esa memoria y devolver su ID.
10. Si el usuario quiere olvidar una memoria y existe
una memoria claramente relacionada, incluye su ID en
deleteIds.
11. Si no existe ninguna memoria relacionada,
devuelve:
"deleteIds": []
12. Para "save", deleteIds debe ser [].
13. Para "none", deleteIds debe ser [].
MEMORIAS EXISTENTES:
${memoryList}
                `,
                input: message
            });
        let text =
            response.output_text || "{}";
        text = text
            .replace(/```json/g, "")
            .replace(/```/g, "")
            .trim();
        const result = JSON.parse(text);
        if (!Array.isArray(result.deleteIds)) {
            result.deleteIds = [];
        }
        return result;
    } catch (error) {
        console.error(
            "Error analizando memoria:",
            error
        );
        return {
            action: "none",
            deleteIds: []
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
            res.writeHead(
                200,
                {
                    "Content-Type":
                        "application/json"
                }
            );
            res.end(
                JSON.stringify({
                    status: "online",
                    assistant: "ARIA",
                    version: "0.4",
                    model: "gpt-5.6-luna",
                    memory:
                        "persistent + structured",
                    memoryDelete:
                        "enabled"
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
                        // RECUPERAR MEMORIAS EXISTENTES
                        // ---------------------------------
                        const existingFacts =
                            await getFacts(
                                sessionId
                            );
                        // ---------------------------------
                        // ANALIZAR MEMORIA
                        // ---------------------------------
                        const memoryCommand =
                            await analyzeMemoryCommand(
                                message,
                                existingFacts
                            );
                        console.log(
                            "Comando de memoria:",
                            memoryCommand
                        );
                        // ---------------------------------
                        // GUARDAR MEMORIA
                        // ---------------------------------
                        let memorySaved = false;
                        if (
                            memoryCommand.action ===
                            "save"
                        ) {
                            memorySaved =
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
                                "Nueva memoria guardada:",
                                memorySaved
                            );
                        }
                        // ---------------------------------
                        // BORRAR MEMORIA
                        // ---------------------------------
                        let memoriesDeleted = 0;
                        if (
                            memoryCommand.action ===
                            "delete"
                        ) {
                            memoriesDeleted =
                                await deleteFactsByIds(
                                    sessionId,
                                    memoryCommand.deleteIds
                                );
                            console.log(
                                "IDs solicitados para eliminar:",
                                memoryCommand.deleteIds
                            );
                            console.log(
                                "Memorias eliminadas:",
                                memoriesDeleted
                            );
                        }
                        // ---------------------------------
                        // RECUPERAR CONVERSACIÓN
                        // ---------------------------------
                        const conversation =
                            await getMemory(
                                sessionId
                            );
                        // ---------------------------------
                        // RECUPERAR MEMORIAS ACTUALIZADAS
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
                        if (
                            facts.length > 0
                        ) {
                            memoryContext =
                                facts
                                    .map(
                                        fact =>
                                            `[ID ${fact.id}] [${fact.category}] ${fact.content}`
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
=================================================
MEMORIA PERMANENTE
=================================================
Estas son las memorias permanentes que actualmente
existen en la base de datos:
${memoryContext}
Utiliza estas memorias solamente cuando sean
relevantes para la conversación.
Si una memoria no es relevante para la pregunta,
ignórala.
=================================================
GESTIÓN DE MEMORIA
=================================================
El backend de ARIA tiene capacidad para:
- guardar memorias permanentes
- recuperar memorias permanentes
- eliminar memorias permanentes
Cuando el usuario solicita recordar algo,
el backend procesa la solicitud antes de generar
esta respuesta.
Cuando el usuario solicita olvidar algo,
el backend identifica las memorias relacionadas
y las elimina antes de generar esta respuesta.
No digas que ARIA no puede eliminar memorias.
No digas que necesitas una función adicional
para eliminar memorias.
Si el usuario acaba de pedir que recuerdes algo
y la memoria fue guardada correctamente,
confirma brevemente que quedó guardada.
Si el usuario acaba de pedir olvidar algo:
Memorias eliminadas:
${memoriesDeleted}
Si memoriesDeleted es mayor que 0, confirma que
la memoria fue eliminada.
Si memoriesDeleted es 0, indica que no encontraste
una memoria permanente relacionada que eliminar.
No inventes eliminaciones que no ocurrieron.
=================================================
SEGURIDAD
=================================================
No ejecutes acciones externas ni afirmes haberlas
ejecutado si no existe una herramienta autorizada
para hacerlo.
Las acciones que puedan afectar sistemas,
dispositivos, cuentas, archivos o servicios
externos requieren autorización explícita
del usuario.
Sé precisa, transparente y no inventes resultados.
=================================================
RESPUESTA
=================================================
Responde de forma natural y clara.
No expliques el funcionamiento interno de la base
de datos salvo que el usuario lo pregunte.
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
                                reply: reply,
                                memorySaved:
                                    memorySaved,
                                memoriesDeleted:
                                    memoriesDeleted
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
