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

/*
=================================================
BASE DE DATOS
=================================================
*/

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

        console.log(
            "Base de datos de ARIA inicializada."
        );

    } catch (error) {

        console.error(
            "Error inicializando base de datos:",
            error
        );
    }
}

/*
=================================================
CONVERSACIÓN
=================================================
*/

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

async function getMemory(
    sessionId
) {

    try {

        const result =
            await pool.query(
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

/*
=================================================
MEMORIAS ACTIVAS
=================================================
*/

async function saveFact(
    sessionId,
    category,
    content,
    importance = 5
) {

    try {

        const result =
            await pool.query(
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

async function getFacts(
    sessionId
) {

    try {

        const result =
            await pool.query(
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
MEMORIAS ELIMINADAS
=================================================
*/

async function getDeletedFacts(
    sessionId
) {

    try {

        const result =
            await pool.query(
                `
                SELECT
                    id,
                    original_id,
                    category,
                    content,
                    importance,
                    deleted_at
                FROM aria_deleted_facts
                WHERE session_id = $1
                ORDER BY deleted_at DESC
                LIMIT 100
                `,
                [sessionId]
            );

        return result.rows;

    } catch (error) {

        console.error(
            "Error recuperando papelera:",
            error
        );

        return [];
    }
}

/*
=================================================
ARCHIVAR MEMORIAS ANTES DE ELIMINAR
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

        const cleanIds =
            ids
                .map(id => Number(id))
                .filter(
                    id =>
                        Number.isInteger(id) &&
                        id > 0
                );

        if (
            cleanIds.length === 0
        ) {

            return 0;
        }

        const result =
            await pool.query(
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

        const cleanIds =
            ids
                .map(id => Number(id))
                .filter(
                    id =>
                        Number.isInteger(id) &&
                        id > 0
                );

        if (
            cleanIds.length === 0
        ) {

            return 0;
        }

        const archived =
            await archiveFactsByIds(
                sessionId,
                cleanIds
            );

        if (
            archived === 0
        ) {

            return 0;
        }

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
            "Error eliminando memorias:",
            error
        );

        return 0;
    }
}

/*
=================================================
ARCHIVAR TODAS
=================================================
*/

async function archiveAllFacts(
    sessionId
) {

    try {

        const result =
            await pool.query(
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
ELIMINAR TODAS
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

        if (
            archived === 0
        ) {

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
RECUPERAR MEMORIA POR ID
=================================================
*/

async function restoreDeletedFactById(
    sessionId,
    id
) {

    try {

        const deleted =
            await pool.query(
                `
                SELECT
                    id,
                    category,
                    content,
                    importance
                FROM aria_deleted_facts
                WHERE session_id = $1
                AND id = $2
                `,
                [
                    sessionId,
                    Number(id)
                ]
            );

        if (
            deleted.rows.length === 0
        ) {

            return null;
        }

        const fact =
            deleted.rows[0];

        const restored =
            await pool.query(
                `
                INSERT INTO aria_facts
                (
                    session_id,
                    category,
                    content,
                    importance,
                    updated_at
                )
                VALUES
                (
                    $1,
                    $2,
                    $3,
                    $4,
                    CURRENT_TIMESTAMP
                )
                RETURNING id
                `,
                [
                    sessionId,
                    fact.category,
                    fact.content,
                    fact.importance
                ]
            );

        await pool.query(
            `
            DELETE FROM aria_deleted_facts
            WHERE session_id = $1
            AND id = $2
            `,
            [
                sessionId,
                Number(id)
            ]
        );

        return {
            restoredId:
                restored.rows[0].id,

            content:
                fact.content
        };

    } catch (error) {

        console.error(
            "Error restaurando memoria:",
            error
        );

        return null;
    }
}

/*
=================================================
ANALIZADOR DE MEMORIA
=================================================
*/

async function analyzeMemoryCommand(
    message,
    facts,
    deletedFacts
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

        const deletedMemoryList =
            deletedFacts.length > 0
                ? deletedFacts
                    .map(
                        fact =>
                            `ID PAPELERA: ${fact.id} | Categoría: ${fact.category} | Contenido: ${fact.content}`
                    )
                    .join("\n")
                : "NO HAY MEMORIAS ELIMINADAS.";

        const response =
            await client.responses.create({

                model:
                    "gpt-5.6-luna",

                instructions: `

Eres el sistema de gestión de memoria de ARIA.

Tu única tarea es determinar si el usuario quiere:

1. GUARDAR una memoria.
2. ELIMINAR una memoria.
3. ELIMINAR TODAS las memorias.
4. CONSULTAR memorias activas.
5. CONSULTAR memorias eliminadas.
6. RECUPERAR una memoria eliminada.
7. NO HACER NADA.

RESPONDE ÚNICAMENTE CON JSON VÁLIDO.

FORMATO:

{
    "action": "save" | "delete" | "delete_all" | "list" | "list_deleted" | "restore" | "none",
    "category": "fact" | "preference" | "project" | "instruction" | "context",
    "content": "texto breve",
    "importance": 1,
    "deleteIds": [],
    "restoreIds": []
}

=================================================
GUARDAR
=================================================

Solo usa "save" si el usuario pide explícitamente
recordar, guardar, almacenar o memorizar algo.

=================================================
ELIMINAR
=================================================

Usa "delete" si el usuario pide olvidar,
borrar o eliminar una memoria concreta.

Debes comparar el significado con las memorias
existentes.

No es necesario que las palabras sean idénticas.

=================================================
ELIMINAR TODO
=================================================

Usa "delete_all" cuando diga claramente:

"Olvida todo."

"Borra todas mis memorias."

"Elimina todo lo que recuerdas de mí."

=================================================
CONSULTAR MEMORIAS
=================================================

Usa "list" cuando pregunte:

"¿Qué recuerdas de mí?"

"¿Qué memorias tienes?"

"¿Qué sabes de mí?"

=================================================
CONSULTAR MEMORIAS ELIMINADAS
=================================================

Usa "list_deleted" cuando pregunte:

"¿Qué memorias eliminé?"

"¿Qué tienes en la papelera?"

"¿Qué memorias borré?"

"¿Qué memorias eliminadas tienes?"

=================================================
RECUPERAR
=================================================

Usa "restore" cuando el usuario pida recuperar,
restaurar o volver a recordar una memoria eliminada.

Ejemplos:

"Recupera la memoria de mi proyecto."

"Restaura la memoria que eliminé."

"Vuelve a recordar el nombre de mi proyecto."

Debes comparar semánticamente la solicitud con
las memorias eliminadas.

Si encuentras una coincidencia:

"restoreIds": [ID_PAPELERA]

Si no encuentras una coincidencia:

"restoreIds": []

=================================================
MEMORIAS ACTIVAS
=================================================

${memoryList}

=================================================
MEMORIAS ELIMINADAS
=================================================

${deletedMemoryList}

=================================================

Nunca guardes:

- contraseñas
- API keys
- tokens
- datos bancarios
- información extremadamente sensible

importance debe ser un número del 1 al 10.

Si action es "save":
deleteIds debe ser [] y restoreIds debe ser [].

Si action es "delete":
restoreIds debe ser [].

Si action es "restore":
deleteIds debe ser [].

Si action es "list":
deleteIds debe ser [] y restoreIds debe ser [].

Si action es "list_deleted":
deleteIds debe ser [] y restoreIds debe ser [].

Si action es "none":
deleteIds debe ser [] y restoreIds debe ser [].

                `,

                input:
                    message
            });

        let text =
            response.output_text ||
            "{}";

        text =
            text
                .replace(/```json/g, "")
                .replace(/```/g, "")
                .trim();

        const command =
            JSON.parse(text);

        if (
            !Array.isArray(
                command.deleteIds
            )
        ) {

            command.deleteIds = [];
        }

        if (
            !Array.isArray(
                command.restoreIds
            )
        ) {

            command.restoreIds = [];
        }

        return command;

    } catch (error) {

        console.error(
            "Error analizando memoria:",
            error
        );

        return {
            action: "none",
            deleteIds: [],
            restoreIds: []
        };
    }
}

/*
=================================================
SERVIDOR
=================================================
*/

const server =
    http.createServer(
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

                        status:
                            "online",

                        assistant:
                            "ARIA",

                        version:
                            "0.7",

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
                            "enabled",

                        deletedMemoryArchive:
                            "enabled"

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
                                data.message ||
                                "";

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

                                        success:
                                            false,

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

                            const deletedFacts =
                                await getDeletedFacts(
                                    sessionId
                                );

                            const memoryCommand =
                                await analyzeMemoryCommand(
                                    message,
                                    existingFacts,
                                    deletedFacts
                                );

                            console.log(
                                "Comando de memoria:",
                                memoryCommand
                            );

                            let memorySaved =
                                false;

                            let memoriesDeleted =
                                0;

                            let memoriesRestored =
                                0;

                            let restoredContent =
                                "";

                            let memoryAction =
                                "none";

                            /*
                            =================================
                            GUARDAR
                            =================================
                            */

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

                            /*
                            =================================
                            ELIMINAR
                            =================================
                            */

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
                                    "IDs eliminados:",
                                    memoryCommand.deleteIds
                                );

                                console.log(
                                    "Memorias archivadas:",
                                    memoriesDeleted
                                );
                            }

                            /*
                            =================================
                            ELIMINAR TODO
                            =================================
                            */

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

                            /*
                            =================================
                            RECUPERAR
                            =================================
                            */

                            if (
                                memoryCommand.action ===
                                "restore"
                            ) {

                                memoryAction =
                                    "restore";

                                for (
                                    const id
                                    of memoryCommand.restoreIds
                                ) {

                                    const restored =
                                        await restoreDeletedFactById(
                                            sessionId,
                                            id
                                        );

                                    if (
                                        restored
                                    ) {

                                        memoriesRestored++;

                                        restoredContent =
                                            restored.content;

                                        console.log(
                                            "Memoria restaurada:",
                                            restored
                                        );
                                    }
                                }

                                console.log(
                                    "Memorias restauradas:",
                                    memoriesRestored
                                );
                            }

                            /*
                            =================================
                            MEMORIAS ACTUALES
                            =================================
                            */

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

                            /*
                            =================================
                            MEMORIAS ELIMINADAS
                            =================================
                            */

                            const currentDeletedFacts =
                                await getDeletedFacts(
                                    sessionId
                                );

                            let deletedMemoryContext =
                                "No hay memorias eliminadas.";

                            if (
                                currentDeletedFacts.length > 0
                            ) {

                                deletedMemoryContext =
                                    currentDeletedFacts
                                        .map(
                                            fact =>
                                                `[ID PAPELERA ${fact.id}] [${fact.category}] ${fact.content}`
                                        )
                                        .join("\n");
                            }

                            let memoryInstruction =
                                "";

                            /*
                            LISTA DE MEMORIAS ACTIVAS
                            */

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

Si no existen memorias,
dilo claramente.

`;
                            }

                            /*
                            LISTA DE MEMORIAS ELIMINADAS
                            */

                            if (
                                memoryCommand.action ===
                                "list_deleted"
                            ) {

                                memoryInstruction = `

El usuario está preguntando por las memorias
que fueron eliminadas.

Estas son las memorias archivadas:

${deletedMemoryContext}

Muéstralas de forma clara y natural.

Si no existen memorias eliminadas,
dilo claramente.

`;
                            }

                            /*
                            RESTAURACIÓN
                            */

                            if (
                                memoryCommand.action ===
                                "restore"
                            ) {

                                if (
                                    memoriesRestored > 0
                                ) {

                                    memoryInstruction = `

La memoria fue restaurada correctamente.

Memoria restaurada:

${restoredContent}

Confirma al usuario de forma breve y natural
que la memoria ha vuelto a estar activa.

`;
                                } else {

                                    memoryInstruction = `

El usuario solicitó recuperar una memoria,
pero no se encontró una memoria eliminada
relacionada con su solicitud.

Indícalo claramente.

`;
                                }
                            }

                            /*
                            =================================
                            HISTORIAL
                            =================================
                            */

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

                                role:
                                    "user",

                                content:
                                    message

                            });

                            /*
                            =================================
                            RESPUESTA ARIA
                            =================================
                            */

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

Utiliza estas memorias únicamente cuando
sean relevantes.

=================================================
ESTADO DE MEMORIA
=================================================

Acción:

${memoryAction}

Memoria guardada:

${memorySaved}

Memorias eliminadas:

${memoriesDeleted}

Memorias restauradas:

${memoriesRestored}

=================================================
REGLAS
=================================================

ARIA tiene capacidad para gestionar
memorias permanentes.

Las memorias eliminadas se conservan
en un archivo de recuperación.

Si una memoria fue eliminada,
no significa necesariamente que haya
sido destruida definitivamente.

Si una memoria fue restaurada correctamente,
confirma que volvió a estar activa.

Nunca inventes operaciones.

Nunca digas que una memoria fue restaurada
si memoriesRestored es 0.

Nunca digas que no tienes capacidad
para gestionar memorias.

${memoryInstruction}

=================================================
SEGURIDAD
=================================================

No ejecutes acciones externas ni afirmes
haberlas ejecutado si no existe una herramienta
autorizada para hacerlo.

Las acciones que puedan afectar sistemas,
dispositivos, cuentas, archivos o servicios
externos requieren autorización explícita
del usuario.

Sé precisa, transparente y no inventes resultados.

=================================================
CONVERSACIÓN
=================================================

Responde de manera natural y clara.

No expliques PostgreSQL, IDs o el backend
salvo que el usuario lo pregunte específicamente.

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

                                    success:
                                        true,

                                    reply:
                                        reply,

                                    memorySaved:
                                        memorySaved,

                                    memoriesDeleted:
                                        memoriesDeleted,

                                    memoriesRestored:
                                        memoriesRestored

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

                                    success:
                                        false,

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

/*
=================================================
INICIAR ARIA
=================================================
*/

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
