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

        console.log("Base de datos de ARIA inicializada.");

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

async function saveMemory(sessionId, role, content) {

    try {

        await pool.query(

            `

            INSERT INTO aria_memory

            (session_id, role, content)

            VALUES ($1, $2, $3)

            `,

            [sessionId, role, content]

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

MEMORIAS ELIMINADAS

=================================================

*/

async function getDeletedFacts(sessionId) {

    try {

        const result = await pool.query(

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

async function archiveFactsByIds(sessionId, ids) {

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

async function deleteFactsByIds(sessionId, ids) {

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

        const archived =

            await archiveFactsByIds(

                sessionId,

                cleanIds

            );

        if (archived === 0) {

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

/*

=================================================

ACTUALIZAR MEMORIA

=================================================

*/

async function updateFactById(

    sessionId,

    id,

    category,

    content,

    importance = 5

) {

    try {

        const numericId = Number(id);

        if (

            !Number.isInteger(numericId) ||

            numericId <= 0

        ) {

            return null;

        }

        /*

        =========================================

        1. OBTENER MEMORIA ACTUAL

        =========================================

        */

        const existing = await pool.query(

            `

            SELECT

                id,

                session_id,

                category,

                content,

                importance

            FROM aria_facts

            WHERE session_id = $1

            AND id = $2

            `,

            [

                sessionId,

                numericId

            ]

        );

        if (existing.rows.length === 0) {

            return null;

        }

        const oldFact = existing.rows[0];

        /*

        =========================================

        2. ARCHIVAR VERSION ANTERIOR

        =========================================

        */

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

            VALUES ($1, $2, $3, $4, $5)

            `,

            [

                oldFact.id,

                oldFact.session_id,

                oldFact.category,

                oldFact.content,

                oldFact.importance

            ]

        );

        /*

        =========================================

        3. ACTUALIZAR MEMORIA ACTIVA

        =========================================

        */

        const updated = await pool.query(

            `

            UPDATE aria_facts

            SET

                category = $1,

                content = $2,

                importance = $3,

                updated_at = CURRENT_TIMESTAMP

            WHERE session_id = $4

            AND id = $5

            RETURNING id, category, content, importance

            `,

            [

                category,

                content,

                importance,

                sessionId,

                numericId

            ]

        );

        return updated.rows[0] || null;

    } catch (error) {

        console.error(

            "Error actualizando memoria:",

            error

        );

        return null;

    }

}

/*

=================================================

ARCHIVAR TODAS

=================================================

*/

async function archiveAllFacts(sessionId) {

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

ELIMINAR TODAS

=================================================

*/

async function deleteAllFacts(sessionId) {

    try {

        const archived =

            await archiveAllFacts(

                sessionId

            );

        if (archived === 0) {

            return 0;

        }

        const result = await pool.query(

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

        const deleted = await pool.query(

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

        if (deleted.rows.length === 0) {

            return null;

        }

        const fact = deleted.rows[0];

        const restored = await pool.query(

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

2. ACTUALIZAR una memoria existente.

3. ELIMINAR una memoria.

4. ELIMINAR TODAS las memorias.

5. CONSULTAR memorias activas.

6. CONSULTAR memorias eliminadas.

7. RECUPERAR una memoria eliminada.

8. NO HACER NADA.

RESPONDE ÚNICAMENTE CON JSON VÁLIDO.

FORMATO:

{

    "action": "save" | "update" | "delete" | "delete_all" | "list" | "list_deleted" | "restore" | "none",

    "category": "fact" | "preference" | "project" | "instruction" | "context",

    "content": "texto breve",

    "importance": 1,

    "deleteIds": [],

    "updateIds": [],

    "restoreIds": []

}

=================================================

GUARDAR

=================================================

Solo usa "save" si el usuario pide explícitamente

recordar, guardar, almacenar o memorizar algo.

=================================================

ACTUALIZAR

=================================================

Usa "update" cuando el usuario quiera modificar,

corregir, cambiar, reemplazar o actualizar una

memoria permanente existente.

Ejemplos:

"Actualiza la memoria de Fénix."

"Corrige esa memoria."

"Cambia el nombre del proyecto."

"Ya no quiero que recuerdes X; ahora recuerda Y."

"Reemplaza esa memoria por esta nueva información."

Debes comparar semánticamente la solicitud con

las memorias activas.

Selecciona ÚNICAMENTE la memoria que el usuario

quiere modificar.

Si encuentras una coincidencia:

"updateIds": [ID_DE_MEMORIA]

"content" debe contener la NUEVA versión completa

de la memoria.

No crees una memoria adicional si el usuario

está modificando una memoria existente.

=================================================

ELIMINAR

=================================================

Usa "delete" si el usuario pide olvidar,

borrar o eliminar una memoria concreta.

Debes comparar el significado con las memorias

existentes.

No es necesario que las palabras sean idénticas.

IMPORTANTE:

Si el usuario pide eliminar una memoria concreta,

selecciona ÚNICAMENTE las memorias que coincidan

con la solicitud.

No elimines memorias relacionadas pero diferentes.

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

Debes comparar semánticamente la solicitud con

las memorias eliminadas.

Si encuentras una coincidencia:

"restoreIds": [ID_PAPELERA]

=================================================

MEMORIAS ACTIVAS

=================================================

${memoryList}

=================================================

MEMORIAS ELIMINADAS

=================================================

${deletedMemoryList}

=================================================

REGLAS

=================================================

Nunca guardes:

- contraseñas

- API keys

- tokens

- datos bancarios

- información extremadamente sensible

importance debe ser un número del 1 al 10.

Si action es "save":

deleteIds = []

updateIds = []

restoreIds = []

Si action es "update":

deleteIds = []

restoreIds = []

Si action es "delete":

updateIds = []

restoreIds = []

Si action es "restore":

deleteIds = []

updateIds = []

Si action es "list":

deleteIds = []

updateIds = []

restoreIds = []

Si action es "list_deleted":

deleteIds = []

updateIds = []

restoreIds = []

Si action es "none":

deleteIds = []

updateIds = []

restoreIds = []

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

                command.updateIds

            )

        ) {

            command.updateIds = [];

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

            updateIds: [],

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

            /*

            =========================================

            ESTADO

            =========================================

            */

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

                            "0.9",

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

                        memoryUpdate:

                            "enabled",

                        deletedMemoryArchive:

                            "enabled",

                        memoryContextIsolation:

                            "enabled"

                    })

                );

                return;

            }

            /*

            =========================================

            CHAT

            =========================================

            */

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

                            /*

                            =================================

                            MEMORIAS ACTUALES

                            =================================

                            */

                            const existingFacts =

                                await getFacts(

                                    sessionId

                                );

                            /*

                            =================================

                            MEMORIAS ELIMINADAS

                            =================================

                            */

                            const deletedFacts =

                                await getDeletedFacts(

                                    sessionId

                                );

                            /*

                            =================================

                            ANALIZAR COMANDO

                            =================================

                            */

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

                            let memoriesUpdated =

                                0;

                            let memoriesRestored =

                                0;

                            let restoredContent =

                                "";

                            let updatedContent =

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

                            ACTUALIZAR

                            =================================

                            */

                            if (

                                memoryCommand.action ===

                                "update"

                            ) {

                                memoryAction =

                                    "update";

                                for (

                                    const id

                                    of memoryCommand.updateIds

                                ) {

                                    const updated =

                                        await updateFactById(

                                            sessionId,

                                            id,

                                            memoryCommand.category ||

                                                "fact",

                                            memoryCommand.content ||

                                                message,

                                            memoryCommand.importance ||

                                                5

                                        );

                                    if (

                                        updated

                                    ) {

                                        memoriesUpdated++;

                                        updatedContent =

                                            updated.content;

                                        console.log(

                                            "Memoria actualizada:",

                                            updated

                                        );

                                    }

                                }

                                console.log(

                                    "Memorias actualizadas:",

                                    memoriesUpdated

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

                            RECARGAR MEMORIAS

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

                            /*

                            =================================

                            INSTRUCCIONES ESPECIALES

                            =================================

                            */

                            let memoryInstruction =

                                "";

                            /*

                            =================================

                            LISTAR

                            =================================

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

IMPORTANTE:

Solo considera como memoria permanente

la información incluida arriba.

No utilices conversaciones anteriores

como fuente de memoria permanente.

Muéstralas de forma clara y natural.

Si no existen memorias,

dilo claramente.

`;

                            }

                            /*

                            =================================

                            LISTAR ELIMINADAS

                            =================================

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

                            =================================

                            ACTUALIZACIÓN

                            =================================

                            */

                            if (

                                memoryCommand.action ===

                                "update"

                            ) {

                                if (

                                    memoriesUpdated > 0

                                ) {

                                    memoryInstruction = `

La memoria fue actualizada correctamente.

La nueva versión activa de la memoria es:

${updatedContent}

Confirma al usuario de forma breve y natural

que la memoria fue actualizada.

No digas que se creó una memoria nueva.

`;

                                } else {

                                    memoryInstruction = `

El usuario solicitó actualizar una memoria,

pero no se encontró una memoria activa

que coincidiera con su solicitud.

Indícalo claramente y no inventes

una actualización.

`;

                                }

                            }

                            /*

                            =================================

                            RESTAURACIÓN

                            =================================

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

                            let conversationInput = [];

                            const memoryActions = [

                                "save",

                                "update",

                                "delete",

                                "delete_all",

                                "list",

                                "list_deleted",

                                "restore"

                            ];

                            /*

                            Las operaciones de memoria

                            NO utilizan historial.

                            */

                            if (

                                !memoryActions.includes(

                                    memoryCommand.action

                                )

                            ) {

                                const conversation =

                                    await getMemory(

                                        sessionId

                                    );

                                conversationInput =

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

                            }

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

IMPORTANTE:

Esta lista representa EXCLUSIVAMENTE las

memorias permanentes actualmente activas.

Una información que no aparezca en esta lista

NO debe tratarse como memoria permanente.

Si una memoria fue eliminada y no aparece

en esta lista, considérala eliminada.

No recuperes información de conversaciones

anteriores para contradecir el estado actual

de la memoria.

=================================================

ESTADO DE MEMORIA

=================================================

Acción:

${memoryAction}

Memoria guardada:

${memorySaved}

Memorias actualizadas:

${memoriesUpdated}

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

no debe considerarse una memoria activa.

Si una memoria fue actualizada,

la nueva versión sustituye a la anterior.

La versión anterior queda archivada

en la papelera.

Nunca digas que una memoria fue actualizada

si memoriesUpdated es 0.

Nunca inventes operaciones.

Nunca digas que una memoria fue restaurada

si memoriesRestored es 0.

Nunca digas que una memoria fue eliminada

si memoriesDeleted es 0.

Nunca afirmes que una memoria está activa

si no aparece en MEMORIA PERMANENTE ACTUAL.

Nunca uses el historial conversacional

para reconstruir una memoria que ya fue eliminada.

Nunca uses información de la papelera como

memoria activa.

Sé precisa, transparente y no inventes resultados.

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

                            /*

                            =================================

                            GUARDAR HISTORIAL

                            =================================

                            */

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

                            /*

                            =================================

                            RESPUESTA HTTP

                            =================================

                            */

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

                                    memoriesUpdated:

                                        memoriesUpdated,

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
