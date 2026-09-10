const http = require("http");

const PORT = process.env.PORT || 3000;

const server = http.createServer((req, res) => {

    // Permitir peticiones desde ARIA
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
    }

    if (req.method === "GET" && req.url === "/") {
        res.writeHead(200, {
            "Content-Type": "application/json"
        });

        res.end(JSON.stringify({
            status: "online",
            assistant: "ARIA",
            version: "0.2"
        }));

        return;
    }

    if (req.method === "POST" && req.url === "/api/chat") {

        let body = "";

        req.on("data", chunk => {
            body += chunk;
        });

        req.on("end", () => {

            try {

                const data = JSON.parse(body);

                const message = data.message || "";

                console.log("Mensaje recibido:", message);

                res.writeHead(200, {
                    "Content-Type": "application/json"
                });

                res.end(JSON.stringify({
                    success: true,
                    reply:
                        "He recibido tu mensaje. El cerebro de ARIA está conectado, pero todavía falta conectar el modelo de inteligencia artificial."
                }));

            } catch (error) {

                res.writeHead(400, {
                    "Content-Type": "application/json"
                });

                res.end(JSON.stringify({
                    success: false,
                    error: "Solicitud inválida"
                }));
            }

        });

        return;
    }

    res.writeHead(404, {
        "Content-Type": "application/json"
    });

    res.end(JSON.stringify({
        error: "Ruta no encontrada"
    }));
});

server.listen(PORT, () => {
    console.log(`ARIA backend funcionando en el puerto ${PORT}`);
});
