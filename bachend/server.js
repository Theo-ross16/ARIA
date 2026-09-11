const http = require("http");
const OpenAI = require("openai");

const PORT = process.env.PORT || 3000;

const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

const server = http.createServer(async (req, res) => {

    // CORS
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    // Preflight
    if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
    }

    // Estado del servidor
    if (req.method === "GET" && req.url === "/") {

        res.writeHead(200, {
            "Content-Type": "application/json"
        });

        res.end(JSON.stringify({
            status: "online",
            assistant: "ARIA",
            version: "0.3",
            model: "gpt-5.6-luna"
        }));

        return;
    }

    // Chat de ARIA
    if (req.method === "POST" && req.url === "/api/chat") {

        let body = "";

        req.on("data", chunk => {
            body += chunk;
        });

        req.on("end", async () => {

            try {

                const data = JSON.parse(body);
                const message = data.message || "";

                if (!message.trim()) {

                    res.writeHead(400, {
                        "Content-Type": "application/json"
                    });

                    res.end(JSON.stringify({
                        success: false,
                        error: "Mensaje vacío"
                    }));

                    return;
                }

                console.log("Mensaje recibido:", message);

                const response = await client.responses.create({

                    model: "gpt-5.6-luna",

                    instructions: `
Eres ARIA, un asistente avanzado de inteligencia artificial.

Tu objetivo es ayudar al usuario de forma clara, natural,
inteligente y útil.

Responde siempre en español, salvo que el usuario solicite
otro idioma.

Puedes explicar conceptos, analizar información, ayudar a
programar y colaborar en la construcción del sistema ARIA.

IMPORTANTE:
No ejecutes acciones externas ni afirmes haberlas ejecutado
si no existe una herramienta autorizada para hacerlo.

Las acciones que puedan afectar sistemas, dispositivos,
cuentas, archivos o servicios externos requieren autorización
explícita del usuario.

Sé precisa, transparente y no inventes resultados.
                    `,

                    input: message
                });

                const reply =
                    response.output_text ||
                    "No pude generar una respuesta.";

                console.log("Respuesta de ARIA:", reply);

                res.writeHead(200, {
                    "Content-Type": "application/json"
                });

                res.end(JSON.stringify({
                    success: true,
                    reply: reply
                }));

            } catch (error) {

                console.error("ERROR ARIA:", error);

                res.writeHead(500, {
                    "Content-Type": "application/json"
                });

                res.end(JSON.stringify({
                    success: false,
                    error: "Error comunicando con el modelo de IA"
                }));
            }
        });

        return;
    }

    // Ruta inexistente
    res.writeHead(404, {
        "Content-Type": "application/json"
    });

    res.end(JSON.stringify({
        error: "Ruta no encontrada"
    }));
});

server.listen(PORT, () => {

    console.log(
        `ARIA backend funcionando en el puerto ${PORT}`
    );

});
