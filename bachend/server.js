const http = require(“http”);

const PORT = process.env.PORT || 3000;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

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
        version: "0.3"
    }));
    return;
}
// Chat con ARIA
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
            if (!OPENAI_API_KEY) {
                res.writeHead(500, {
                    "Content-Type": "application/json"
                });
                res.end(JSON.stringify({
                    success: false,
                    error: "OPENAI_API_KEY no está configurada en Render"
                }));
                return;
            }
            console.log("Mensaje recibido:", message);
            // Llamada a OpenAI Responses API
            const response = await fetch(
                "https://api.openai.com/v1/responses",
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "Authorization":
                            `Bearer ${OPENAI_API_KEY}`
                    },
                    body: JSON.stringify({
                        model: "gpt-5.6-luna",
                        instructions:
                            "Eres ARIA, un asistente de inteligencia artificial. Responde en español de forma clara, útil y natural. No ejecutes acciones externas ni afirmes haberlas ejecutado si no tienes una herramienta autorizada para hacerlo.",
                        input: message
                    })
                }
            );
            const result = await response.json();
            if (!response.ok) {
                console.error(
                    "Error OpenAI:",
                    result
                );
                res.writeHead(500, {
                    "Content-Type": "application/json"
                });
                res.end(JSON.stringify({
                    success: false,
                    error: "Error comunicando con el modelo de IA"
                }));
                return;
            }
            // Obtener texto de respuesta
            const reply =
                result.output_text ||
                "No recibí una respuesta del modelo.";
            res.writeHead(200, {
                "Content-Type": "application/json"
            });
            res.end(JSON.stringify({
                success: true,
                reply: reply
            }));
        } catch (error) {
            console.error(
                "Error interno:",
                error
            );
            res.writeHead(500, {
                "Content-Type": "application/json"
            });
            res.end(JSON.stringify({
                success: false,
                error:
                    "Error interno del servidor"
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
