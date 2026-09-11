const http = require("http");
const OpenAI = require("openai");
const { Pool } = require("pg");

const PORT = process.env.PORT || 3000;

const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
});

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

        await pool.query(`
            CREATE TABLE IF NOT EXISTS aria_deleted_facts (
                id SERIAL PRIMARY KEY,
                original_id INTEGER,
                session_id VARCHAR(255) NOT NULL,
                category VARCHAR(100) NOT NULL,
                content TEXT NOT NULL,
                importance INTEGER DEFAULT 5,
                deleted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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

async function saveFact(
    sessionId,
    category,
    content,
    importance = 5
) {
    try {
        const result = await pool.query(
            `
            INSERT INTO aria_facts
            (
                session_id,
                category,
                content,
                importance,
                updated_at
            )
            VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
            RETURNING id
            `,
            [
                sessionId,
                category,
                content,
                importance
            ]
        );

        return result.rows[0].id;

    } catch (error) {
        console.error(
            "Error guardando memoria estructurada:",
            error
        );

        return null;
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
                importance,
                created_at,
                updated_at
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

/*
=================================================
ARCHIVAR MEMORIA ANTES DE ELIMINARLA
=================================================
*/

async function archiveFactsByIds(
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
            .filter(
                id =>
                    Number.isInteger(id) &&
                    id > 0
            );

        if (cleanIds.length === 0) {
            return 0;
        }

        const result = await pool.query(
            `
            INSERT INTO aria_deleted_facts
            (
                original_id,
                session_id,
                category,
                content,
                importance
            )
            SELECT
                id,
                session_id,
                category,
                content,
                importance
            FROM aria_facts
            WHERE session_id = $1
            AND id = ANY($2::int[])
            RETURNING id
            `,
            [
                sessionId,
                cleanIds
            ]
        );

        return result.rowCount;

    } catch (error) {

        console.error(
            "Error archivando memorias:",
            error
        );

        return 0;
    }
}

/*
=================================================
ELIMINAR MEMORIAS POR ID
=================================================
*/

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
            .filter(
                id =>
                    Number.isInteger(id) &&
                    id > 0
            );

        if (cleanIds.length === 0) {
            return 0;
        }

        /*
        Primero archivamos.
        */

        const archived =
            await archiveFactsByIds(
                sessionId,
                cleanIds
            );

        if (archived === 0) {
            return 0;
        }

        /*
        Después eliminamos de las
        memorias activas.
        */

        const result =
            await pool.query(
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
            "Error eliminando memorias por ID:",
            error
        );

        return 0;
    }
}

/*
=================================================
ARCHIVAR TODAS LAS MEMORIAS
=================================================
*/

async function archiveAllFacts(
    sessionId
) {
    try {

        const result = await pool.query(
            `
            INSERT INTO aria_deleted_facts
            (
                original_id,
                session_id,
                category,
                content,
                importance
            )
            SELECT
                id,
                session_id,
                category,
                content,
                importance
            FROM aria_facts
            WHERE session_id = $1
            RETURNING id
            `,
            [sessionId]
        );

        return result.rowCount;

    } catch (error) {

        console.error(
            "Error archivando todas las memorias:",
            error
        );

        return 0;
    }
}

/*
=================================================
ELIMINAR TODAS LAS MEMORIAS ACTIVAS
=================================================
*/

async function deleteAllFacts(
    sessionId
) {
    try {

        const archived =
            await archiveAllFacts(
                sessionId
            );

        if (archived === 0) {
            return 0;
        }

        const result =
            await pool.query(
                `
                DELETE FROM aria_facts
                WHERE session_id = $1
                `,
                [sessionId]
            );

        return result.rowCount;

    } catch (error) {

        console.error(
            "Error eliminando todas las memorias:",
            error
        );

        return 0;
    }
}

/*
=================================================
ANALIZADOR DE MEMORIA
=================================================
*/

async function analyzeMemoryCommand(
    message,
    facts
) {
    try {

        const memoryList =
            facts.length > 0
                ? facts
                    .map(
                        fact =>
                            `ID: ${fact.id} | Categoría: ${fact.category} | Contenido: ${fact.content}`
                    )
                    .join("\n")
                : "NO HAY MEMORIAS PERMANENTES.";

        const response =
            await client.responses.create({

                model: "gpt-5.6-luna",

                instructions: `

Eres el sistema de gestión de memoria de ARIA.

Tu única tarea es determinar si el usuario quiere:

1. GUARDAR una memoria.
2. ELIMINAR una memoria.
3. ELIMINAR TODAS las memorias.
4. CONSULTAR qué memorias existen.
5. NO HACER NADA.

RESPONDE ÚNICAMENTE CON JSON VÁLIDO.

FORMATO:

{
    "action": "save" | "delete" | "delete_all" | "list" | "none",
    "category": "fact" | "preference" | "project" | "instruction" | "context",
    "content": "texto breve",
    "importance": 1,
    "deleteIds": []
}

REGLAS PARA GUARDAR:

Solo usa "save" si el usuario pide explícitamente
recordar, guardar, almacenar o memorizar algo.

Ejemplos:

"Recuerda que mi proyecto se llama ARIA."

"Guarda que prefiero respuestas cortas."

"Quiero que recuerdes que trabajo en X."

REGLAS PARA ELIMINAR:

Usa "delete" si el usuario pide explícitamente
olvidar, borrar o eliminar una memoria concreta.

Ejemplos:

"Olvida mi nombre."

"Olvida el nombre de mi proyecto."

"Borra esa memoria."

"No recuerdes que mi proyecto se llama FÉNIX."

IMPORTANTE:

Debes comparar la intención del usuario con las
memorias existentes.

NO es necesario que las palabras sean idénticas.

Ejemplo:

Memoria existente:

ID: 25
Categoría: project
Contenido: Mi proyecto de prueba se llama FÉNIX.

Usuario:

"Olvida el nombre de mi proyecto de prueba."

Debes devolver:

{
    "action": "delete",
    "deleteIds": [25]
}

REGLAS PARA ELIMINAR TODO:

Usa "delete_all" cuando el usuario diga claramente:

"Olvida todo."

"Borra todas mis memorias."

"Elimina todo lo que recuerdas de mí."

"Quiero que olvides todo."

REGLAS PARA CONSULTAR:

Usa "list" cuando el usuario pregunte:

"¿Qué recuerdas de mí?"

"¿Qué memorias tienes?"

"¿Qué sabes de mí?"

No conviertas una pregunta normal en una memoria.

Nunca guardes:

- contraseñas
- API keys
- tokens
- datos bancarios
- información extremadamente sensible

importance debe ser un número del 1 al 10.

Si no existe ninguna memoria relacionada con una
solicitud de eliminación concreta:

"deleteIds": []

Si action es "save", deleteIds debe ser [].

Si action es "list", deleteIds debe ser [].

Si action es "none", deleteIds debe ser [].

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

        const command =
            JSON.parse(text);

        if (
            !Array.isArray(command.deleteIds)
        ) {
            command.deleteIds = [];
        }

        return command;

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

/*
=================================================
SERVIDOR
=================================================
*/

const server = http.createServer(
    async (req, res) => {

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

        if (
            req.method === "OPTIONS"
        ) {

            res.writeHead(204);
            res.end();

            return;
        }

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

                    version: "0.6",

                    model:
                        "gpt-5.6-luna",

                    memory:
                        "persistent + structured",

                    memoryDelete:
                        "enabled",

                    memoryList:
                        "enabled",

                    memoryDeleteAll:
                        "enabled",

                    memoryRecovery:
                        "archived"

                })
            );

            return;
        }

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

                        if (
                            !message.trim()
                        ) {

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

                        const existingFacts =
                            await getFacts(
                                sessionId
                            );

                        const memoryCommand =
                            await analyzeMemoryCommand(
                                message,
                                existingFacts
                            );

                        console.log(
                            "Comando de memoria:",
                            memoryCommand
                        );

                        let memorySaved =
                            false;

                        let memoriesDeleted =
                            0;

                        let memoryAction =
                            "none";

                        if (
                            memoryCommand.action ===
                            "save"
                        ) {

                            const savedId =
                                await saveFact(
                                    sessionId,

                                    memoryCommand.category ||
                                        "fact",

                                    memoryCommand.content ||
                                        message,

                                    memoryCommand.importance ||
                                        5
                                );

                            memorySaved =
                                savedId !== null;

                            memoryAction =
                                "save";

                            console.log(
                                "Memoria guardada:",
                                savedId
                            );
                        }

                        if (
                            memoryCommand.action ===
                            "delete"
                        ) {

                            memoriesDeleted =
                                await deleteFactsByIds(
                                    sessionId,
                                    memoryCommand.deleteIds
                                );

                            memoryAction =
                                "delete";

                            console.log(
                                "IDs para eliminar:",
                                memoryCommand.deleteIds
                            );

                            console.log(
                                "Memorias archivadas y eliminadas:",
                                memoriesDeleted
                            );
                        }

                        if (
                            memoryCommand.action ===
                            "delete_all"
                        ) {

                            memoriesDeleted =
                                await deleteAllFacts(
                                    sessionId
                                );

                            memoryAction =
                                "delete_all";

                            console.log(
                                "Memorias archivadas y eliminadas:",
                                memoriesDeleted
                            );
                        }

                        const facts =
                            await getFacts(
                                sessionId
                            );

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

                        let memoryInstruction = "";

                        if (
                            memoryCommand.action ===
                            "list"
                        ) {

                            memoryInstruction = `

El usuario está preguntando qué memorias
permanentes tienes sobre él.

Estas son las memorias actuales:

${memoryContext}

Muéstralas de forma clara y natural.

Si no existen memorias, dilo claramente.

`;
                        }

                        const conversation =
                            await getMemory(
                                sessionId
                            );

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
MEMORIA PERMANENTE ACTUAL
=================================================

${memoryContext}

Utiliza las memorias solamente cuando sean
relevantes.

Si no son relevantes, ignóralas.

=================================================
ESTADO DE LA OPERACIÓN DE MEMORIA
=================================================

Acción detectada:

${memoryAction}

Memoria guardada:

${memorySaved}

Memorias eliminadas:

${memoriesDeleted}

=================================================
REGLAS DE MEMORIA
=================================================

ARIA SÍ TIENE capacidad para gestionar memorias
permanentes mediante el backend.

Las memorias eliminadas se conservan en un archivo
interno de recuperación.

No digas que una memoria fue destruida
definitivamente cuando fue archivada.

No digas que no puedes eliminar memorias.

Si se guardó una memoria correctamente,
confirma brevemente que quedó guardada.

Si se eliminó una o más memorias correctamente,
confirma brevemente que fueron eliminadas.

Si se solicitó eliminar una memoria pero
memoriesDeleted es 0, indica que no se encontró
una memoria permanente relacionada.

Si el usuario solicitó eliminar todo y se eliminaron
memorias, confirma cuántas fueron eliminadas.

Si no había memorias para eliminar, dilo claramente.

Nunca inventes una operación de memoria.

${memoryInstruction}

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
CONVERSACIÓN
=================================================

Responde de manera natural y clara.

No expliques el funcionamiento interno de PostgreSQL,
el backend o el sistema de IDs salvo que el usuario
lo pregunte específicamente.

                                `,

                                input:
                                    conversationInput

                            });

                        const reply =
                            response.output_text ||
                            "No pude generar una respuesta.";

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
