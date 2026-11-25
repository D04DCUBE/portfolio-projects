import { startServer } from "./server.ts";
const port = Number(process.env.PORT ?? 3000);
const s = await startServer({ port });
console.log(`Operator screen: http://127.0.0.1:${s.port}/   Machine simulator: http://127.0.0.1:${s.port}/sim`);
